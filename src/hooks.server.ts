import type { Handle } from '@sveltejs/kit';
import { readSession } from '#lib/server/session';

/** Anonymous visitors are allowed (availability only); a valid session cookie adds the user. */
export const handle: Handle = async ({ event, resolve }) => {
	try {
		const s = readSession(event.cookies);
		if (s) {
			event.locals.user = { email: s.email, name: s.name };
			event.locals.refreshToken = s.refreshToken;
		}
	} catch {
		// SESSION_SECRET missing: treat everyone as anonymous
	}
	return resolve(event);
};
