import * as z from 'zod';

/**
 * People of a guest or volunteer booking. Stored on the event as a private extended property
 * `participants` (JSON array), not as Google attendees, so Google never sends them anything.
 * Google caps one property value at 1024 characters, so longer lists continue in
 * `participants2`, `participants3`, …
 */

/** Calendars whose events carry participants. Matched on "group name", like jobs. */
export const PARTICIPANT_CALENDARS = /guest|volunteer/i;
export const supportsParticipants = (groupLabel: string, calendarLabel: string) => PARTICIPANT_CALENDARS.test(`${groupLabel} ${calendarLabel}`);

const CHUNK = 1000;
const MAX_CHUNKS = 8;

export const participantSchema = z.object({
	name: z.string().trim().min(1, 'Every person needs a name').max(80),
	email: z
		.string()
		.trim()
		.max(120)
		.refine((v) => !v || z.email().safeParse(v).success, 'Not a valid email address')
});

export const participantsSchema = z
	.array(participantSchema)
	.max(50, 'At most 50 people')
	.refine((p) => JSON.stringify(p).length <= CHUNK * MAX_CHUNKS, 'Too much text for one booking, shorten names or split the booking');

export type Participant = z.infer<typeof participantSchema>;

export const newParticipant = (): Participant => ({ name: '', email: '' });

/** First problem with the list, or null. */
export const participantsProblem = (p: Participant[]): string | null => participantsSchema.safeParse(p).error?.issues[0]?.message ?? null;

const keyOf = (i: number) => (i ? `participants${i + 1}` : 'participants');

/** Extended properties for a (validated) list; unused chunk keys are null, which removes them in a patch. */
export function participantProps(list: Participant[]): Record<string, string | null> {
	const json = list.length ? JSON.stringify(list) : '';
	const props: Record<string, string | null> = {};
	for (let i = 0; i < MAX_CHUNKS; i++) props[keyOf(i)] = json.slice(i * CHUNK, (i + 1) * CHUNK) || null;
	return props;
}

/** The list stored in an event's private properties; anything unreadable counts as "no participants". */
export function parseParticipants(priv?: Record<string, string> | null): Participant[] {
	let json = '';
	for (let i = 0; i < MAX_CHUNKS && priv?.[keyOf(i)]; i++) json += priv[keyOf(i)];
	try {
		const r = participantsSchema.safeParse(JSON.parse(json || '[]'));
		return r.success ? r.data : [];
	} catch {
		return [];
	}
}
