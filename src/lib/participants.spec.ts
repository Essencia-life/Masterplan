import { describe, expect, it } from 'vitest';
import { fromAttendees, newParticipant, participantsProblem, supportsParticipants, toAttendee } from './participants';

describe('supportsParticipants', () => {
	it('matches guest and volunteer calendars only', () => {
		expect(supportsParticipants('Guests', 'Volunteers')).toBe(true);
		expect(supportsParticipants('Stay', 'Guest bookings')).toBe(true);
		expect(supportsParticipants('Programme', 'Retreats')).toBe(false);
	});
});

describe('participantsProblem', () => {
	it('needs a name and a valid email', () => {
		expect(participantsProblem([newParticipant()])).toBe('Every person needs a name');
		expect(participantsProblem([{ name: 'Ana', email: '' }])).toBe('Every person needs an email address');
		expect(participantsProblem([{ name: 'Ana', email: 'ana@' }])).toBe('Not a valid email address');
		expect(participantsProblem([{ name: 'Ana', email: 'ana@example.org' }])).toBeNull();
	});
	it('rejects the same email twice', () => {
		const p = [{ name: 'Ana', email: 'ana@example.org' }, { name: 'A.', email: 'ANA@example.org' }];
		expect(participantsProblem(p)).toBe('Every email address can only be added once');
	});
});

describe('attendees', () => {
	it('maps to Google attendees and back, leaving out rooms and the organizer', () => {
		const ana = { name: 'Ana', email: 'ana@example.org' };
		expect(toAttendee(ana)).toEqual({ email: 'ana@example.org', displayName: 'Ana', responseStatus: 'accepted' });
		const attendees = [
			{ email: 'room@resource.calendar.google.com', resource: true },
			{ email: 'me@essencia.life', self: true, organizer: true },
			{ email: 'ana@example.org', displayName: 'Ana' },
			{ email: 'ben@example.org' }
		];
		expect(fromAttendees(attendees)).toEqual([ana, { name: 'ben@example.org', email: 'ben@example.org' }]);
		expect(fromAttendees(undefined)).toEqual([]);
	});
});
