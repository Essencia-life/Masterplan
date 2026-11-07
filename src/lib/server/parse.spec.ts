import { describe, expect, it } from 'vitest';
import { dayOf, eventRange, localDay, localTime, normalize, parseCalendarName, parseResourceName } from './parse';

describe('parseResourceName', () => {
	it('reads group, floor and name and drops the capacity', () => {
		expect(parseResourceName('Farmhouse-1-Room 5 (4)')).toEqual({ group: 'Farmhouse', floor: '1', name: 'Room 5' });
	});
	it('keeps dashes inside the name', () => {
		expect(parseResourceName('Farmhouse-0-Big-Hall (50)')).toEqual({ group: 'Farmhouse', floor: '0', name: 'Big-Hall' });
	});
	it('works without floor', () => {
		expect(parseResourceName('Garden-Yurt (12)')).toEqual({ group: 'Garden', floor: '', name: 'Yurt' });
	});
	it('falls back to the group "Other"', () => {
		expect(parseResourceName('Projector')).toEqual({ group: 'Other', floor: '', name: 'Projector' });
	});
});

describe('parseCalendarName', () => {
	it('splits Group/Name', () => {
		expect(parseCalendarName('Programme/Retreats')).toEqual({ group: 'Programme', name: 'Retreats' });
		expect(parseCalendarName('A/B/C')).toEqual({ group: 'A', name: 'B/C' });
	});
	it('rejects names without the scheme', () => {
		expect(parseCalendarName('Birthdays')).toBeNull();
		expect(parseCalendarName('/x')).toBeNull();
		expect(parseCalendarName('x/')).toBeNull();
	});
});

describe('time zone', () => {
	it('uses Europe/Lisbon wall-clock time for any offset', () => {
		// summer: UTC+1
		expect(localDay('2026-07-10T23:30:00Z')).toBe('2026-07-11');
		expect(localTime('2026-07-10T23:30:00Z')).toBe('00:30');
		// the same instant written with another offset
		expect(localDay('2026-07-11T01:30:00+02:00')).toBe('2026-07-11');
		// winter: UTC+0
		expect(localDay('2026-01-10T23:30:00Z')).toBe('2026-01-10');
	});
	it('does not shift all-day dates', () => {
		expect(dayOf({ date: '2026-04-01' })).toBe('2026-04-01');
	});
});

describe('eventRange / normalize', () => {
	it('all-day events keep Google’s exclusive end', () => {
		expect(eventRange({ start: { date: '2026-04-01' }, end: { date: '2026-04-04' } })).toEqual(['2026-04-01', '2026-04-04']);
	});
	it('a timed event ending at midnight does not occupy the next day', () => {
		const e = { start: { dateTime: '2026-04-01T10:00:00+01:00' }, end: { dateTime: '2026-04-03T00:00:00+01:00' } };
		expect(eventRange(e)).toEqual(['2026-04-01', '2026-04-03']);
	});
	it('a timed event ending during a day occupies that day', () => {
		const e = { start: { dateTime: '2026-04-01T10:00:00+01:00' }, end: { dateTime: '2026-04-03T11:00:00+01:00' } };
		expect(eventRange(e)).toEqual(['2026-04-01', '2026-04-04']);
	});
	it('a same-day timed event spans one day', () => {
		const e = { start: { dateTime: '2026-04-01T10:00:00+01:00' }, end: { dateTime: '2026-04-01T12:00:00+01:00' } };
		expect(eventRange(e)).toEqual(['2026-04-01', '2026-04-02']);
	});

	const base = { id: 'e1', summary: 'Retreat', start: { date: '2026-04-01' }, end: { date: '2026-04-03' } };
	it('skips cancelled events', () => {
		expect(normalize({ ...base, status: 'cancelled' }, 'x@group.calendar.google.com')).toBeNull();
	});
	it('hides room bookings the room declined, but flags them in the event calendar', () => {
		const room = 'room@resource.calendar.google.com';
		const e = { ...base, attendees: [{ email: room, resource: true, responseStatus: 'declined' }] };
		expect(normalize(e, room)).toBeNull();
		expect(normalize(e, 'cal@group.calendar.google.com')?.declinedRooms).toEqual([room]);
	});
	it('links resource copies through iCalUID', () => {
		expect(normalize({ ...base, iCalUID: 'uid-1' }, 'cal@group.calendar.google.com')?.linkId).toBe('uid-1');
	});
	it('adds local start/end for timed events', () => {
		const e = { ...base, start: { dateTime: '2026-04-01T10:00:00+01:00' }, end: { dateTime: '2026-04-01T12:00:00+01:00' } };
		const n = normalize(e, 'cal@group.calendar.google.com');
		expect(n?.fromLocal).toBe('2026-04-01T10:00');
		expect(n?.toLocal).toBe('2026-04-01T12:00');
	});
});
