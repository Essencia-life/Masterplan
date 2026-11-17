import * as env from '$app/env/private';
import { parseLinkResponse } from './link-response';

/** The two link placeholders of the mail texts: {{feedbackLink}} and {{telegramJoinLink}}. */

export function feedbackLink(): string {
	if (!env.MAIL_FEEDBACK_URL) throw new Error('MAIL_FEEDBACK_URL is not set, but a mail uses {{feedbackLink}}');
	return env.MAIL_FEEDBACK_URL;
}

/**
 * The Telegram join link: asked from MAIL_TELEGRAM_ENDPOINT (GET, query `name`, `departure` as YYYY-MM-DD and
 * `role` = guest | volunteer, the secret in the `Authorization: Bearer` header). If that fails in any way
 * (not configured, timeout, error status, no https URL in the answer) MAIL_TELEGRAM_FALLBACK_URL is used.
 */
export async function telegramJoinLink(person: { name: string; departure: string; role: 'guest' | 'volunteer' }): Promise<string> {
	if (env.MAIL_TELEGRAM_ENDPOINT) {
		try {
			const url = new URL(env.MAIL_TELEGRAM_ENDPOINT);
			url.searchParams.set('name', person.name);
			url.searchParams.set('departure', person.departure);
			url.searchParams.set('role', person.role);
			const res = await fetch(url, {
				headers: env.MAIL_TELEGRAM_TOKEN ? { Authorization: `Bearer ${env.MAIL_TELEGRAM_TOKEN}` } : {},
				signal: AbortSignal.timeout(5000)
			});
			if (!res.ok) throw new Error(`status ${res.status}`);
			const link = parseLinkResponse(await res.text());
			if (link) return link;
			throw new Error('no https link in the answer');
		} catch (e) {
			console.error('telegram link endpoint failed, using the fallback:', e instanceof Error ? e.message : e);
		}
	}
	if (!env.MAIL_TELEGRAM_FALLBACK_URL) throw new Error('No Telegram join link: the endpoint failed or is not set, and MAIL_TELEGRAM_FALLBACK_URL is empty');
	return env.MAIL_TELEGRAM_FALLBACK_URL;
}
