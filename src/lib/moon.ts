import { REF_NEW_MOON, SYNODIC } from './time';

/**
 * "The Friday before the full moon" style rules, on the same moon model as the timeline view
 * (mean synodic month from a reference new moon). Same dates the Telegram bot used.
 * Days are UTC day numbers (days since 1970-01-01).
 */
export const MOON_PHASES = ['NEW_MOON', 'FIRST_QUARTER', 'FULL_MOON', 'LAST_QUARTER'] as const;
export const MOON_RELATIONS = ['EXACT', 'LAST_BEFORE', 'LAST_ON_OR_BEFORE', 'FIRST_AFTER', 'FIRST_ON_OR_AFTER'] as const;
export type MoonPhase = (typeof MOON_PHASES)[number];
export type MoonRelation = (typeof MOON_RELATIONS)[number];
export type MoonRule = { phase: MoonPhase; relation: MoonRelation; weekday: number };

const dow = (day: number) => (((day + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday

/** UTC days on which the phase starts, around `day` */
function phaseDays(phase: MoonPhase, day: number) {
	const frac = MOON_PHASES.indexOf(phase) / 4;
	const k = Math.floor((day - REF_NEW_MOON) / SYNODIC - frac);
	return [k - 1, k, k + 1, k + 2].map((i) => Math.floor(REF_NEW_MOON + (i + frac) * SYNODIC));
}

export function matchesMoonRule(day: number, { phase, relation, weekday }: MoonRule): boolean {
	if (dow(day) !== weekday) return false;
	if (relation === 'EXACT') {
		// the phase "lasts" an eighth of a month from its start, measured at the start of the day
		const age = (((day - REF_NEW_MOON) % SYNODIC) + SYNODIC) % SYNODIC;
		return Math.floor(age / (SYNODIC / 8)) === MOON_PHASES.indexOf(phase) * 2;
	}
	const inclusive = relation.endsWith('ON_OR_BEFORE') || relation.endsWith('ON_OR_AFTER');
	const days = phaseDays(phase, day);
	if (relation.startsWith('LAST')) {
		// the nearest weekday before the next phase start
		const next = Math.min(...days.filter((t) => (inclusive ? t >= day : t > day)));
		const from = inclusive ? next : next - 1;
		return day === from - ((dow(from) - weekday + 7) % 7);
	}
	const prev = Math.max(...days.filter((t) => (inclusive ? t <= day : t < day)));
	const from = inclusive ? prev : prev + 1;
	return day === from + ((weekday - dow(from) + 7) % 7);
}
