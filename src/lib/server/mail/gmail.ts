import { google } from 'googleapis';
import * as env from '$app/env/private';
import { credentials, withBackoff } from '#lib/server/google';

type Role = 'guest' | 'volunteer';
const clients = new Map<Role, ReturnType<typeof google.gmail>>();

/** The mailbox the mails of this kind are sent from. */
export function sender(role: Role) {
	const email = role === 'guest' ? env.MAIL_GUEST_SENDER : env.MAIL_VOLUNTEER_SENDER;
	if (!email) throw new Error(`MAIL_${role.toUpperCase()}_SENDER is not set`);
	return { name: role === 'guest' ? 'Essência Nature Retreat' : 'Essência Volunteer Program', email };
}

/**
 * Gmail as the sender mailbox: the same service account as for the calendars, delegated to that mailbox.
 * The Workspace admin has to allow https://www.googleapis.com/auth/gmail.send for its client ID.
 */
function gmail(role: Role) {
	let client = clients.get(role);
	if (!client) {
		const { email, key } = credentials();
		const auth = new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/gmail.send'], subject: sender(role).email });
		client = google.gmail({ version: 'v1', auth });
		clients.set(role, client);
	}
	return client;
}

/** Sends a finished RFC 822 message from the mailbox of this kind. */
export async function sendRaw(role: Role, mime: string) {
	await withBackoff(() => gmail(role).users.messages.send({ userId: 'me', requestBody: { raw: Buffer.from(mime).toString('base64url') } }));
}
