import { error, redirect } from '@sveltejs/kit';
import * as env from '$app/env/private';
import { oauthClient, safeReturnTo } from '#lib/server/oauth';
import { decrypt, OAUTH_COOKIE, setSession } from '#lib/server/session';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const saved = decrypt<{ state: string; verifier: string; returnTo: string }>(cookies.get(OAUTH_COOKIE));
	cookies.delete(OAUTH_COOKIE, { path: '/' });
	if (url.searchParams.get('error')) redirect(303, '/');
	const code = url.searchParams.get('code');
	if (!saved || !code || url.searchParams.get('state') !== saved.state) error(400, 'Login failed, please try again');
	if (!env.ALLOWED_DOMAIN) error(500, 'ALLOWED_DOMAIN is not configured');

	const client = oauthClient(url.origin);
	const { tokens } = await client.getToken({ code, codeVerifier: saved.verifier });
	if (!tokens.id_token) error(400, 'Login failed: no identity returned');
	const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: env.GOOGLE_CLIENT_ID });
	const p = ticket.getPayload();
	if (!p?.email || !p.email_verified || p.hd !== env.ALLOWED_DOMAIN) error(403, `Only ${env.ALLOWED_DOMAIN} accounts can sign in`);
	if (!tokens.refresh_token) error(400, 'Google did not return a refresh token, please sign in again');

	setSession(cookies, url, { email: p.email, name: p.name ?? p.email, refreshToken: tokens.refresh_token });
	redirect(303, safeReturnTo(saved.returnTo));
};
