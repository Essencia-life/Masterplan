import { google } from 'googleapis';
import * as env from '$app/env/private';
import { credentials, withBackoff } from '#lib/server/google';

let client: ReturnType<typeof google.gmail> | undefined;

export function sender() {
	if (!env.MAIL_SENDER) throw new Error('MAIL_SENDER is not set');
	return { name: env.MAIL_FROM_NAME || 'Essência', email: env.MAIL_SENDER };
}

/**
 * Gmail as the sender mailbox: the same service account as for the calendars, delegated to MAIL_SENDER.
 * The Workspace admin has to allow https://www.googleapis.com/auth/gmail.send for its client ID.
 */
function gmail() {
	if (client) return client;
	const { email, key } = credentials();
	const auth = new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/gmail.send'], subject: sender().email });
	client = google.gmail({ version: 'v1', auth });
	return client;
}

/** Sends a finished RFC 822 message. */
export async function sendRaw(mime: string) {
	await withBackoff(() => gmail().users.messages.send({ userId: 'me', requestBody: { raw: Buffer.from(mime).toString('base64url') } }));
}
