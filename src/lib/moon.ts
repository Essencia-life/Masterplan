/**
 * Moon phases and "the Friday before the full moon" style rules.
 * Ported from the TelegramBots repo (lunar-provider.ts + lunar-matching.ts); days are UTC calendar days,
 * which is what the bot computed on Vercel. The phase times are an approximation (mean synodic month).
 */

export type MoonPhase =
	| 'NEW_MOON'
	| 'WAXING_CRESCENT'
	| 'FIRST_QUARTER'
	| 'WAXING_GIBBOUS'
	| 'FULL_MOON'
	| 'WANING_GIBBOUS'
	| 'LAST_QUARTER'
	| 'WANING_CRESCENT';

export type MoonPhaseTransition = {
	phase: MoonPhase;
	at: Date;
};

export interface LunarProvider {
	/**
	 * Liefert die Mondphase für den gegebenen Zeitpunkt/Tag.
	 * Für EXACT/NOT_EXACT wird damit gematcht.
	 */
	getPhaseAt(date: Date): MoonPhase;

	/**
	 * Liefert alle Phasenwechsel im Zeitraum.
	 * Wichtig: Wenn du Relations wie LAST_BEFORE/FIRST_AFTER sauber abdecken willst,
	 * sollte der Provider idealerweise alle 8 Phasenwechsel liefern.
	 */
	getPhaseTransitions(start: Date, end: Date): MoonPhaseTransition[];
}

const SYNODIC_MONTH = 29.530588853;
const SYNODIC_MONTH_MS = SYNODIC_MONTH * 24 * 60 * 60 * 1000;

/**
 * Bekannter Referenz-Neumond:
 * 2000-01-06T18:14:00Z
 *
 * Das ist die Basis für die Näherung.
 */
const KNOWN_NEW_MOON_UTC_MS = Date.UTC(2000, 0, 6, 18, 14, 0, 0);

const PHASE_FRACTIONS: Array<{ phase: MoonPhase; fraction: number }> = [
	{ phase: 'NEW_MOON', fraction: 0 / 8 },
	{ phase: 'WAXING_CRESCENT', fraction: 1 / 8 },
	{ phase: 'FIRST_QUARTER', fraction: 2 / 8 },
	{ phase: 'WAXING_GIBBOUS', fraction: 3 / 8 },
	{ phase: 'FULL_MOON', fraction: 4 / 8 },
	{ phase: 'WANING_GIBBOUS', fraction: 5 / 8 },
	{ phase: 'LAST_QUARTER', fraction: 6 / 8 },
	{ phase: 'WANING_CRESCENT', fraction: 7 / 8 }
];

function normalizeModulo(value: number, mod: number): number {
	return ((value % mod) + mod) % mod;
}

function startOfLocalDay(date: Date): Date {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addMs(date: Date, ms: number): Date {
	return new Date(date.getTime() + ms);
}

function phaseIndexFromAgeDays(ageDays: number): number {
	const segmentLength = SYNODIC_MONTH / 8;
	return Math.floor(normalizeModulo(ageDays, SYNODIC_MONTH) / segmentLength) % 8;
}

function phaseFromIndex(index: number): MoonPhase {
	return PHASE_FRACTIONS[index]!.phase;
}

function moonAgeDays(date: Date): number {
	const diffMs = date.getTime() - KNOWN_NEW_MOON_UTC_MS;
	return normalizeModulo(diffMs / (24 * 60 * 60 * 1000), SYNODIC_MONTH);
}

function cycleNumberAt(date: Date): number {
	const diffMs = date.getTime() - KNOWN_NEW_MOON_UTC_MS;
	return Math.floor(diffMs / SYNODIC_MONTH_MS);
}

function transitionDateForCycle(cycle: number, fraction: number): Date {
	return new Date(KNOWN_NEW_MOON_UTC_MS + (cycle + fraction) * SYNODIC_MONTH_MS);
}

export class ApproximateLunarProvider implements LunarProvider {
	getPhaseAt(date: Date): MoonPhase {
		const day = startOfLocalDay(date);
		const age = moonAgeDays(day);
		const index = phaseIndexFromAgeDays(age);
		return phaseFromIndex(index);
	}

	getPhaseTransitions(start: Date, end: Date): MoonPhaseTransition[] {
		const from = start.getTime();
		const to = end.getTime();

		if (to < from) {
			return [];
		}

		const startCycle = cycleNumberAt(addMs(start, -SYNODIC_MONTH_MS));
		const endCycle = cycleNumberAt(addMs(end, SYNODIC_MONTH_MS));

		const transitions: MoonPhaseTransition[] = [];

		for (let cycle = startCycle; cycle <= endCycle; cycle++) {
			for (const entry of PHASE_FRACTIONS) {
				const at = transitionDateForCycle(cycle, entry.fraction);
				const t = at.getTime();

				if (t >= from && t <= to) {
					transitions.push({
						phase: entry.phase,
						at
					});
				}
			}
		}

		transitions.sort((a, b) => a.at.getTime() - b.at.getTime());
		return transitions;
	}
}

const defaultProvider = new ApproximateLunarProvider();


export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // wie Date.getUTCDay()

export type LunarRelation =
	| 'EXACT'
	| 'NOT_EXACT'
	| 'LAST_BEFORE'
	| 'NOT_LAST_BEFORE'
	| 'LAST_ON_OR_BEFORE'
	| 'NOT_LAST_ON_OR_BEFORE'
	| 'FIRST_AFTER'
	| 'NOT_FIRST_AFTER'
	| 'FIRST_ON_OR_AFTER'
	| 'NOT_FIRST_ON_OR_AFTER';

export type EventRule = {
	weekday: Weekday;
	phase: MoonPhase;
	relation: LunarRelation;
};

/* =========================
 * Date helpers
 * ========================= */


function addDays(date: Date, days: number): Date {
	const d = new Date(date);
	d.setUTCDate(d.getUTCDate() + days);
	return d;
}

function isSameLocalDay(a: Date, b: Date): boolean {
	return (
		a.getUTCFullYear() === b.getUTCFullYear() &&
		a.getUTCMonth() === b.getUTCMonth() &&
		a.getUTCDate() === b.getUTCDate()
	);
}

function isBeforeLocalDay(a: Date, b: Date): boolean {
	return startOfLocalDay(a).getTime() < startOfLocalDay(b).getTime();
}

function isAfterLocalDay(a: Date, b: Date): boolean {
	return startOfLocalDay(a).getTime() > startOfLocalDay(b).getTime();
}

function isOnOrBeforeLocalDay(a: Date, b: Date): boolean {
	return startOfLocalDay(a).getTime() <= startOfLocalDay(b).getTime();
}

function isOnOrAfterLocalDay(a: Date, b: Date): boolean {
	return startOfLocalDay(a).getTime() >= startOfLocalDay(b).getTime();
}

function matchesWeekday(date: Date, weekday?: Weekday): boolean {
	return weekday == null || date.getUTCDay() === weekday;
}

function moveBackwardToWeekday(from: Date, weekday: Weekday, inclusive: boolean): Date {
	let d = startOfLocalDay(from);

	if (!inclusive) {
		d = addDays(d, -1);
	}

	while (d.getUTCDay() !== weekday) {
		d = addDays(d, -1);
	}

	return d;
}

function moveForwardToWeekday(from: Date, weekday: Weekday, inclusive: boolean): Date {
	let d = startOfLocalDay(from);

	if (!inclusive) {
		d = addDays(d, 1);
	}

	while (d.getUTCDay() !== weekday) {
		d = addDays(d, 1);
	}

	return d;
}

/* =========================
 * Phase lookup helpers
 * ========================= */

function getTransitionsForPhase(
	provider: LunarProvider,
	phase: MoonPhase,
	aroundDate: Date,
	windowDays = 60
): MoonPhaseTransition[] {
	const start = addDays(startOfLocalDay(aroundDate), -windowDays);
	const end = addDays(startOfLocalDay(aroundDate), windowDays);

	return provider
		.getPhaseTransitions(start, end)
		.filter((t) => t.phase === phase)
		.sort((a, b) => a.at.getTime() - b.at.getTime());
}

function findNextPhaseTransition(
	provider: LunarProvider,
	phase: MoonPhase,
	fromDate: Date,
	inclusive: boolean
): MoonPhaseTransition | null {
	const transitions = getTransitionsForPhase(provider, phase, fromDate);

	for (const t of transitions) {
		const ok = inclusive ? isOnOrAfterLocalDay(t.at, fromDate) : isAfterLocalDay(t.at, fromDate);

		if (ok) return t;
	}

	return null;
}

function findPreviousPhaseTransition(
	provider: LunarProvider,
	phase: MoonPhase,
	fromDate: Date,
	inclusive: boolean
): MoonPhaseTransition | null {
	const transitions = getTransitionsForPhase(provider, phase, fromDate);

	for (let i = transitions.length - 1; i >= 0; i--) {
		const t = transitions[i];
		const ok = inclusive ? isOnOrBeforeLocalDay(t.at, fromDate) : isBeforeLocalDay(t.at, fromDate);

		if (ok) return t;
	}

	return null;
}

/* =========================
 * Core matchers
 * ========================= */

function matchExactPhase(date: Date, phase: MoonPhase, provider: LunarProvider): boolean {
	return provider.getPhaseAt(date) === phase;
}

function matchLastBefore(
	date: Date,
	weekday: Weekday,
	phase: MoonPhase,
	provider: LunarProvider
): boolean {
	if (date.getUTCDay() !== weekday) return false;

	const nextPhase = findNextPhaseTransition(provider, phase, date, false);
	if (!nextPhase) return false;

	const target = moveBackwardToWeekday(nextPhase.at, weekday, false);
	return isSameLocalDay(date, target);
}

function matchLastOnOrBefore(
	date: Date,
	weekday: Weekday,
	phase: MoonPhase,
	provider: LunarProvider
): boolean {
	if (date.getUTCDay() !== weekday) return false;

	const nextOrSamePhase = findNextPhaseTransition(provider, phase, date, true);
	if (!nextOrSamePhase) return false;

	const target = moveBackwardToWeekday(nextOrSamePhase.at, weekday, true);
	return isSameLocalDay(date, target);
}

function matchFirstAfter(
	date: Date,
	weekday: Weekday,
	phase: MoonPhase,
	provider: LunarProvider
): boolean {
	if (date.getUTCDay() !== weekday) return false;

	const previousPhase = findPreviousPhaseTransition(provider, phase, date, false);
	if (!previousPhase) return false;

	const target = moveForwardToWeekday(previousPhase.at, weekday, false);
	return isSameLocalDay(date, target);
}

function matchFirstOnOrAfter(
	date: Date,
	weekday: Weekday,
	phase: MoonPhase,
	provider: LunarProvider
): boolean {
	if (date.getUTCDay() !== weekday) return false;

	const previousOrSamePhase = findPreviousPhaseTransition(provider, phase, date, true);
	if (!previousOrSamePhase) return false;

	const target = moveForwardToWeekday(previousOrSamePhase.at, weekday, true);
	return isSameLocalDay(date, target);
}

/* =========================
 * Public API
 * ========================= */

export function matchesRelationToLunarPhase(
	date: Date,
	rule: EventRule,
	provider: LunarProvider = defaultProvider
): boolean {
	const day = startOfLocalDay(date);
	const { weekday, phase, relation } = rule;

	switch (relation) {
		case 'EXACT':
			return matchesWeekday(day, weekday) && matchExactPhase(day, phase, provider);

		case 'NOT_EXACT':
			return matchesWeekday(day, weekday) && !matchExactPhase(day, phase, provider);

		case 'LAST_BEFORE':
			if (weekday == null) return false;
			return matchLastBefore(day, weekday, phase, provider);

		case 'NOT_LAST_BEFORE':
			if (!matchesWeekday(day, weekday)) return false;
			if (weekday == null) return false;
			return !matchLastBefore(day, weekday, phase, provider);

		case 'LAST_ON_OR_BEFORE':
			if (weekday == null) return false;
			return matchLastOnOrBefore(day, weekday, phase, provider);

		case 'NOT_LAST_ON_OR_BEFORE':
			if (!matchesWeekday(day, weekday)) return false;
			if (weekday == null) return false;
			return !matchLastOnOrBefore(day, weekday, phase, provider);

		case 'FIRST_AFTER':
			if (weekday == null) return false;
			return matchFirstAfter(day, weekday, phase, provider);

		case 'NOT_FIRST_AFTER':
			if (!matchesWeekday(day, weekday)) return false;
			if (weekday == null) return false;
			return !matchFirstAfter(day, weekday, phase, provider);

		case 'FIRST_ON_OR_AFTER':
			if (weekday == null) return false;
			return matchFirstOnOrAfter(day, weekday, phase, provider);

		case 'NOT_FIRST_ON_OR_AFTER':
			if (!matchesWeekday(day, weekday)) return false;
			if (weekday == null) return false;
			return !matchFirstOnOrAfter(day, weekday, phase, provider);

		default: {
			throw new Error(`Unsupported relation: ${relation}`);
		}
	}
}
