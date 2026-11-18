import type { RequestHandler } from './$types';
import * as env from '$app/env/private';
import { outputHTML } from '#lib/server/cms-auth';

/** GitHub redirects here: check the CSRF token, swap the code for an access token. */
export const GET: RequestHandler = async ({ request: { url, headers } }) => {
	const { code, state } = Object.fromEntries(new URL(url).searchParams);
	const csrfToken = headers.get('Cookie')?.match(/\bcsrf-token=github_([0-9a-f]{32})\b/)?.[1];

	if (!env.CMS_GITHUB_CLIENT_ID || !env.CMS_GITHUB_CLIENT_SECRET) {
		return outputHTML({ error: 'OAuth app client ID or secret is not configured.', errorCode: 'MISCONFIGURED_CLIENT' });
	}
	if (!code || !state) {
		return outputHTML({ error: 'Failed to receive an authorization code. Please try again later.', errorCode: 'AUTH_CODE_REQUEST_FAILED' });
	}
	if (!csrfToken || state !== csrfToken) {
		return outputHTML({ error: 'Potential CSRF attack detected. Authentication flow aborted.', errorCode: 'CSRF_DETECTED' });
	}

	let response: Response;
	try {
		response = await fetch('https://github.com/login/oauth/access_token', {
			method: 'POST',
			headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
			body: JSON.stringify({ code, client_id: env.CMS_GITHUB_CLIENT_ID, client_secret: env.CMS_GITHUB_CLIENT_SECRET })
		});
	} catch {
		return outputHTML({ error: 'Failed to request an access token. Please try again later.', errorCode: 'TOKEN_REQUEST_FAILED' });
	}
	try {
		const { access_token, error } = await response.json();
		return outputHTML({ token: access_token, error });
	} catch {
		return outputHTML({ error: 'Server responded with malformed data. Please try again later.', errorCode: 'MALFORMED_RESPONSE' });
	}
};
