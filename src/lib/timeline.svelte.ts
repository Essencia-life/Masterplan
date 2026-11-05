import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { getCalendars, getEvents, refreshRows } from '#lib/calendar.remote';
import type { CalEvent, CalendarMeta, Fresh } from '#lib/types';
import { dayToIso, isoToDay } from '#lib/time';

export const CHUNK = 90;
const key = (rowId: string, chunk: number) => `${rowId}|${chunk}`;

function readList(key: string): string[] | null {
	try {
		const raw = localStorage.getItem(key);
		if (raw === null) return null;
		const v = JSON.parse(raw);
		return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : null;
	} catch {
		return null;
	}
}

function writeList(key: string, values: Iterable<string>) {
	try {
		localStorage.setItem(key, JSON.stringify([...values]));
	} catch {
		// storage unavailable, keep in memory only
	}
}

class Timeline {
	meta = $state<CalendarMeta | null>(null);
	error = $state<string | null>(null);
	/** collapsed groups are never fetched */
	/** null = nothing stored yet, so the defaults apply on first load */
	private storedExpanded = readList('expandedGroups');
	expanded = new SvelteSet<string>(this.storedExpanded ?? []);
	private chunks = new SvelteMap<string, CalEvent[]>();
	private pending = new Set<string>();
	loading = $state(0);
	private initialised = false;
	/** rows whose events are hidden (not fetched, not drawn); remembered per browser */
	hidden = new SvelteSet<string>(readList('hiddenRows') ?? []);

	/** manual group order (group ids), remembered per browser */
	groupOrder = $state<string[]>(readList('groupOrder') ?? []);

	/** groups in the user's order; groups without a stored position keep their default order at the end */
	orderGroups<T extends { id: string }>(groups: T[]): T[] {
		if (!this.groupOrder.length) return groups;
		const pos = (id: string) => {
			const i = this.groupOrder.indexOf(id);
			return i < 0 ? Number.MAX_SAFE_INTEGER : i;
		};
		return [...groups].sort((a, b) => pos(a.id) - pos(b.id));
	}

	/** put group `id` before (or after) `targetId`; `displayed` is the current display order */
	moveGroup(displayed: string[], id: string, targetId: string, after: boolean) {
		if (id === targetId) return;
		const list = displayed.filter((x) => x !== id);
		const at = list.indexOf(targetId);
		if (at < 0) return;
		list.splice(after ? at + 1 : at, 0, id);
		this.groupOrder = list;
		writeList('groupOrder', list);
	}

	toggleRow(rowId: string) {
		if (this.hidden.has(rowId)) this.hidden.delete(rowId);
		else this.hidden.add(rowId);
		writeList('hiddenRows', this.hidden);
	}
	/** bumped by invalidate() so effects refetch */
	version = $state(0);

	async loadMeta() {
		try {
			this.meta = await getCalendars();
			// first load: open the groups that hold calendars
			if (!this.initialised) {
				this.initialised = true;
				if (!this.storedExpanded) for (const r of this.meta.rows) if (r.kind === 'calendar') this.expanded.add(r.groupId);
			}
			this.error = null;
		} catch (e) {
			this.error = e instanceof Error ? e.message : 'Could not load calendars';
		}
	}

	toggle(groupId: string) {
		if (this.expanded.has(groupId)) this.expanded.delete(groupId);
		else this.expanded.add(groupId);
		writeList('expandedGroups', this.expanded);
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

	/** Show events immediately (e.g. room bookings Google has not mirrored yet); replaced by the next applyFresh. */
	addOptimistic(events: CalEvent[]) {
		for (const ev of events) {
			const s = isoToDay(ev.start);
			const e = isoToDay(ev.end);
			for (const k of [...this.chunks.keys()]) {
				if (!k.startsWith(ev.rowId + '|')) continue;
				const c = Number(k.split('|')[1]);
				if (s >= (c + 1) * CHUNK || e <= c * CHUNK) continue;
				const list = this.chunks.get(k)!;
				if (!list.some((x) => x.id === ev.id)) this.chunks.set(k, [...list, ev]);
			}
		}
	}

	/**
	 * Re-read the given rows after a few seconds and stop as soon as every row contains the
	 * event (identified by linkId). Rows where it never shows up lose their optimistic entry
	 * (e.g. the room declined).
	 */
	async confirm(rowIds: string[], from: string, to: string, linkId: string, delays = [3000, 8000]) {
		for (const delay of delays) {
			await new Promise((r) => setTimeout(r, delay));
			try {
				const fresh = await refreshRows({ rowIds, from, to });
				this.applyFresh(fresh);
				if (rowIds.every((id) => fresh.rows[id]?.some((e) => e.linkId === linkId))) return;
			} catch {
				// try again with the next delay
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
