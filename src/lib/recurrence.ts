import * as z from 'zod';
import { MOON_PHASES, MOON_RELATIONS, matchesMoonRule, type MoonRule } from './moon';
import { DAY_MS, TIME_ZONE, addDaysIso } from './time';

/** How a new event repeats. Weekly becomes an RRULE; moon rules have no RRULE, so the dates are listed (RDATE). */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const weekday = z.number().int().min(0).max(6); // 0 = Sunday, like Date.getUTCDay()

export const repeatSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('weekly'), weekdays: z.array(weekday).min(1).max(7), until: isoDate.optional() }),
	z.object({ kind: z.literal('moon'), phase: z.enum(MOON_PHASES), relation: z.enum(MOON_RELATIONS), weekday, until: isoDate })
]);
export type Repeat = z.infer<typeof repeatSchema>;

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const MAX_DAYS = 400;
const compact = (iso: string) => iso.replaceAll('-', '');
const dow = (iso: string) => new Date(iso + 'T00:00:00Z').getUTCDay();

/** Days from `from` to `until` (inclusive) on which the moon rule matches. At most about a year ahead. */
export function moonDates(rule: MoonRule, from: string, until: string): string[] {
	const out: string[] = [];
	const last = [until, addDaysIso(from, MAX_DAYS)].sort()[0];
	for (let d = from; d <= last; d = addDaysIso(d, 1)) {
		if (matchesMoonRule(Date.parse(d) / DAY_MS, rule)) out.push(d);
	}
	return out;
}

/** First date (from `from` on) the repeat applies to, or null when there is none */
export function firstOccurrence(r: Repeat, from: string): string | null {
	if (r.kind === 'moon') return moonDates(r, from, r.until)[0] ?? null;
	for (let d = from, i = 0; i < 7; d = addDaysIso(d, 1), i++) if (r.weekdays.includes(dow(d))) return d;
	return null;
}

/** Start date and `recurrence` lines for a new event, or null when the rule never matches. */
export function buildRecurrence(r: Repeat, from: string, allDay: boolean, startTime = '00:00'): { start: string; recurrence: string[] } | null {
	const start = firstOccurrence(r, from);
	if (!start) return null;
	if (r.kind === 'weekly') {
		const until = r.until ? `;UNTIL=${compact(r.until)}${allDay ? '' : 'T235959Z'}` : '';
		const days = [...new Set(r.weekdays)].sort().map((d) => BYDAY[d]).join(',');
		return { start, recurrence: [`RRULE:FREQ=WEEKLY;BYDAY=${days}${until}`] };
	}
	const rest = moonDates(r, start, r.until).slice(1);
	const time = `T${startTime.replace(':', '')}00`;
	const line = allDay ? `RDATE;VALUE=DATE:${rest.map(compact).join(',')}` : `RDATE;TZID=${TIME_ZONE}:${rest.map((d) => compact(d) + time).join(',')}`;
	return { start, recurrence: rest.length ? [line] : [] };
}
