import { describe, expect, it } from 'vitest';
import { addDaysIso, dayToIso, exclusiveEndIso, isoToDay, moonKey, toMinutes } from './time';

describe('day maths', () => {
	it('converts between ISO dates and day numbers', () => {
		expect(dayToIso(isoToDay('2026-03-08'))).toBe('2026-03-08');
		expect(isoToDay('2026-03-09') - isoToDay('2026-03-08')).toBe(1);
	});

	it('is not affected by daylight saving changes', () => {
		expect(isoToDay('2026-03-30') - isoToDay('2026-03-28')).toBe(2);
		expect(addDaysIso('2026-03-28', 2)).toBe('2026-03-30');
	});

	it('counts wall-clock minutes', () => {
		expect(toMinutes('2026-05-02', '10:30') - toMinutes('2026-05-01', '10:30')).toBe(1440);
		expect(toMinutes('2026-05-01', '00:00') % 1440).toBe(0);
	});
});

describe('exclusiveEndIso', () => {
	it('occupies the end day for a timed event', () => {
		expect(exclusiveEndIso('2026-05-01', '2026-05-03', '18:00')).toBe('2026-05-04');
	});
	it('does not occupy the end day when a multi-day event ends at midnight', () => {
		expect(exclusiveEndIso('2026-05-01', '2026-05-03', '00:00')).toBe('2026-05-03');
	});
	it('a same-day event ending at 00:00 still occupies its day', () => {
		expect(exclusiveEndIso('2026-05-01', '2026-05-01', '00:00')).toBe('2026-05-02');
	});
	it('all-day ends (no time) include the end day', () => {
		expect(exclusiveEndIso('2026-05-01', '2026-05-01', null)).toBe('2026-05-02');
	});
});

describe('moon', () => {
	// mean synodic month: accurate to about a day, which is enough for highlighting
	it('highlights the new and full moon of January 2024 (11th / 25th)', () => {
		expect(moonKey(isoToDay('2024-01-11'))).toBe('New moon');
		const full = ['2024-01-25', '2024-01-26'].filter((d) => moonKey(isoToDay(d)) === 'Full moon');
		expect(full.length).toBe(1);
		expect(moonKey(isoToDay('2024-01-18'))).toBe('');
	});
});
