import { defineEnvVars } from '@sveltejs/kit/env';
import * as z from 'zod';

const optional = { schema: z.string().optional() };

export const variables = defineEnvVars({
	/** Service account JSON, raw or base64 */
	GOOGLE_SERVICE_ACCOUNT_JSON: optional,
	/** Only needed when GOOGLE_SERVICE_ACCOUNT_JSON holds just the PEM private key */
	GOOGLE_SERVICE_ACCOUNT_EMAIL: optional,
	/** Workspace user to impersonate (domain-wide delegation) */
	GOOGLE_IMPERSONATE_USER: optional
});