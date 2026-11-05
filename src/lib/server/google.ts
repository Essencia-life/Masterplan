import { google, type calendar_v3 } from 'googleapis';
import { env } from '$env/dynamic/private';
import type { CalEvent, CalendarMeta, GroupInfo, MainKey, RowInfo } from '#lib/types';
import { MAIN_KEYS } from '#lib/types';

const ENV_KEYS: Record<MainKey, string> = {
	events: 'GOOGLE_CALENDAR_EVENTS',
	retreats: 'GOOGLE_CALENDAR_RETREATS',
	bookings: 'GOOGLE_CALENDAR_BOOKINGS',
	community: 'GOOGLE_CALENDAR_COMMUNITY',
	coworking: 'GOOGLE_CALENDAR_COWORKING'
};

const MAIN_META: Record<MainKey, { label: string; groupId: string; color: string }> = {
	events: { label: 'Events', groupId: 'programme', color: '#cf972b' },
	retreats: { label: 'Retreats', groupId: 'programme', color: '#b05d38' },
	bookings: { label: 'Guests & volunteers', groupId: 'stay', color: '#3b6c7b' },
	community: { label: 'Community', groupId: 'community', color: '#6b8250' },
	coworking: { label: 'Co-working', groupId: 'community', color: '#8b8372' }
};

const GROUPS: GroupInfo[] = [
	{ id: 'programme', label: 'Programme' },
	{ id: 'farmhouse', label: 'Farmhouse' },
	{ id: 'spaces', label: 'Spaces' },
	{ id: 'stay', label: 'Stay & camping' },
	{ id: 'community', label: 'Community' }
];

export const isMainKey = (v: string): v is MainKey => (MAIN_KEYS as string[]).includes(v);

let client: calendar_v3.Calendar | undefined;
export function calendar() {
	if (client) return client;
	const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
	if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set');
	const json = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
	const auth = new google.auth.JWT({
		email: json.client_email,
		key: json.private_key,
		scopes: ['https://www.googleapis.com/auth/calendar'],
		subject: env.GOOGLE_IMPERSONATE_USER || undefined
	});
	client = google.calendar({ version: 'v3', auth });
	return client;
}

function mainCalendarId(key: MainKey) {
	const id = env[ENV_KEYS[key]];
	return id || undefined;
}

function resourceGroup(name: string) {
	if (/farmhouse|room/i.test(name)) return 'farmhouse';
	if (/hive|community/i.test(name)) return 'community';
	if (/yurt|jurt|tent|camper/i.test(name)) return 'stay';
	return 'spaces';
}

let metaCache: { at: number; meta: CalendarMeta; resourceIds: Set<string> } | undefined;

/**
 * Builds the row model dynamically:
 * - configured calendars (env IDs); names and colours come from the calendar list when subscribed
 * - resource calendars: every calendarList entry ending in @resource.calendar.google.com
 *   (the Directory API `resources.calendars.list` would need an admin scope, the calendar list does not)
 */
export async function loadMeta(force = false) {
	if (!force && metaCache && Date.now() - metaCache.at < 60_000) return metaCache;
	const cal = calendar();
	const entries: calendar_v3.Schema$CalendarListEntry[] = [];
	let pageToken: string | undefined;
	do {
		const res = await cal.calendarList.list({ maxResults: 250, pageToken, showHidden: true });
		entries.push(...(res.data.items ?? []));
		pageToken = res.data.nextPageToken ?? undefined;
	} while (pageToken);

	const byId = new Map(entries.map((e) => [e.id!, e]));
	const rows: RowInfo[] = [];

	for (const key of MAIN_KEYS) {
		const id = mainCalendarId(key);
		const entry = id ? byId.get(id) : undefined;
		const m = MAIN_META[key];
		rows.push({
			id: key,
			label: m.label,
			kind: 'calendar',
			groupId: m.groupId,
			color: entry?.backgroundColor ?? m.color,
			available: !!id
		});
	}

	const resourceIds = new Set<string>();
	const resources = entries
		.filter((e) => e.id?.endsWith('@resource.calendar.google.com'))
		.sort((a, b) => (a.summaryOverride ?? a.summary ?? '').localeCompare(b.summaryOverride ?? b.summary ?? '', 'en', { numeric: true }));
	for (const e of resources) {
		const label = e.summaryOverride ?? e.summary ?? e.id!;
		resourceIds.add(e.id!);
		rows.push({
			id: e.id!,
			label,
			kind: 'resource',
			groupId: resourceGroup(label),
			color: e.backgroundColor ?? '#8b8372',
			available: true
		});
	}

	const used = new Set(rows.map((r) => r.groupId));
	const meta: CalendarMeta = { groups: GROUPS.filter((g) => used.has(g.id)), rows };
	metaCache = { at: Date.now(), meta, resourceIds };
	return metaCache;
}

export async function resolveCalendarId(rowId: string) {
	if (isMainKey(rowId)) {
		const id = mainCalendarId(rowId);
		if (!id) throw new Error(`Calendar "${rowId}" is not configured`);
		return id;
	}
	const { resourceIds } = await loadMeta();
	if (!resourceIds.has(rowId)) throw new Error('Unknown calendar');
	return rowId;
}

const addDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);

export function normalize(e: calendar_v3.Schema$Event, rowId: string): CalEvent | null {
	if (e.status === 'cancelled' || !e.id) return null;
	const start = (e.start?.date ?? e.start?.dateTime ?? '').slice(0, 10);
	let end: string;
	if (e.end?.date) end = e.end.date;
	else if (e.end?.dateTime) {
		const d = e.end.dateTime.slice(0, 10);
		end = /T00:00:00/.test(e.end.dateTime) ? d : addDays(d, 1);
	} else end = addDays(start, 1);
	if (!start) return null;
	if (end <= start) end = addDays(start, 1);
	return {
		id: e.id,
		rowId,
		linkId: e.iCalUID ?? e.id,
		title: e.summary ?? '(no title)',
		start,
		end,
		status: e.status === 'tentative' ? 'tentative' : 'confirmed',
		description: e.description ?? ''
	};
}

export async function listEvents(rowId: string, timeMin: string, timeMax: string) {
	const calendarId = await resolveCalendarId(rowId);
	const out: CalEvent[] = [];
	let pageToken: string | undefined;
	do {
		const res = await calendar().events.list({
			calendarId,
			timeMin: new Date(timeMin + 'T00:00:00Z').toISOString(),
			timeMax: new Date(timeMax + 'T00:00:00Z').toISOString(),
			singleEvents: true,
			orderBy: 'startTime',
			maxResults: 2500,
			pageToken
		});
		for (const e of res.data.items ?? []) {
			const n = normalize(e, rowId);
			if (n) out.push(n);
		}
		pageToken = res.data.nextPageToken ?? undefined;
	} while (pageToken);
	return out;
}

export { addDays };
