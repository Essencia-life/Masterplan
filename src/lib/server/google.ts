import { google, type calendar_v3 } from 'googleapis';
import * as env from '$app/env/private';
import type { CalEvent, CalendarMeta, Fresh, GroupInfo, RowInfo } from '#lib/types';

const RESOURCE_SUFFIX = '@resource.calendar.google.com';
export const isResourceId = (id: string) => id.endsWith(RESOURCE_SUFFIX);

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

/** "{group}-{floor}-{name} (50)" → group, floor, name. The capacity in brackets is dropped. */
export function parseResourceName(raw: string) {
	const clean = raw.replace(/\s*\(\d+\)\s*$/, '').trim();
	const parts = clean.split(/\s*-\s*/);
	if (parts.length >= 3 && /^\d+$/.test(parts[1])) return { group: parts[0], floor: parts[1], name: parts.slice(2).join('-') };
	if (parts.length >= 2) return { group: parts[0], floor: '', name: parts.slice(1).join('-') };
	return { group: 'Other', floor: '', name: clean };
}

function calendarGroup(name: string) {
	if (/communit|co-?work/i.test(name)) return 'community';
	if (/booking|guest|volunteer/i.test(name)) return 'stay';
	return 'programme';
}

const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const cmp = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });
const isNoise = (id: string) => /#(holiday|contacts)@|holiday@group\.v\.calendar\.google\.com/.test(id);

let metaCache: { at: number; meta: CalendarMeta; ids: Set<string>; resourceIds: Set<string>; writableIds: Set<string> } | undefined;

/**
 * The whole row model comes from the calendar list of the (impersonated) user:
 * - normal calendars → rows (grouped by name), colours from backgroundColor
 * - resource calendars (…@resource.calendar.google.com) → rows grouped by the "{group}-{floor}-{name} (capacity)" naming scheme
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

	const nameOf = (e: calendar_v3.Schema$CalendarListEntry) => e.summaryOverride ?? e.summary ?? e.id!;
	const rows: RowInfo[] = [];
	const writableIds = new Set<string>();
	const resourceIds = new Set<string>();

	const calendars = entries
		.filter((e) => e.id && !isResourceId(e.id) && !isNoise(e.id) && e.accessRole !== 'freeBusyReader')
		.sort((a, b) => cmp(nameOf(a), nameOf(b)));
	for (const e of calendars) {
		const writable = e.accessRole === 'owner' || e.accessRole === 'writer';
		if (writable) writableIds.add(e.id!);
		rows.push({ id: e.id!, label: nameOf(e), kind: 'calendar', groupId: calendarGroup(nameOf(e)), color: e.backgroundColor ?? '#8b8372', available: true, writable });
	}

	const groupLabels = new Map<string, string>();
	const resources = entries
		.filter((e) => e.id && isResourceId(e.id))
		.map((e) => ({ e, p: parseResourceName(nameOf(e)) }))
		.sort((a, b) => cmp(a.p.group, b.p.group) || cmp(a.p.floor, b.p.floor) || cmp(a.p.name, b.p.name));
	for (const { e, p } of resources) {
		const groupId = slug(p.group) === 'community' ? 'community' : 'r-' + slug(p.group);
		if (groupId !== 'community' && !groupLabels.has(groupId)) groupLabels.set(groupId, p.group);
		resourceIds.add(e.id!);
		rows.push({ id: e.id!, label: p.name, kind: 'resource', groupId, color: e.backgroundColor ?? '#8b8372', available: true, writable: false });
	}

	const used = new Set(rows.map((r) => r.groupId));
	const groups: GroupInfo[] = [
		{ id: 'programme', label: 'Programme' },
		...[...groupLabels].map(([id, label]) => ({ id, label })),
		{ id: 'stay', label: 'Guests & volunteers' },
		{ id: 'community', label: 'Community' }
	].filter((g) => used.has(g.id));
	const meta: CalendarMeta = { groups, rows };
	metaCache = { at: Date.now(), meta, ids: new Set(rows.map((r) => r.id)), resourceIds, writableIds };
	return metaCache;
}

export async function resolveCalendarId(rowId: string) {
	const { ids } = await loadMeta();
	if (!ids.has(rowId)) throw new Error('Unknown calendar');
	return rowId;
}

const addDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);

export function normalize(e: calendar_v3.Schema$Event, rowId: string): CalEvent | null {
	if (e.status === 'cancelled' || !e.id) return null;
	// a declined room booking (resource said no) must not show up in the resource calendar
	if (isResourceId(rowId) && e.attendees?.some((a) => (a.self || a.email === rowId) && a.responseStatus === 'declined')) return null;
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
	if (!isResourceId(rowId)) return { calendarId: await resolveCalendarId(rowId), eventId, rowKey: rowId };
	const api = calendar();
	const copy = (await api.events.get({ calendarId: await resolveCalendarId(rowId), eventId })).data;
	const day = (copy.start?.dateTime ?? copy.start?.date ?? '').slice(0, 10);
	if (!copy.iCalUID || !day) throw new Error('Event cannot be traced to its organizer');
	const { meta } = await loadMeta();
	for (const row of meta.rows.filter((r) => r.kind === 'calendar')) {
		const cid = row.id;
		const key = row.id;
		const found = await api.events.list({ calendarId: cid, iCalUID: copy.iCalUID }).catch(() => null);
		const master = found?.data.items?.[0];
		if (!master?.id) continue;
		if (!copy.recurringEventId) return { calendarId: cid, eventId: master.id, rowKey: key };
		const t = Date.parse(day + 'T00:00:00Z');
		const inst = await api.events.instances({
			calendarId: cid,
			eventId: master.id,
			timeMin: new Date(t - 86_400_000).toISOString(),
			timeMax: new Date(t + 2 * 86_400_000).toISOString()
		});
		const hit = inst.data.items?.find((i) => (i.start?.dateTime ?? i.start?.date ?? '').slice(0, 10) === day);
		if (hit?.id) return { calendarId: cid, eventId: hit.id, rowKey: key };
	}
	throw new Error('Organizer event not found in the configured calendars');
}

/** Fresh events of the touched rows, fetched inside the mutation request. */
export async function freshRows(rowIds: string[], fromIso: string, toIso: string): Promise<Fresh> {
	const ids = [...new Set(rowIds)];
	const from = addDays(fromIso, -1);
	const to = addDays(toIso, 1);
	const lists = await Promise.all(ids.map((id) => listEvents(id, from, to).catch(() => [] as CalEvent[])));
	return { from, to, rows: Object.fromEntries(ids.map((id, i) => [id, lists[i]])) };
}

export { addDays };
