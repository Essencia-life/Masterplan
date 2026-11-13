import { describe, expect, it } from 'vitest';
import { buildRecurrence, firstOccurrence, moonDates } from './recurrence';

describe('weekly', () => {
	it('starts on the first matching weekday and lists the days', () => {
		// 2026-11-13 is a Friday
		const r = buildRecurrence({ kind: 'weekly', weekdays: [3, 1] }, '2026-11-13', false, '07:00');
		expect(r).toEqual({ start: '2026-11-16', recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,WE'] });
	});
	it('ends on the day for all-day events and at the end of the day (UTC) for timed ones', () => {
		expect(buildRecurrence({ kind: 'weekly', weekdays: [1], until: '2026-12-31' }, '2026-11-02', true)!.recurrence[0]).toContain('UNTIL=20261231;'.slice(0, -1));
		expect(buildRecurrence({ kind: 'weekly', weekdays: [1], until: '2026-12-31' }, '2026-11-02', false)!.recurrence[0]).toContain('UNTIL=20261231T235959Z');
	});
});

describe('moon', () => {
	const rule = { kind: 'moon', phase: 'FULL_MOON', relation: 'LAST_BEFORE', weekday: 5, until: '2027-06-30' } as const;
	it('finds about one Friday per month, always a Friday', () => {
		const dates = moonDates(rule, '2026-11-13', rule.until);
		expect(dates.length).toBeGreaterThanOrEqual(7);
		expect(dates.length).toBeLessThanOrEqual(9);
		for (const d of dates) expect(new Date(d + 'T00:00:00Z').getUTCDay()).toBe(5);
	});
	it('lists every date after the first as RDATE', () => {
		const r = buildRecurrence(rule, '2026-11-13', false, '19:00')!;
		const all = moonDates(rule, '2026-11-13', rule.until);
		expect(r.start).toBe(all[0]);
		expect(r.recurrence[0]).toBe(`RDATE;TZID=Europe/Lisbon:${all.slice(1).map((d) => d.replaceAll('-', '') + 'T190000').join(',')}`);
		expect(buildRecurrence(rule, '2026-11-13', true)!.recurrence[0]).toMatch(/^RDATE;VALUE=DATE:\d{8}(,\d{8})+$/);
	});
	it('is null when nothing matches', () => {
		expect(firstOccurrence({ ...rule, until: '2026-11-14' }, '2026-11-13')).toBeNull();
	});
});
