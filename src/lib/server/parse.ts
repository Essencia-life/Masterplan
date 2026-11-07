import type { calendar_v3 } from 'googleapis';
import { isResourceId } from '#lib/calendar-id';
import { addDaysIso, exclusiveEndIso, TIME_ZONE } from '#lib/time';
import type { CalEvent } from '#lib/types';

/** "{group}-{floor}-{name} (50)" → group, floor, name. The capacity in brackets is dropped. */
export function parseResourceName(raw: string) {
	const clean = raw.replace(/\s*\(\d+\)\s*$/, '').trim();
	const parts = clean.split(/\s*-\s*/);
	if (parts.length >= 3 && /^\d+$/.test(parts[1])) return { group: parts[0], floor: parts[1], name: parts.slice(2).join('-') };
	if (parts.length >= 2) return { group: parts[0], floor: '', name: parts.slice(1).join('-') };
	return { group: 'Other', floor: '', name: clean };
}

/** Calendars are named "{group}/{name}"; anything else is not part of the booking tool. */
export function parseCalendarName(raw: string) {
	const i = raw.indexOf('/');
	if (i < 0) return null;
	const group = raw.slice(0, i).trim();
	const name = raw.slice(i + 1).trim();
	return group && name ? { group, name } : null;
}

// ---------- events ----------

const fmtDate = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const fmtTime = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** Calendar day (YYYY-MM-DD) in the app's time zone. Resource calendars return times in their own zone, so never slice the string. */
export const localDay = (v?: string | null) => (!v ? '' : v.length === 10 ? v : fmtDate.format(new Date(v)));
export const localTime = (v: string) => fmtTime.format(new Date(v));
export const dayOf = (t?: calendar_v3.Schema$EventDateTime | null) => localDay(t?.date ?? t?.dateTime);

export const addDays = addDaysIso;

/** [first day, exclusive last day] an event occupies, as ISO dates */
export function eventRange(e: calendar_v3.Schema$Event): [string, string] {
	const start = dayOf(e.start);
	const end = e.end?.date ?? (e.end?.dateTime ? exclusiveEndIso(start, localDay(e.end.dateTime), localTime(e.end.dateTime)) : addDays(start, 1));
	return [start, end <= start ? addDays(start, 1) : end];
}

export function normalize(e: calendar_v3.Schema$Event, rowId: string): CalEvent | null {
	if (e.status === 'cancelled' || !e.id) return null;
	// a declined room booking (resource said no) must not show up in the resource calendar
	if (isResourceId(rowId) && e.attendees?.some((a) => (a.self || a.email === rowId) && a.responseStatus === 'declined')) return null;
	const [start, end] = eventRange(e);
	if (!start) return null;
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
