import type { RequestHandler } from './$types';
import * as env from '$app/env/private';
import { outputHTML } from '#lib/server/cms-auth';

/** Sveltia CMS opens this in a popup: redirect to GitHub, remember the CSRF token in a cookie. */
export const GET: RequestHandler = () => {
	if (!env.CMS_GITHUB_CLIENT_ID) {
		return outputHTML({ error: 'OAuth app client ID or secret is not configured.', errorCode: 'MISCONFIGURED_CLIENT' });
	}
	const csrfToken = crypto.randomUUID().replaceAll('-', '');
	const params = new URLSearchParams({ client_id: env.CMS_GITHUB_CLIENT_ID, scope: 'repo,user', state: csrfToken });
	return new Response('', {
		status: 302,
		headers: {
			Location: `https://github.com/login/oauth/authorize?${params}`,
			'Set-Cookie': `csrf-token=github_${csrfToken}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax; Secure`
		}
	});
};
