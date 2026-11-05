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

/** Calendars are named "{group}/{name}"; anything else is not part of the booking tool. */
function parseCalendarName(raw: string) {
	const i = raw.indexOf('/');
	if (i < 0) return null;
	const group = raw.slice(0, i).trim();
	const name = raw.slice(i + 1).trim();
	return group && name ? { group, name } : null;
}

const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const cmp = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });
const IGNORED_NAMES = /^(private|phases of the moon)$/i;
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

	const groupLabels = new Map<string, string>();
	const groupOf = (label: string) => {
		const id = 'g-' + slug(label);
		if (!groupLabels.has(id)) groupLabels.set(id, label);
		return id;
	};

	const calendars = entries
		.filter((e) => e.id && !isResourceId(e.id) && !isNoise(e.id) && e.accessRole !== 'freeBusyReader')
		.map((e) => ({ e, p: parseCalendarName(nameOf(e)) }))
		.filter((x): x is { e: calendar_v3.Schema$CalendarListEntry; p: { group: string; name: string } } => !!x.p)
		.sort((a, b) => cmp(a.p.group, b.p.group) || cmp(a.p.name, b.p.name));
	for (const { e, p } of calendars) {
		const writable = e.accessRole === 'owner' || e.accessRole === 'writer';
		if (writable) writableIds.add(e.id!);
		rows.push({ id: e.id!, label: p.name, kind: 'calendar', groupId: groupOf(p.group), color: e.backgroundColor ?? '#8b8372', available: true, writable });
	}

	const resources = entries
		.filter((e) => e.id && isResourceId(e.id))
		.map((e) => ({ e, p: parseResourceName(nameOf(e)) }))
		.sort((a, b) => cmp(a.p.group, b.p.group) || cmp(a.p.floor, b.p.floor) || cmp(a.p.name, b.p.name));
	for (const { e, p } of resources) {
		const groupId = groupOf(p.group);
		resourceIds.add(e.id!);
		rows.push({ id: e.id!, label: p.name, kind: 'resource', groupId, color: e.backgroundColor ?? '#8b8372', available: true, writable: false });
	}

	const used = new Set(rows.map((r) => r.groupId));
	// groups with calendars first, resource-only groups after (alphabetical within each block)
	const calendarGroups = new Set(rows.filter((r) => r.kind === 'calendar').map((r) => r.groupId));
	const groups: GroupInfo[] = [...groupLabels]
		.map(([id, label]) => ({ id, label }))
		.sort((a, b) => Number(!calendarGroups.has(a.id)) - Number(!calendarGroups.has(b.id)));
	const meta: CalendarMeta = { groups, rows };
	metaCache = { at: Date.now(), meta, ids: new Set(rows.map((r) => r.id)), resourceIds, writableIds };
	return metaCache;
}

export async function resolveCalendarId(rowId: string) {
	const { ids } = await loadMeta();
	if (!ids.has(rowId)) throw new Error('Unknown calendar');
	return rowId;
}

export const TIME_ZONE = 'Europe/Lisbon';
const fmtDate = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const fmtTime = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** Calendar day (YYYY-MM-DD) in the app's time zone. Resource calendars return times in their own zone, so never slice the string. */
export const localDay = (v?: string | null) => (!v ? '' : v.length === 10 ? v : fmtDate.format(new Date(v)));
export const localTime = (v: string) => fmtTime.format(new Date(v));
export const dayOf = (t?: calendar_v3.Schema$EventDateTime | null) => localDay(t?.date ?? t?.dateTime);

const addDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);

export function normalize(e: calendar_v3.Schema$Event, rowId: string): CalEvent | null {
	if (e.status === 'cancelled' || !e.id) return null;
	// a declined room booking (resource said no) must not show up in the resource calendar
	if (isResourceId(rowId) && e.attendees?.some((a) => (a.self || a.email === rowId) && a.responseStatus === 'declined')) return null;
	const start = dayOf(e.start);
	let end: string;
	if (e.end?.date) end = e.end.date;
	else if (e.end?.dateTime) {
		const d = localDay(e.end.dateTime);
		end = localTime(e.end.dateTime) === '00:00' ? d : addDays(d, 1);
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
		description: e.description ?? '',
		fromLocal: e.start?.dateTime ? `${localDay(e.start.dateTime)}T${localTime(e.start.dateTime)}` : undefined,
		toLocal: e.end?.dateTime ? `${localDay(e.end.dateTime)}T${localTime(e.end.dateTime)}` : undefined,
		declinedRooms: isResourceId(rowId)
			? undefined
			: (e.attendees ?? []).filter((a) => a.resource && a.responseStatus === 'declined').map((a) => a.email!)
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
	const day = dayOf(copy.start);
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
		const hit = inst.data.items?.find((i) => dayOf(i.start) === day);
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
