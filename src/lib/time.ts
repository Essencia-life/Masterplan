export const DAY_MS = 86_400_000;
/** The one time zone of the app: everything shown and written is wall-clock time here, for server and browser alike. */
export const TIME_ZONE = 'Europe/Lisbon';

/** today's date (YYYY-MM-DD) in TIME_ZONE */
const todayIso = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const epochDay = (iso: string) => Math.round(Date.parse(iso + 'T00:00:00Z') / DAY_MS);

/** epoch day of the first timeline day (1 Jan of last year) */
export const BASE = Date.UTC(Number(todayIso.slice(0, 4)) - 1, 0, 1) / DAY_MS;
export const N_DAYS = 1500;
export const TODAY = epochDay(todayIso) - BASE;

/** minutes since BASE midnight for a local date + 'HH:mm' (wall clock, no time zone maths) */
export const toMinutes = (isoDate: string, hhmm = '00:00') => {
	const [h, m] = hhmm.split(':').map(Number);
	return isoToDay(isoDate) * 1440 + h * 60 + m;
};

export const dayToDate = (i: number) => new Date((BASE + i) * DAY_MS);
export const dayToIso = (i: number) => dayToDate(i).toISOString().slice(0, 10);
export const isoToDay = (iso: string) => Math.round(Date.parse(iso.slice(0, 10) + 'T00:00:00Z') / DAY_MS) - BASE;
export const addDaysIso = (iso: string, n: number) => new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY_MS).toISOString().slice(0, 10);

/**
 * First day NOT occupied by an event (exclusive end). A timed event that ends exactly at 00:00 on a later
 * day does not occupy that day; otherwise the end day is occupied. One rule for server and panel.
 */
export function exclusiveEndIso(startDate: string, endDate: string, endTime: string | null) {
	return endTime === '00:00' && endDate > startDate ? endDate : addDaysIso(endDate, 1);
}

export const clampDay = (i: number) => Math.max(0, Math.min(N_DAYS - 1, i));

const SYNODIC = 29.530588853;
const REF_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14) / DAY_MS;

/** 0..1 — 0 new moon, 0.5 full moon. Evaluated at local noon of the day. */
export function moonPhase(day: number) {
	const t = BASE + day + 0.5;
	const f = ((t - REF_NEW_MOON) / SYNODIC) % 1;
	return f < 0 ? f + 1 : f;
}

/** "New moon" / "Full moon" on the day the phase is exact (within half a day), otherwise '' */
export function moonKey(day: number) {
	const f = moonPhase(day);
	const h = 0.5 / SYNODIC;
	if (f < h || f > 1 - h) return 'New moon';
	if (Math.abs(f - 0.5) < h) return 'Full moon';
	return '';
}

/** SVG path for the lit part of the moon disc (northern hemisphere), r = radius around (0,0). */
export function moonPath(f: number, r = 8) {
	const k = Math.cos(2 * Math.PI * f);
	if (Math.abs(k) > 0.985) return k < 0 ? 'full' : 'new';
	const waxing = f < 0.5;
	const rx = (Math.abs(k) * r).toFixed(2);
	const first = waxing ? 1 : 0;
	const back = waxing ? (k > 0 ? 0 : 1) : k > 0 ? 1 : 0;
	return `M0 ${-r}A${r} ${r} 0 0 ${first} 0 ${r}A${rx} ${r} 0 0 ${back} 0 ${-r}Z`;
}
