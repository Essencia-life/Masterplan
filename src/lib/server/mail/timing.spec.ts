import { describe, expect, it } from 'vitest';
import { isDue } from './timing';

const today = '2026-11-16';

describe('isDue before arrival', () => {
	const t = { days: 3, when: 'before' as const };
	it('is due from N days before the first day until it starts', () => {
		expect(isDue(t, today, '2026-11-19', '2026-11-22')).toBe(true);
		expect(isDue(t, today, '2026-11-16', '2026-11-18')).toBe(true);
	});
	it('is not due earlier, and not for bookings that have started', () => {
		expect(isDue(t, today, '2026-11-20', '2026-11-22')).toBe(false);
		expect(isDue(t, today, '2026-11-15', '2026-11-20')).toBe(false);
	});
});

describe('isDue after departure', () => {
	const t = { days: 1, when: 'after' as const };
	it('is due the day after the last day', () => {
		expect(isDue(t, today, '2026-11-10', '2026-11-15')).toBe(true);
	});
	it('is not due while the stay goes on', () => {
		expect(isDue(t, today, '2026-11-10', '2026-11-16')).toBe(false);
		expect(isDue(t, today, '2026-11-10', '2026-11-20')).toBe(false);
	});
	it('catches up a missed run for a week, but not for older stays', () => {
		expect(isDue(t, today, '2026-11-01', '2026-11-10')).toBe(true);
		expect(isDue(t, today, '2026-11-01', '2026-11-07')).toBe(false);
	});
});
