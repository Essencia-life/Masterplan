import { kvDel, kvGet, kvSet } from './cache';
import { emailHash, PREFIX } from './keys';
import { decrypt, encrypt } from './session';

/**
 * Google only hands out a refresh token on the first consent of a user. It is kept here (encrypted, per user) as well as in the
 * session cookie, so signing in again after the cookie is gone needs no consent screen.
 */
const keyOf = (email: string) => `${PREFIX}rt:${emailHash(email)}`;

export const saveRefreshToken = (email: string, token: string) => kvSet(keyOf(email), encrypt(token));
export const forgetRefreshToken = (email: string) => kvDel(keyOf(email));
export async function loadRefreshToken(email: string): Promise<string | null> {
	try {
		return decrypt<string>((await kvGet(keyOf(email))) ?? undefined);
	} catch (e) {
		console.error('refresh token store unavailable', e);
		return null;
	}
}
