import { defineEnvVars } from '@sveltejs/kit/env';
import { building } from '$app/env';
import * as z from 'zod';

const optional = { schema: z.string().optional() };
/** required when the app starts in production, optional in dev and while building */
const required = (min = 1) => ({ schema: building || import.meta.env.DEV ? z.string().optional() : z.string().min(min) });

export const variables = defineEnvVars({
	// --- read access for everybody: service account (hybrid approach) ---
	/** Service account JSON, raw or base64 */
	GOOGLE_SERVICE_ACCOUNT_JSON: required(),
	/** Only needed when GOOGLE_SERVICE_ACCOUNT_JSON holds just the PEM private key */
	GOOGLE_SERVICE_ACCOUNT_EMAIL: optional,
	/** Workspace user to impersonate (domain-wide delegation), used for the calendar list and reading events */
	GOOGLE_IMPERSONATE_USER: optional,

	// --- login and write access: OAuth with the signed-in Workspace user ---
	GOOGLE_CLIENT_ID: required(),
	GOOGLE_CLIENT_SECRET: required(),
	/** Workspace domain whose users may sign in, e.g. essencia.life */
	ALLOWED_DOMAIN: required(),
	/** Random string (>= 32 chars) used to encrypt the session cookie */
	SESSION_SECRET: required(32),

	// --- cache: Upstash Redis (set by the Vercel marketplace integration as KV_REST_API_*); optional, falls back to memory ---
	KV_REST_API_URL: optional,
	KV_REST_API_TOKEN: optional,

	// --- welcome mails (Vercel cron → /api/cron/welcome → Gmail API) ---
	/** Vercel sends it as "Authorization: Bearer <CRON_SECRET>" to cron routes; the route refuses everything else */
	CRON_SECRET: optional,
	/** Workspace mailbox (or alias owner) the service account sends as, e.g. welcome@essencia.life; needs the gmail.send delegation scope */
	MAIL_SENDER: optional,
	/** Display name of the sender, defaults to "Essência" */
	MAIL_FROM_NAME: optional,
	/** {{feedbackLink}} in the mail texts */
	MAIL_FEEDBACK_URL: optional,
	/** {{telegramJoinLink}}: the Orga invite endpoint, full URL (GET …/orga/api/telegram/invite?name=&departure=YYYY-MM-DD&type=guest|volunteer) */
	MAIL_TELEGRAM_ENDPOINT: optional,
	/** sent as x-secret-token header; the same value the Orga app checks against its ORGA_INVITE_SECRET_TOKEN */
	ORGA_INVITE_SECRET_TOKEN: optional,
	/** used when the endpoint is not set or fails */
	MAIL_TELEGRAM_FALLBACK_URL: optional,

	// --- Sveltia CMS login at /admin (GitHub OAuth app, callback URL: <site>/admin/auth/callback) ---
	CMS_GITHUB_CLIENT_ID: optional,
	CMS_GITHUB_CLIENT_SECRET: optional
});
