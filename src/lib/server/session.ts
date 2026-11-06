import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import * as env from '$app/env/private';

export const SESSION_COOKIE = 'session';
export const OAUTH_COOKIE = 'oauth';
const SESSION_DAYS = 30;

export type Session = { email: string; name: string; refreshToken: string; exp: number };

function key() {
	const secret = env.SESSION_SECRET;
	if (!secret || secret.length < 32) throw new Error('SESSION_SECRET must be set (at least 32 characters)');
	return createHash('sha256').update(secret).digest();
}

/** AES-256-GCM: base64url(iv | tag | ciphertext). Tampering makes decrypt() return null. */
export function encrypt(value: unknown): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key(), iv);
	const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
	return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url');
}

export function decrypt<T>(token: string | undefined): T | null {
	if (!token) return null;
	try {
		const raw = Buffer.from(token, 'base64url');
		const decipher = createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
		decipher.setAuthTag(raw.subarray(12, 28));
		const json = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
		return JSON.parse(json) as T;
	} catch {
		return null;
	}
}

const base = (secure: boolean) => ({ path: '/', httpOnly: true, sameSite: 'lax' as const, secure });

export function setSession(cookies: Cookies, url: URL, s: Omit<Session, 'exp'>) {
	const exp = Date.now() + SESSION_DAYS * 86_400_000;
	cookies.set(SESSION_COOKIE, encrypt({ ...s, exp }), { ...base(url.protocol === 'https:'), maxAge: SESSION_DAYS * 86_400 });
}

export function readSession(cookies: Cookies): Session | null {
	const s = decrypt<Session>(cookies.get(SESSION_COOKIE));
	return s && s.exp > Date.now() ? s : null;
}

export const clearSession = (cookies: Cookies) => cookies.delete(SESSION_COOKIE, { path: '/' });

/** short-lived cookie that carries state + PKCE verifier through the Google redirect */
export function setOAuthState(cookies: Cookies, url: URL, v: { state: string; verifier: string; returnTo: string }) {
	cookies.set(OAUTH_COOKIE, encrypt(v), { ...base(url.protocol === 'https:'), maxAge: 600 });
}
