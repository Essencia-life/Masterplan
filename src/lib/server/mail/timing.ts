import * as z from 'zod';
import { addDaysIso } from '#lib/time';

/** when to send: `days` before the arrival or after the departure (bookings made later get it with the next run) */
export const timingSchema = z.object({ days: z.number().int().min(0).max(60), when: z.enum(['before', 'after']) }).default({ days: 3, when: 'before' });
export type Timing = z.infer<typeof timingSchema>;

/** a mail that was due longer ago is not sent any more (a missed cron run must not mail old guests) */
export const CATCH_UP_DAYS = 7;

/** Is a template's mail due `today` for a booking from `first` to `last` day (inclusive, ISO dates)? */
export function isDue(timing: Timing, today: string, first: string, last: string) {
	if (timing.when === 'before') return first >= today && first <= addDaysIso(today, timing.days);
	const due = addDaysIso(last, timing.days);
	return due <= today && due >= addDaysIso(today, -CATCH_UP_DAYS);
}
