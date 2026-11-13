import { describe, expect, it } from 'vitest';
import { isLegacyJobs, jobsProblem, newJob, parseJobs, prepareJobs, slugify, supportsJobs } from './jobs';

const job = (over: Partial<ReturnType<typeof newJob>> = {}) => ({ ...newJob(), title: 'Chef', ...over });

describe('supportsJobs', () => {
	it('matches community, events and retreat calendars by group or name', () => {
		expect(supportsJobs('Programme', 'Retreats')).toBe(true);
		expect(supportsJobs('Community', 'Lunch')).toBe(true);
		expect(supportsJobs('Programme', 'Events')).toBe(true);
		expect(supportsJobs('Guests', 'Volunteers')).toBe(false);
	});
});

describe('slugify', () => {
	it('keeps lowercase letters and digits, joined by single hyphens', () => {
		expect(slugify('🧚‍♀️ Fairy of the Week')).toBe('fairy-of-the-week');
		expect(slugify('Café Übung 2')).toBe('cafe-ubung-2');
		expect(slugify('🔥')).toBe('');
	});
	it('never ends with a hyphen after cutting', () => {
		expect(slugify('a'.repeat(39) + ' b')).toBe('a'.repeat(39));
	});
});

describe('prepareJobs', () => {
	it('derives keys from titles and keeps existing ones', () => {
		const out = prepareJobs([job({ key: 'chef' }), job({ title: 'Lunch Cleaning' }), job({ title: '🔥' })]);
		expect(out.map((j) => j.key)).toEqual(['chef', 'lunchcleaning', 'job']);
	});
	it('makes new keys unique', () => {
		expect(prepareJobs([job(), job(), job({ key: 'chef2' })]).map((j) => j.key)).toEqual(['chef', 'chef3', 'chef2']);
	});
	it('drops askDetails when there is more than one slot', () => {
		expect(prepareJobs([job({ slots: 2, askDetails: true })])[0].askDetails).toBe(false);
		expect(prepareJobs([job({ slots: 1, askDetails: true })])[0].askDetails).toBe(true);
	});
});

describe('jobsProblem', () => {
	it('accepts a valid list and an empty one', () => {
		expect(jobsProblem([job()], 'lunch')).toBeNull();
		expect(jobsProblem([])).toBeNull();
	});
	it('names the first problem', () => {
		expect(jobsProblem([job({ title: ' ' })])).toBe('Every job needs a title');
		expect(jobsProblem([job({ slots: 0 })])).toBe('At least one slot');
		expect(jobsProblem([job({ key: 'a' }), job({ key: 'a', title: 'B' })])).toBe('Job keys must be unique');
		expect(jobsProblem(Array.from({ length: 13 }, (_, i) => job({ title: `J${i}` })))).toBe('At most 12 jobs');
		expect(jobsProblem([job()], 'Lunch Time')).toMatch(/Event key/);
	});
});

describe('isLegacyJobs', () => {
	it('recognises the older object format only', () => {
		expect(isLegacyJobs('{"chef":{"title":"Chef","persons":[]}}')).toBe(true);
		expect(isLegacyJobs('[]')).toBe(false);
		expect(isLegacyJobs(undefined)).toBe(false);
		expect(isLegacyJobs('{nope')).toBe(false);
	});
});

describe('parseJobs', () => {
	it('round-trips what the panel stores', () => {
		const stored = [job({ key: 'chef', slots: 2 })];
		expect(parseJobs(JSON.stringify(stored))).toEqual(stored);
	});
	it('treats missing, broken and legacy values as no jobs', () => {
		expect(parseJobs(undefined)).toEqual([]);
		expect(parseJobs('{nope')).toEqual([]);
		expect(parseJobs('{"chef":{"title":"Chef","persons":[]}}')).toEqual([]);
	});
});
