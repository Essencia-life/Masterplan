import { describe, expect, it } from 'vitest';
import { overlaps } from './conflicts';
import { isoToDay, toMinutes } from './time';
import type { CalEvent } from './types';

const ev = (over: Partial<CalEvent>): CalEvent => ({ id: 'e', rowId: 'r', linkId: 'l', title: 't', start: '2026-11-20', end: '2026-11-22', status: 'confirmed', description: '', ...over });

describe('overlaps', () => {
	it('whole days: the end day is free', () => {
		const span: [number, number] = [isoToDay('2026-11-22') * 1440, isoToDay('2026-11-24') * 1440];
		expect(overlaps(ev({}), span)).toBe(false);
		expect(overlaps(ev({ end: '2026-11-23' }), span)).toBe(true);
	});
	it('timed events compare the exact times', () => {
		const day = '2026-11-20';
		const e = ev({ start: day, end: day, fromLocal: `${day}T09:00`, toLocal: `${day}T11:00` });
		expect(overlaps(e, [toMinutes(day, '11:00'), toMinutes(day, '12:00')])).toBe(false);
		expect(overlaps(e, [toMinutes(day, '10:30'), toMinutes(day, '12:00')])).toBe(true);
	});
});
