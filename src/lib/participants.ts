import type { calendar_v3 } from 'googleapis';
import * as z from 'zod';

/**
 * People of a guest or volunteer booking, stored as the event's Google attendees (next to the room
 * resources). Every write uses `sendUpdates: 'none'`, so Google sends no invitation or update mail.
 */

/** Calendars whose events carry participants. Matched on "group name", like jobs. */
export const PARTICIPANT_CALENDARS = /guest|volunteer/i;
export const supportsParticipants = (groupLabel: string, calendarLabel: string) => PARTICIPANT_CALENDARS.test(`${groupLabel} ${calendarLabel}`);

export const participantSchema = z.object({
	name: z.string().trim().min(1, 'Every person needs a name').max(80),
	// a Google attendee is identified by its email address
	email: z.string().trim().min(1, 'Every person needs an email address').pipe(z.email('Not a valid email address'))
});

export const participantsSchema = z
	.array(participantSchema)
	.max(50, 'At most 50 people')
	.refine((p) => new Set(p.map((x) => x.email.toLowerCase())).size === p.length, 'Every email address can only be added once');

export type Participant = z.infer<typeof participantSchema>;

export const newParticipant = (): Participant => ({ name: '', email: '' });

/** First problem with the list, or null. */
export const participantsProblem = (p: Participant[]): string | null => participantsSchema.safeParse(p).error?.issues[0]?.message ?? null;

export const toAttendee = (p: Participant): calendar_v3.Schema$EventAttendee => ({ email: p.email, displayName: p.name });

/** The people among an event's attendees: not rooms, not the organizer's own entry. */
export const fromAttendees = (attendees?: calendar_v3.Schema$EventAttendee[] | null): Participant[] =>
	(attendees ?? []).filter((a) => a.email && !a.resource && !a.self && !a.organizer).map((a) => ({ name: a.displayName || a.email!, email: a.email! }));
