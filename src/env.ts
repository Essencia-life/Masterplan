import { defineEnvVars } from '@sveltejs/kit/env';
import * as z from 'zod';

const optional = { schema: z.string().optional() };

export const variables = defineEnvVars({
	/** Service account JSON, raw or base64 */
	GOOGLE_SERVICE_ACCOUNT_JSON: optional,
	/** Workspace user to impersonate (domain-wide delegation) */
	GOOGLE_IMPERSONATE_USER: optional,
	GOOGLE_CALENDAR_EVENTS: optional,
	GOOGLE_CALENDAR_RETREATS: optional,
	/** Guests and volunteers */
	GOOGLE_CALENDAR_BOOKINGS: optional,
	GOOGLE_CALENDAR_COMMUNITY: optional,
	GOOGLE_CALENDAR_COWORKING: optional
});
