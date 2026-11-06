import { redirect } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import * as env from '$app/env/private';
import { oauthClient, safeReturnTo, SCOPES } from '#lib/server/oauth';
import { setOAuthState } from '#lib/server/session';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const client = oauthClient(url.origin);
	const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
	const state = randomBytes(16).toString('base64url');
	setOAuthState(cookies, url, { state, verifier: codeVerifier!, returnTo: safeReturnTo(url.searchParams.get('returnTo')) });
	redirect(
		303,
		client.generateAuthUrl({
			access_type: 'offline', // refresh token, so the session outlives the 1h access token
			prompt: 'consent',
			scope: SCOPES,
			state,
			code_challenge: codeChallenge,
			code_challenge_method: 'S256' as never,
			hd: env.ALLOWED_DOMAIN || undefined
		}),
		{ external: true } // SvelteKit 3 only redirects to other origins when explicitly allowed
	);
};
