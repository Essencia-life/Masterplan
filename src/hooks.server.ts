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
	} catch (e) {
		// SESSION_SECRET missing or invalid: everybody is anonymous, but say so
		console.error('session unavailable:', e instanceof Error ? e.message : e);
	}
	return resolve(event);
};
