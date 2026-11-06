import { google } from 'googleapis';
import * as env from '$app/env/private';

export const SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/calendar'];

export function oauthClient(origin: string) {
	if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set');
	return new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, `${origin}/auth/callback`);
}

/** only same-site paths, never an absolute or protocol-relative URL */
export const safeReturnTo = (v: string | null | undefined) => (v && /^\/(?!\/|\\)/.test(v) ? v : '/');
