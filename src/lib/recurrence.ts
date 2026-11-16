import * as z from 'zod';
import { MOON_PHASES, MOON_RELATIONS, matchesMoonRule, type MoonRule } from './moon';
import { DAY_MS, TIME_ZONE, addDaysIso } from './time';

/** How a new event repeats. Weekly becomes an RRULE; moon rules have no RRULE, so the dates are listed (RDATE). */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const weekday = z.number().int().min(0).max(6); // 0 = Sunday, like Date.getUTCDay()

export const repeatSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('weekly'), interval: z.number().int().min(1).max(8).default(1), weekdays: z.array(weekday).min(1).max(7), until: isoDate.optional() }),
	z.object({ kind: z.literal('moon'), phase: z.enum(MOON_PHASES), relation: z.enum(MOON_RELATIONS), weekday, until: isoDate })
]);
export type Repeat = z.infer<typeof repeatSchema>;

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
// about two years; a longer moon series loses its oldest dates when it is changed (shortcut, extend when needed)
const MAX_DAYS = 800;
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
		const every = r.interval > 1 ? `;INTERVAL=${r.interval}` : '';
		return { start, recurrence: [`RRULE:FREQ=WEEKLY${every};BYDAY=${days}${until}`] };
	}
	const rest = moonDates(r, start, r.until).slice(1);
	const time = `T${startTime.replace(':', '')}00`;
	const line = allDay ? `RDATE;VALUE=DATE:${rest.map(compact).join(',')}` : `RDATE;TZID=${TIME_ZONE}:${rest.map((d) => compact(d) + time).join(',')}`;
	return { start, recurrence: rest.length ? [line] : [] };
}

/**
 * What a series' recurrence lines mean in the UI. Only what this app writes is understood:
 * a plain weekly rule, or a moon rule (stored as private property `repeat`, with the dates as RDATE).
 * Anything else comes back as `custom` and is left untouched.
 */
export function parseRecurrence(lines: string[], moonProp?: string | null): { repeat?: Repeat; custom: string[] } {
	const rules = lines.filter((l) => l.startsWith('RRULE:'));
	if (lines.length && !rules.length && lines.every((l) => l.startsWith('RDATE')) && moonProp) {
		try {
			const r = repeatSchema.safeParse(JSON.parse(moonProp));
			if (r.success && r.data.kind === 'moon') return { repeat: r.data, custom: [] };
		} catch {
			// not ours
		}
	}
	if (lines.length === 1 && rules.length === 1) {
		const kv = Object.fromEntries(rules[0].slice(6).split(';').map((p) => p.split('=')));
		const days = (kv.BYDAY ?? '').split(',');
		const simple = Object.keys(kv).every((k) => ['FREQ', 'BYDAY', 'UNTIL', 'INTERVAL', 'WKST'].includes(k));
		if (simple && kv.FREQ === 'WEEKLY' && /^[1-8]$/.test(kv.INTERVAL ?? '1') && days.every((d) => BYDAY.includes(d)) && (!kv.UNTIL || /^\d{8}(T\d{6}Z)?$/.test(kv.UNTIL))) {
			const u = kv.UNTIL;
			return { repeat: { kind: 'weekly', interval: Number(kv.INTERVAL ?? 1), weekdays: days.map((d) => BYDAY.indexOf(d)), until: u && `${u.slice(0, 4)}-${u.slice(4, 6)}-${u.slice(6, 8)}` }, custom: [] };
		}
	}
	return { custom: lines };
}

// ---------- splitting a series ("this and following events") ----------

const isoOf = (v: string) => `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;

/** An RDATE/EXDATE line with only the dates `keep` accepts (and the time replaced, HHMMSS); null when none are left. */
function filterDates(line: string, keep: (isoDate: string) => boolean, time?: string): string | null {
	const i = line.indexOf(':');
	const values = line.slice(i + 1).split(',').filter((v) => keep(isoOf(v)));
	if (!values.length) return null;
	return `${line.slice(0, i + 1)}${values.map((v) => (time && v.length > 8 && !v.endsWith('Z') ? `${v.slice(0, 9)}${time}` : v)).join(',')}`;
}

/** The part of a series that stays: it ends the day before `day`. */
export function linesBefore(lines: string[], day: string, allDay: boolean): string[] {
	const last = compact(addDaysIso(day, -1));
	return lines.flatMap((l) => {
		if (l.startsWith('RRULE:')) {
			const parts = l.split(';').filter((p) => !p.startsWith('COUNT=') && !p.startsWith('UNTIL='));
			const old = l.split(';').find((p) => p.startsWith('UNTIL='))?.slice(6, 14);
			return [[...parts, `UNTIL=${old && old < last ? old : last}${allDay ? '' : 'T235959Z'}`].join(';')];
		}
		return (l.startsWith('RDATE') || l.startsWith('EXDATE') ? filterDates(l, (d) => d < day) : l) ?? [];
	});
}

/** The part of a series that moves to a new series starting on `day`; null for rules this cannot split (COUNT). */
export function linesFrom(lines: string[], day: string, time?: string): string[] | null {
	if (lines.some((l) => l.startsWith('RRULE:') && /;COUNT=/.test(l))) return null;
	return lines.flatMap((l) => {
		if (l.startsWith('RDATE')) return filterDates(l, (d) => d > day, time) ?? []; // `day` itself is the new series' first event
		if (l.startsWith('EXDATE')) return filterDates(l, (d) => d >= day) ?? [];
		return [l];
	});
}
