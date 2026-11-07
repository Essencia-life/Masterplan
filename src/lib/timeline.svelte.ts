import { getContext, setContext } from 'svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { getEvents, refreshRows } from '#lib/calendar.remote';
import type { CalEvent, CalendarMeta, Fresh } from '#lib/types';
import { dayToIso, isoToDay } from '#lib/time';

export const CHUNK = 90;
const key = (rowId: string, chunk: number) => `${rowId}|${chunk}`;

/** an event with its day span (start inclusive, end exclusive) precomputed */
export type Indexed = CalEvent & { s: number; e: number };
const index = (ev: CalEvent): Indexed => ({ ...ev, s: isoToDay(ev.start), e: isoToDay(ev.end) });

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

export class Timeline {
	meta = $state<CalendarMeta | null>(null);
	error = $state<string | null>(null);
	loading = $state(0);
	/** collapsed groups are never fetched; defaults to the groups with calendars until restore() ran */
	expanded = new SvelteSet<string>();
	/** rows whose events are hidden (not fetched, not drawn); remembered per browser */
	hidden = new SvelteSet<string>();
	/** manual group order (group ids), remembered per browser */
	groupOrder = $state<string[]>([]);
	/** events per row, deduplicated, kept in sync by ensure/applyFresh/addOptimistic */
	private byRow = new SvelteMap<string, Indexed[]>();
	private loaded = new Set<string>();
	private pending = new Set<string>();

	constructor(meta: CalendarMeta | null, error: string | null = null) {
		this.setMeta(meta, error);
	}

	/** (re)apply server data; keeps the user's open/closed state */
	setMeta(meta: CalendarMeta | null, error: string | null = null) {
		const first = !this.meta && meta;
		this.meta = meta;
		this.error = error;
		if (first) for (const r of meta.rows) if (r.kind === 'calendar') this.expanded.add(r.groupId);
	}

	/** read localStorage; call from onMount only (server render and hydration use the defaults) */
	restore() {
		const expanded = readList('expandedGroups');
		if (expanded) {
			this.expanded.clear();
			for (const id of expanded) this.expanded.add(id);
		}
		for (const id of readList('hiddenRows') ?? []) this.hidden.add(id);
		this.groupOrder = readList('groupOrder') ?? [];
	}

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

	toggle(groupId: string) {
		if (this.expanded.has(groupId)) this.expanded.delete(groupId);
		else this.expanded.add(groupId);
		writeList('expandedGroups', this.expanded);
	}

	/** events of one row */
	eventsOf(rowId: string): Indexed[] {
		return this.byRow.get(rowId) ?? [];
	}

	/** replace the row's events overlapping [from, to) by `events`, or add `events` */
	private put(rowId: string, events: CalEvent[], window?: [number, number]) {
		const kept = (this.byRow.get(rowId) ?? []).filter((x) => !window || !(x.s < window[1] && x.e > window[0]));
		const ids = new Set(events.map((e) => e.id));
		this.byRow.set(rowId, [...kept.filter((x) => !ids.has(x.id)), ...events.map(index)]);
	}

	/**
	 * Single-flight: merge the rows a mutation returned into the cache, in place.
	 * Nothing is cleared, so the timeline does not flicker or refetch.
	 */
	applyFresh(fresh: Fresh) {
		const window: [number, number] = [isoToDay(fresh.from), isoToDay(fresh.to)];
		for (const [rowId, events] of Object.entries(fresh.rows)) if (this.byRow.has(rowId)) this.put(rowId, events, window);
	}

	/** Show events immediately (e.g. room bookings Google has not mirrored yet); replaced by the next applyFresh. */
	addOptimistic(events: CalEvent[]) {
		for (const ev of events) if (this.byRow.has(ev.rowId)) this.put(ev.rowId, [ev]);
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

	/** Fetch missing chunks for the given rows within the day window. */
	async ensure(rowIds: string[], lo: number, hi: number) {
		const c0 = Math.floor(lo / CHUNK);
		const c1 = Math.floor(hi / CHUNK);
		const todo = new Map<number, string[]>();
		for (const rowId of rowIds)
			for (let c = c0; c <= c1; c++) {
				const k = key(rowId, c);
				if (this.loaded.has(k) || this.pending.has(k)) continue;
				this.pending.add(k);
				todo.set(c, [...(todo.get(c) ?? []), rowId]);
			}
		await Promise.all(
			[...todo].map(async ([c, ids]) => {
				this.loading++;
				try {
					const events = await getEvents({ rowIds: ids, from: dayToIso(c * CHUNK), to: dayToIso((c + 1) * CHUNK) });
					for (const id of ids) {
						const mine = events.filter((e) => e.rowId === id);
						// an empty chunk still registers the row, so mutations can merge into it
						if (mine.length || !this.byRow.has(id)) this.put(id, mine);
						this.loaded.add(key(id, c));
					}
				} catch (e) {
					this.error = e instanceof Error ? e.message : 'Could not load events';
					for (const id of ids) this.loaded.add(key(id, c)); // avoid refetch loops; reload to retry
				} finally {
					for (const id of ids) this.pending.delete(key(id, c));
					this.loading--;
				}
			})
		);
	}
}

const KEY = Symbol('timeline');
export const setTimeline = (t: Timeline) => setContext(KEY, t);
export const getTimeline = () => getContext<Timeline>(KEY);
