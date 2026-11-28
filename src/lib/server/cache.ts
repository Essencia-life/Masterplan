import { Redis } from '@upstash/redis';
import * as env from '$app/env/private';
import type { CalEvent } from '#lib/types';
import { PREFIX } from './keys';

const TTL_SECONDS = 60;

const url = env.KV_REST_API_URL;
const token = env.KV_REST_API_TOKEN;
/** Shared cache for all serverless instances; without credentials (local dev) an in-process map is used. */
const redis = url && token ? new Redis({ url, token }) : null;

const memory = new Map<string, { exp: number; value: CalEvent[] }>();

const keyOf = (rowId: string, from: string, to: string) => `${PREFIX}ev:${rowId}:${from}:${to}`;
const indexOf = (rowId: string) => `${PREFIX}idx:${rowId}`;

function memGet(key: string) {
	const hit = memory.get(key);
	if (!hit) return null;
	if (hit.exp < Date.now()) {
		memory.delete(key);
		return null;
	}
	return hit.value;
}

/**
 * Events of several rows for one window: one cache round trip for all rows, Google only for the misses.
 * A broken cache never breaks the app, it only costs a Google request.
 */
export async function cachedRows(
	rowIds: string[],
	from: string,
	to: string,
	load: (rowId: string) => Promise<CalEvent[]>
): Promise<CalEvent[][]> {
	const keys = rowIds.map((id) => keyOf(id, from, to));
	let hits: (CalEvent[] | null)[] = keys.map(memGet);
	if (redis) {
		try {
			hits = await redis.mget<(CalEvent[] | null)[]>(...keys);
		} catch (e) {
			console.error('cache read failed', e instanceof Error ? e.message : e);
		}
	}
	return Promise.all(
		rowIds.map(async (rowId, i) => {
			const hit = hits[i];
			if (hit) return hit;
			const events = await load(rowId);
			memory.set(keys[i], { exp: Date.now() + TTL_SECONDS * 1000, value: events });
			if (redis) {
				try {
					const p = redis.pipeline();
					p.set(keys[i], events, { ex: TTL_SECONDS });
					p.sadd(indexOf(rowId), keys[i]);
					p.expire(indexOf(rowId), TTL_SECONDS * 2);
					await p.exec();
				} catch (e) {
					console.error('cache write failed', e instanceof Error ? e.message : e);
				}
			}
			return events;
		})
	);
}

/** Drop everything cached for these rows (after a mutation). */
export async function invalidateRows(rowIds: string[]) {
	for (const id of rowIds) for (const k of memory.keys()) if (k.startsWith(`${PREFIX}ev:${id}:`)) memory.delete(k);
	if (!redis) return;
	try {
		for (const id of rowIds) {
			const keys = await redis.smembers(indexOf(id));
			if (keys.length) await redis.del(...keys);
			await redis.del(indexOf(id));
		}
	} catch (e) {
		console.error('cache invalidation failed', e instanceof Error ? e.message : e);
	}
}

/** True when Redis is configured: "send once" markers need shared storage, memory would not survive a serverless instance. */
export const canClaim = !!redis;

/** Atomically claims `key` for `ttlSeconds` (the value is the time of the claim); false when somebody already did. Needs Redis (see canClaim). */
export async function claimOnce(key: string, ttlSeconds: number): Promise<boolean> {
	if (!redis) throw new Error('Upstash Redis is not configured');
	return (await redis.set(key, new Date().toISOString(), { nx: true, ex: ttlSeconds })) === 'OK';
}

/** When each key was claimed: the ISO time, "" for a claim from before times were stored, null for none. */
export async function claimedAt(keys: string[]): Promise<(string | null)[]> {
	if (!redis || !keys.length) return keys.map(() => null);
	try {
		const values = await redis.mget<unknown[]>(...keys);
		return values.map((v) => (v == null ? null : typeof v === 'string' ? v : ''));
	} catch (e) {
		console.error('claims unavailable', e);
		return keys.map(() => null);
	}
}

/** Gives a claim back, e.g. when sending failed and the next run should try again. */
export async function releaseClaim(key: string) {
	await redis?.del(key).catch((e) => console.error('release failed', e));
}

const kvMemory = new Map<string, string>();

/** Plain persistent values (no expiry); in-process only when Redis is not configured (local dev). */
export const kvGet = async (key: string): Promise<string | null> => (redis ? ((await redis.get<string>(key)) ?? null) : (kvMemory.get(key) ?? null));
export const kvSet = async (key: string, value: string) => void (redis ? await redis.set(key, value) : kvMemory.set(key, value));
export const kvDel = async (key: string) => void (redis ? await redis.del(key) : kvMemory.delete(key));
