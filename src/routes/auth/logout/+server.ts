import { redirect } from '@sveltejs/kit';
import { clearSession, readSession } from '#lib/server/session';
import { oauthClient } from '#lib/server/oauth';
import type { RequestHandler } from './$types';

// POST only: SvelteKit's origin check protects this from cross-site form posts
export const POST: RequestHandler = async ({ cookies, url }) => {
	const s = readSession(cookies);
	if (s) await oauthClient(url.origin).revokeToken(s.refreshToken).catch(() => {});
	clearSession(cookies);
	redirect(303, '/');
};
