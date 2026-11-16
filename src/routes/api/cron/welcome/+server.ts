import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { timingSafeEqual } from 'node:crypto';
import * as env from '$app/env/private';
import { localTodayIso } from '#lib/time';
import { sendTest, sendWelcomes } from '#lib/server/mail/welcome';

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Called by the Vercel cron (see vercel.json) with "Authorization: Bearer $CRON_SECRET".
 * `?test=you@example.org&template=guest-welcome` sends one sample mail instead (same authorisation, nothing recorded).
 */
export const GET: RequestHandler = async ({ request, url }) => {
	if (!env.CRON_SECRET) error(500, 'CRON_SECRET is not set');
	if (!same(request.headers.get('authorization') ?? '', `Bearer ${env.CRON_SECRET}`)) error(401, 'Unauthorized');
	try {
		const to = url.searchParams.get('test');
		if (to) {
			await sendTest(url.searchParams.get('template') ?? 'guest-welcome', to);
			return json({ test: to });
		}
		const result = await sendWelcomes(localTodayIso());
		if (result.errors.length) console.error('welcome mails:', result.errors);
		return json(result);
	} catch (e) {
		console.error('welcome mails failed', e);
		error(500, e instanceof Error ? e.message : 'Failed');
	}
};
