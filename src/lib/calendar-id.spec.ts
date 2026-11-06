import { describe, expect, it } from 'vitest';
import { calendarIdFromSlug, calendarSlug, isResourceId } from './calendar-id';

describe('calendar ids in URLs', () => {
	it('drops the group calendar suffix and restores it', () => {
		const id = 'abc123@group.calendar.google.com';
		expect(calendarSlug(id)).toBe('abc123');
		expect(calendarIdFromSlug('abc123')).toBe(id);
	});

	it('keeps other ids (with their @) intact', () => {
		const id = 'someone@essencia.life';
		expect(calendarSlug(id)).toBe(id);
		expect(calendarIdFromSlug(calendarSlug(id))).toBe(id);
	});

	it('round-trips resource ids', () => {
		const id = 'c_188abc@resource.calendar.google.com';
		expect(calendarIdFromSlug(calendarSlug(id))).toBe(id);
		expect(isResourceId(id)).toBe(true);
		expect(isResourceId('abc@group.calendar.google.com')).toBe(false);
	});

	it('returns undefined without a slug', () => {
		expect(calendarIdFromSlug(undefined)).toBeUndefined();
		expect(calendarIdFromSlug('')).toBeUndefined();
	});
});
