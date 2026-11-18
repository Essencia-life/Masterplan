import { isoToDay, toMinutes } from '#lib/time';
import type { CalEvent } from '#lib/types';

/** Time span in wall-clock minutes: exact for timed events, whole days for all-day ones (end exclusive). */
export const spanOf = (e: CalEvent): [number, number] =>
	e.fromLocal && e.toLocal
		? [toMinutes(e.fromLocal.slice(0, 10), e.fromLocal.slice(11)), toMinutes(e.toLocal.slice(0, 10), e.toLocal.slice(11))]
		: [isoToDay(e.start) * 1440, isoToDay(e.end) * 1440];

export const overlaps = (e: CalEvent, [from, to]: [number, number]) => {
	const [a, b] = spanOf(e);
	return a < to && b > from;
};
