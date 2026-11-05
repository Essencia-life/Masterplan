import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { getCalendars, getEvents } from '#lib/calendar.remote';
import type { CalEvent, CalendarMeta, Fresh } from '#lib/types';
import { dayToIso, isoToDay } from '#lib/time';

export const CHUNK = 90;
const key = (rowId: string, chunk: number) => `${rowId}|${chunk}`;

class Timeline {
	meta = $state<CalendarMeta | null>(null);
	error = $state<string | null>(null);
	/** collapsed groups are never fetched */
	expanded = new SvelteSet<string>();
	private chunks = new SvelteMap<string, CalEvent[]>();
	private pending = new Set<string>();
	loading = $state(0);
	private initialised = false;
	/** bumped by invalidate() so effects refetch */
	version = $state(0);

	async loadMeta() {
		try {
			this.meta = await getCalendars();
			// first load: open the groups that hold calendars
			if (!this.initialised) {
				this.initialised = true;
				for (const r of this.meta.rows) if (r.kind === 'calendar') this.expanded.add(r.groupId);
			}
			this.error = null;
		} catch (e) {
			this.error = e instanceof Error ? e.message : 'Could not load calendars';
		}
	}

	toggle(groupId: string) {
		if (this.expanded.has(groupId)) this.expanded.delete(groupId);
		else this.expanded.add(groupId);
	}

	/** events of one row (deduplicated across chunks) */
	eventsOf(rowId: string): CalEvent[] {
		const seen = new Map<string, CalEvent>();
		for (const [k, list] of this.chunks) {
			if (!k.startsWith(rowId + '|')) continue;
			for (const e of list) seen.set(e.id, e);
		}
		return [...seen.values()];
	}

	/**
	 * Single-flight: merge the rows a mutation returned into the cache, in place.
	 * Nothing is cleared, so the timeline does not flicker or refetch.
	 */
	applyFresh(fresh: Fresh) {
		const wFrom = isoToDay(fresh.from);
		const wTo = isoToDay(fresh.to);
		const overlapsWindow = (e: CalEvent) => isoToDay(e.start) < wTo && isoToDay(e.end) > wFrom;
		for (const [rowId, events] of Object.entries(fresh.rows)) {
			for (const k of [...this.chunks.keys()]) {
				if (!k.startsWith(rowId + '|')) continue;
				const c = Number(k.split('|')[1]);
				const cFrom = c * CHUNK;
				const cTo = cFrom + CHUNK;
				const inChunk = (e: CalEvent) => isoToDay(e.start) < cTo && isoToDay(e.end) > cFrom;
				const kept = this.chunks.get(k)!.filter((e) => !overlapsWindow(e));
				this.chunks.set(k, [...kept, ...events.filter(inChunk)]);
			}
		}
	}

	invalidate() {
		this.chunks.clear();
		this.pending.clear();
		this.version++;
	}

	/** Fetch missing chunks for the given rows within the day window. */
	async ensure(rowIds: string[], lo: number, hi: number) {
		const c0 = Math.floor(lo / CHUNK);
		const c1 = Math.floor(hi / CHUNK);
		const todo = new Map<number, string[]>();
		for (const rowId of rowIds)
			for (let c = c0; c <= c1; c++) {
				const k = key(rowId, c);
				if (this.chunks.has(k) || this.pending.has(k)) continue;
				this.pending.add(k);
				todo.set(c, [...(todo.get(c) ?? []), rowId]);
			}
		await Promise.all(
			[...todo].map(async ([c, ids]) => {
				this.loading++;
				try {
					const events = await getEvents({ rowIds: ids, from: dayToIso(c * CHUNK), to: dayToIso((c + 1) * CHUNK) });
					for (const id of ids) this.chunks.set(key(id, c), events.filter((e) => e.rowId === id));
				} catch (e) {
					this.error = e instanceof Error ? e.message : 'Could not load events';
					for (const id of ids) this.chunks.set(key(id, c), []); // avoid refetch loops; reload to retry
				} finally {
					for (const id of ids) this.pending.delete(key(id, c));
					this.loading--;
				}
			})
		);
	}
}

export const timeline = new Timeline();
