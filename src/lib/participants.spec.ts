import { describe, expect, it } from 'vitest';
import { newParticipant, parseParticipants, participantProps, participantsProblem, supportsParticipants } from './participants';

describe('supportsParticipants', () => {
	it('matches guest and volunteer calendars only', () => {
		expect(supportsParticipants('Guests', 'Volunteers')).toBe(true);
		expect(supportsParticipants('Stay', 'Guest bookings')).toBe(true);
		expect(supportsParticipants('Programme', 'Retreats')).toBe(false);
	});
});

describe('participantsProblem', () => {
	it('needs a name, an email is optional but must be valid', () => {
		expect(participantsProblem([newParticipant()])).toBe('Every person needs a name');
		expect(participantsProblem([{ name: 'Ana', email: '' }])).toBeNull();
		expect(participantsProblem([{ name: 'Ana', email: 'ana@example.org' }])).toBeNull();
		expect(participantsProblem([{ name: 'Ana', email: 'ana@' }])).toBe('Not a valid email address');
	});
});

describe('storage', () => {
	it('round-trips short lists in a single property', () => {
		const list = [{ name: 'Ana', email: 'ana@example.org' }, { name: 'Ben', email: '' }];
		const props = participantProps(list);
		expect(props.participants).toBe(JSON.stringify(list));
		expect(props.participants2).toBeNull();
		expect(parseParticipants(props as Record<string, string>)).toEqual(list);
	});

	it('splits long lists into values of at most 1000 characters and reads them back', () => {
		const list = Array.from({ length: 30 }, (_, i) => ({ name: `Person number ${i} with a long name`, email: `person${i}@example.org` }));
		const props = participantProps(list);
		expect(props.participants2).not.toBeNull();
		for (const v of Object.values(props)) expect((v ?? '').length).toBeLessThanOrEqual(1000);
		const stored = Object.fromEntries(Object.entries(props).filter(([, v]) => v)) as Record<string, string>;
		expect(parseParticipants(stored)).toEqual(list);
	});

	it('clears everything for an empty list', () => {
		expect(Object.values(participantProps([])).every((v) => v === null)).toBe(true);
		expect(parseParticipants({})).toEqual([]);
	});
});
