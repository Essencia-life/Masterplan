import { google, type calendar_v3 } from 'googleapis';
import * as env from '$app/env/private';
import type { CalEvent, CalendarMeta, GroupInfo, MainKey, RowInfo } from '#lib/types';
import { MAIN_KEYS } from '#lib/types';

const CALENDAR_IDS: Record<MainKey, () => string | undefined> = {
	events: () => env.GOOGLE_CALENDAR_EVENTS,
	retreats: () => env.GOOGLE_CALENDAR_RETREATS,
	bookings: () => env.GOOGLE_CALENDAR_BOOKINGS,
	community: () => env.GOOGLE_CALENDAR_COMMUNITY,
	coworking: () => env.GOOGLE_CALENDAR_COWORKING
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

/**
 * GOOGLE_SERVICE_ACCOUNT_JSON may be: the JSON itself, the JSON as base64,
 * or just the PEM private key ("-----BEGIN PRIVATE KEY-----", multi-line or with literal \\n)
 * together with GOOGLE_SERVICE_ACCOUNT_EMAIL.
 */
function credentials() {
	let raw = env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
	if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set');
	if (raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1);
	if (!raw.startsWith('{') && !raw.includes('BEGIN')) {
		const decoded = Buffer.from(raw, 'base64').toString('utf8').trim();
		if (decoded.startsWith('{') || decoded.includes('BEGIN')) raw = decoded;
	}
	const fixNewlines = (k: string) => k.replace(/\\n/g, '\n');
	if (raw.startsWith('{')) {
		const json = JSON.parse(raw);
		return { email: json.client_email as string, key: fixNewlines(json.private_key as string) };
	}
	if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL) throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL is required when only the private key is provided');
	return { email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL, key: fixNewlines(raw) };
}

let client: calendar_v3.Calendar | undefined;
export function calendar() {
	if (client) return client;
	const { email, key } = credentials();
	const auth = new google.auth.JWT({
		email,
		key,
		scopes: ['https://www.googleapis.com/auth/calendar'],
		subject: env.GOOGLE_IMPERSONATE_USER || undefined
	});
	client = google.calendar({ version: 'v3', auth });
	return client;
}

function mainCalendarId(key: MainKey) {
	return CALENDAR_IDS[key]() || undefined;
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

/**
 * Finds the organizer's event for a bar the user sees. Main calendar rows are the organizer
 * themselves; for a resource calendar the copy is matched by iCalUID (and, for series, by the
 * instance that starts on the same day).
 */
export async function resolveOrganizer(rowId: string, eventId: string) {
	if (isMainKey(rowId)) return { calendarId: await resolveCalendarId(rowId), eventId };
	const api = calendar();
	const copy = (await api.events.get({ calendarId: await resolveCalendarId(rowId), eventId })).data;
	const day = (copy.start?.dateTime ?? copy.start?.date ?? '').slice(0, 10);
	if (!copy.iCalUID || !day) throw new Error('Event cannot be traced to its organizer');
	for (const key of MAIN_KEYS) {
		const cid = mainCalendarId(key);
		if (!cid) continue;
		const found = await api.events.list({ calendarId: cid, iCalUID: copy.iCalUID }).catch(() => null);
		const master = found?.data.items?.[0];
		if (!master?.id) continue;
		if (!copy.recurringEventId) return { calendarId: cid, eventId: master.id };
		const t = Date.parse(day + 'T00:00:00Z');
		const inst = await api.events.instances({
			calendarId: cid,
			eventId: master.id,
			timeMin: new Date(t - 86_400_000).toISOString(),
			timeMax: new Date(t + 2 * 86_400_000).toISOString()
		});
		const hit = inst.data.items?.find((i) => (i.start?.dateTime ?? i.start?.date ?? '').slice(0, 10) === day);
		if (hit?.id) return { calendarId: cid, eventId: hit.id };
	}
	throw new Error('Organizer event not found in the configured calendars');
}

export { addDays };
