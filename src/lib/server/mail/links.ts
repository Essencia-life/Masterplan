import * as env from '$app/env/private';
import { parseLinkResponse } from './link-response';

/** The two link placeholders of the mail texts: {{feedbackLink}} and {{telegramJoinLink}}. */

export function feedbackLink(): string {
	if (!env.MAIL_FEEDBACK_URL) throw new Error('MAIL_FEEDBACK_URL is not set, but a mail uses {{feedbackLink}}');
	return env.MAIL_FEEDBACK_URL;
}

/**
 * The Telegram join link from the Orga invite endpoint (MAIL_TELEGRAM_ENDPOINT, i.e. `GET …/orga/api/telegram/invite`):
 * query `name`, `departure` (YYYY-MM-DD) and `type` (guest | volunteer), the secret in the `x-secret-token` header,
 * the answer is `{ "invite_link": "https://…" }`. If that fails in any way (not configured, no secret, timeout, error
 * status, no https link in the answer) MAIL_TELEGRAM_FALLBACK_URL is used.
 */
export async function telegramJoinLink(person: { name: string; departure: string; role: 'guest' | 'volunteer' }): Promise<string> {
	if (env.MAIL_TELEGRAM_ENDPOINT) {
		try {
			if (!env.ORGA_BOT_INVITE_SECRET_TOKEN) throw new Error('ORGA_BOT_INVITE_SECRET_TOKEN is not set');
			const url = new URL(env.MAIL_TELEGRAM_ENDPOINT);
			url.searchParams.set('name', person.name);
			url.searchParams.set('departure', person.departure);
			url.searchParams.set('type', person.role);
			const res = await fetch(url, {
				headers: { 'x-secret-token': env.ORGA_BOT_INVITE_SECRET_TOKEN },
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
