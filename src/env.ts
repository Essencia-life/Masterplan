import { defineEnvVars } from '@sveltejs/kit/env';
import * as z from 'zod';

const optional = { schema: z.string().optional() };

export const variables = defineEnvVars({
	// --- read access for everybody: service account (hybrid approach) ---
	/** Service account JSON, raw or base64 */
	GOOGLE_SERVICE_ACCOUNT_JSON: optional,
	/** Only needed when GOOGLE_SERVICE_ACCOUNT_JSON holds just the PEM private key */
	GOOGLE_SERVICE_ACCOUNT_EMAIL: optional,
	/** Workspace user to impersonate (domain-wide delegation), used for the calendar list and reading events */
	GOOGLE_IMPERSONATE_USER: optional,

	// --- login and write access: OAuth with the signed-in Workspace user ---
	GOOGLE_CLIENT_ID: optional,
	GOOGLE_CLIENT_SECRET: optional,
	/** Workspace domain whose users may sign in, e.g. essencia.life */
	ALLOWED_DOMAIN: optional,
	/** Random string (>= 32 chars) used to encrypt the session cookie */
	SESSION_SECRET: optional,

	// --- cache: Upstash Redis (set by the Vercel marketplace integration as KV_REST_API_*); optional, falls back to memory ---
	UPSTASH_REDIS_REST_URL: optional,
	UPSTASH_REDIS_REST_TOKEN: optional,
	KV_REST_API_URL: optional,
	KV_REST_API_TOKEN: optional
});
