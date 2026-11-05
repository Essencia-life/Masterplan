<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount, untrack, type Snippet } from 'svelte';
	import { ChevronDown, ChevronLeft, ChevronRight, Ellipsis, EyeOff } from '@lucide/svelte';
	import { timeline } from '#lib/timeline.svelte';
	import { N_DAYS, TODAY, clampDay, dayToDate, dayToIso, isoToDay, moonPath, moonPhase } from '#lib/time';
	import type { CalEvent, RowInfo } from '#lib/types';

	let { children }: { children: Snippet } = $props();

	let innerWidth = $state(1024);
	const mobile = $derived(innerWidth < 640);
	const DAYW = $derived(mobile ? 38 : 44);
	const LABW = $derived(mobile ? 104 : 150);
	const BUF = 21;
	const STEP = 14;
	const LANE = 36;
	const PAD = 8;
	const canHover = typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)');

	let scroller: HTMLDivElement | undefined = $state();
	let viewW = $state(1000);
	let scrollX = $state(0);
	let menuOpen = $state(false);

	// ----- virtual window (quantised so it rarely changes) -----
	const visLo = $derived(Math.floor(scrollX / DAYW));
	const visHi = $derived(Math.ceil((scrollX + viewW) / DAYW));
	const lo = $derived(Math.max(0, Math.floor((visLo - BUF) / STEP) * STEP));
	const hi = $derived(Math.min(N_DAYS, Math.ceil((visHi + BUF) / STEP) * STEP));
	const days = $derived(Array.from({ length: hi - lo }, (_, i) => lo + i));

	// ----- rows -----
	const groups = $derived(
		(timeline.meta?.groups ?? []).map((g) => ({
			...g,
			open: timeline.expanded.has(g.id),
			rows: (timeline.meta?.rows ?? []).filter((r) => r.groupId === g.id)
		}))
	);
	const openRowIds = $derived(groups.filter((g) => g.open).flatMap((g) => g.rows.filter((r) => r.available && !timeline.hidden.has(r.id)).map((r) => r.id)));

	$effect(() => {
		const ids = openRowIds;
		const a = lo;
		const b = hi;
		void timeline.version;
		if (ids.length) untrack(() => timeline.ensure(ids, a, b));
	});

	type Placed = { ev: CalEvent; s: number; e: number; lane: number; linked: boolean };
	function pack(row: RowInfo): { items: Placed[]; lanes: number } {
		if (timeline.hidden.has(row.id)) return { items: [], lanes: 1 };
		const raw = timeline
			.eventsOf(row.id)
			.map((ev) => ({ ev, s: isoToDay(ev.start), e: isoToDay(ev.end) }))
			.filter((x) => x.e > lo - BUF && x.s < hi + BUF)
			.sort((a, b) => a.s - b.s || b.e - a.e);
		const laneEnd: number[] = [];
		const items = raw.map((x) => {
			let lane = laneEnd.findIndex((end) => end <= x.s);
			if (lane < 0) lane = laneEnd.length;
			laneEnd[lane] = x.e;
			return { ...x, lane, linked: linkCount.get(x.ev.linkId)! > 1 };
		});
		return { items, lanes: Math.max(1, laneEnd.length) };
	}
	// number of rows an iCalUID occurs in (>1 ⇒ draw as linked booking)
	const linkCount = $derived.by(() => {
		const m = new Map<string, number>();
		for (const g of groups) {
			if (!g.open) continue;
			for (const r of g.rows) {
				if (timeline.hidden.has(r.id)) continue;
				const seen = new Set<string>();
				for (const e of timeline.eventsOf(r.id)) seen.add(e.linkId);
				for (const l of seen) m.set(l, (m.get(l) ?? 0) + 1);
			}
		}
		return m;
	});
	const packed = $derived(new Map(groups.flatMap((g) => (g.open ? g.rows : [])).map((r) => [r.id, pack(r)])));

	// ----- month header -----
	const months = $derived.by(() => {
		const out: { key: string; label: string; s: number; e: number }[] = [];
		let d = lo;
		while (d < hi) {
			const dt = dayToDate(d);
			const first = d - dt.getUTCDate() + 1;
			const len = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
			out.push({
				key: `${dt.getUTCFullYear()}-${dt.getUTCMonth()}`,
				label: dt.toLocaleString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
				s: first,
				e: first + len
			});
			d = first + len;
		}
		return out;
	});

	const dow = (d: number) => dayToDate(d).getUTCDay();
	const dom = (d: number) => dayToDate(d).getUTCDate();
	const isWeekend = (d: number) => dow(d) === 0 || dow(d) === 6;
	const wd = (d: number) => dayToDate(d).toLocaleString('en', { weekday: 'narrow', timeZone: 'UTC' });

	// ----- selection (drag / long press) -----
	let drag = $state<{ rowId: string; a: number; b: number } | null>(null);
	let pressTimer = 0;
	let startPt = { x: 0, y: 0 };
	let pointerId = -1;
	let lastX = 0;
	let raf = 0;
	let board: HTMLDivElement | undefined = $state();

	const urlSel = $derived.by(() => {
		if (!page.route.id?.includes('/event/') || page.params.eventId) return null;
		const sp = page.url.searchParams;
		const row = sp.get('row'),
			from = sp.get('from'),
			to = sp.get('to');
		return row && from && to ? { rowId: row, a: isoToDay(from), b: isoToDay(to) } : null;
	});
	const sel = $derived(drag ?? urlSel);

	function dayAt(clientX: number) {
		const r = board!.getBoundingClientRect();
		return clampDay(Math.floor((clientX - r.left - LABW) / DAYW));
	}

	function beginDrag(rowId: string, d: number) {
		drag = { rowId, a: d, b: d };
		scroller?.setPointerCapture?.(pointerId);
		const tick = () => {
			if (!drag || !scroller) return;
			const r = scroller.getBoundingClientRect();
			if (lastX > r.right - 48) scroller.scrollLeft += 16;
			else if (lastX < r.left + LABW + 48) scroller.scrollLeft -= 16;
			drag.b = dayAt(lastX);
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
	}

	function onDown(e: PointerEvent) {
		if (e.button !== 0) return;
		const t = e.target as HTMLElement;
		if (t.closest('[data-ev]') || t.closest('[data-label]')) return;
		const row = t.closest<HTMLElement>('[data-row]');
		if (!row) return;
		const rowId = row.dataset.row!;
		startPt = { x: e.clientX, y: e.clientY };
		lastX = e.clientX;
		pointerId = e.pointerId;
		if (e.pointerType === 'mouse') {
			e.preventDefault();
			beginDrag(rowId, dayAt(e.clientX));
		} else {
			// touch / pen: long press, then drag selects several days
			clearTimeout(pressTimer);
			pressTimer = window.setTimeout(() => {
				navigator.vibrate?.(12);
				beginDrag(rowId, dayAt(startPt.x));
			}, 380);
		}
	}
	function onMove(e: PointerEvent) {
		lastX = e.clientX;
		if (pressTimer && !drag && Math.hypot(e.clientX - startPt.x, e.clientY - startPt.y) > 8) {
			clearTimeout(pressTimer);
			pressTimer = 0;
		}
	}
	function onUp() {
		clearTimeout(pressTimer);
		pressTimer = 0;
		if (!drag) return;
		cancelAnimationFrame(raf);
		const d = drag;
		drag = null;
		const a = Math.min(d.a, d.b),
			b = Math.max(d.a, d.b);
		goto(`/event?row=${encodeURIComponent(d.rowId)}&from=${dayToIso(a)}&to=${dayToIso(b + 1)}`, { reset: false });
	}
	function onCancel() {
		clearTimeout(pressTimer);
		cancelAnimationFrame(raf);
		drag = null;
	}
	// while a long press selection is active the page must not scroll
	function blockScroll(e: TouchEvent) {
		if (drag) e.preventDefault();
	}

	// ----- hover highlight of linked bars (fine pointers only) -----
	let hot = $state<string | null>(null);
	let tip = $state<{ text: string; x: number; y: number } | null>(null);
	function showTip(e: MouseEvent, it: Placed) {
		if (!canHover || !canHover.matches || drag) return (tip = null);
		const range = `${it.ev.start} – ${dayToIso(it.e - 1)}`;
		const rooms = (linkCount.get(it.ev.linkId) ?? 1) - 1;
		const text = `${it.ev.title} · ${range}${rooms > 0 ? ` · +${rooms} linked` : ''}${it.ev.status === 'tentative' ? ' · tentative' : ''}`;
		tip = { text, x: Math.min(e.clientX + 12, innerWidth - 260), y: e.clientY + 16 };
	}

	// ----- navigation -----
	function scrollToDay(d: number, smooth = true) {
		scroller?.scrollTo({ left: Math.max(0, (d - 2) * DAYW), behavior: smooth ? 'smooth' : 'instant' });
	}
	const go = (weeks: number) => scroller?.scrollBy({ left: weeks * 7 * DAYW, behavior: 'smooth' });

	onMount(() => {
		timeline.loadMeta();
		scrollToDay(TODAY, false);
		scrollX = scroller!.scrollLeft;
		const ro = new ResizeObserver(() => (viewW = scroller!.clientWidth));
		ro.observe(scroller!);
		viewW = scroller!.clientWidth;
		scroller!.addEventListener('touchmove', blockScroll, { passive: false });
		return () => ro.disconnect();
	});

	let ticking = false;
	function onScroll() {
		if (ticking) return;
		ticking = true;
		requestAnimationFrame(() => {
			ticking = false;
			scrollX = scroller!.scrollLeft;
		});
	}

	const panelOpen = $derived(!!page.route.id?.includes('/event/'));
	function openEvent(ev: CalEvent) {
		goto(`/event/${ev.id}?cal=${encodeURIComponent(ev.rowId)}`, { reset: false });
	}
</script>

<svelte:window bind:innerWidth onkeydown={(e) => e.key === 'Escape' && menuOpen && (menuOpen = false)} />

<div class="flex h-dvh flex-col" style="--label-w:{LABW}px; --day-w:{DAYW}px">
	<header class="relative z-50 flex shrink-0 items-center gap-2 border-b border-line bg-surface px-3 py-2">
		<h1 class="mr-auto text-2xl leading-none">Essência <span class="hidden text-base font-normal text-muted sm:inline">· Occupancy</span></h1>
		{#if timeline.loading > 0}<span class="text-xs text-muted">loading…</span>{/if}
		<div class="hidden items-center gap-1 sm:flex">
			<button class="btn" onclick={() => go(-1)} aria-label="Previous week"><ChevronLeft size={18} /></button>
			<button class="btn" onclick={() => scrollToDay(TODAY)}>Today</button>
			<button class="btn" onclick={() => go(1)} aria-label="Next week"><ChevronRight size={18} /></button>
			<button class="btn btn-primary" onclick={() => goto('/event', { reset: false })}>New booking</button>
		</div>
		<div class="relative sm:hidden">
			<button class="btn" aria-label="More" aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)}><Ellipsis size={18} /></button>
			{#if menuOpen}
				<div class="absolute right-0 z-30 mt-1 w-40 rounded-lg border border-line bg-surface p-1 shadow-panel">
					{#each [['Today', () => scrollToDay(TODAY)], ['Previous week', () => go(-1)], ['Next week', () => go(1)], ['New booking', () => goto('/event', { reset: false })]] as [label, fn] (label)}
						<button class="block w-full rounded px-3 py-2 text-left hover:bg-surface-2" onclick={() => { (fn as () => void)(); menuOpen = false; }}>{label}</button>
					{/each}
				</div>
			{/if}
		</div>
	</header>

	{#if timeline.error}
		<p class="shrink-0 bg-secondary-100 px-3 py-1.5 text-sm text-secondary-800 dark:bg-secondary-900 dark:text-secondary-100">{timeline.error}</p>
	{/if}

	<div class="flex min-h-0 flex-1 md:flex-row">
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			bind:this={scroller}
			class="min-w-0 flex-1 overflow-auto overscroll-x-contain bg-surface"
			onscroll={onScroll}
			onpointerdown={onDown}
			onpointermove={onMove}
			onpointerup={onUp}
			onpointercancel={onCancel}
			oncontextmenu={(e) => (pressTimer || drag) && e.preventDefault()}
			style:user-select={drag ? 'none' : undefined}
			style:-webkit-touch-callout="none"
		>
			<div bind:this={board} class="relative" style="width:{LABW + N_DAYS * DAYW}px">
				<!-- header -->
				<div class="sticky top-0 z-20 border-b border-line bg-surface">
					<div class="flex" style="height:28px">
						<div class="sticky left-0 z-10 shrink-0 bg-surface border-r border-line" style="width:{LABW}px"></div>
						<div class="relative" style="width:{N_DAYS * DAYW}px">
							{#each months as m (m.key)}
								<div class="absolute top-0 h-full overflow-clip border-l border-b border-line" style="left:{m.s * DAYW}px;width:{(m.e - m.s) * DAYW}px">
									<span class="sticky inline-block whitespace-nowrap px-2 font-display text-[15px] font-bold leading-[28px]" style="left:{LABW}px">{m.label}</span>
								</div>
							{/each}
						</div>
					</div>
					<div class="flex" style="height:48px">
						<div class="sticky left-0 z-10 shrink-0 bg-surface border-r border-line" style="width:{LABW}px"></div>
						<div class="relative" style="width:{N_DAYS * DAYW}px">
							{#each days as d (d)}
								<div
									class="absolute top-0 flex h-full flex-col items-center justify-center border-l border-line-soft text-xs leading-tight"
									class:weekend={isWeekend(d)}
									class:month-start={dom(d) === 1}
									class:today={d === TODAY}
									style="left:{d * DAYW}px;width:{DAYW}px"
								>
									<span class="text-muted">{wd(d)}</span>
									<span class="text-sm font-bold">{dom(d)}</span>
								</div>
							{/each}
						</div>
					</div>
					<div class="flex" style="height:26px">
						<div class="sticky left-0 z-10 flex shrink-0 items-center bg-surface px-2 text-[11px] text-muted border-r border-line" style="width:{LABW}px">Moon</div>
						<div class="relative" style="width:{N_DAYS * DAYW}px">
							{#each days as d (d)}
								{@const p = moonPath(moonPhase(d))}
								<div class="absolute top-0 flex h-full items-center justify-center border-l border-line-soft" class:month-start={dom(d) === 1} style="left:{d * DAYW}px;width:{DAYW}px">
									<svg width="16" height="16" viewBox="-9 -9 18 18" aria-hidden="true">
										<circle r="8" fill="var(--app-surface-2)" stroke="var(--app-line)" />
										{#if p === 'full'}<circle r="8" fill="var(--color-amber)" />{:else if p !== 'new'}<path d={p} fill="var(--color-amber)" />{/if}
									</svg>
								</div>
							{/each}
						</div>
					</div>
				</div>

				<!-- column shading (weekends / today) for the whole body -->
				<div class="pointer-events-none absolute bottom-0 z-0" style="top:102px;left:{LABW}px;width:{N_DAYS * DAYW}px;background-image:linear-gradient(to right, var(--app-line-soft) 1px, transparent 1px);background-size:{DAYW}px 100%">
					{#each days as d (d)}
						{#if dom(d) === 1}
							<div class="absolute top-0 h-full border-l border-line" style="left:{d * DAYW}px"></div>
						{/if}
						{#if isWeekend(d) || d === TODAY}
							<div class="absolute top-0 h-full" style="left:{d * DAYW}px;width:{DAYW}px;background:{d === TODAY ? 'var(--app-today)' : 'var(--app-weekend)'}"></div>
						{/if}
					{/each}
				</div>

				<!-- groups & rows -->
				{#each groups as g (g.id)}
					<div class="relative z-[1] flex border-b border-line bg-surface-2" style="height:30px">
						<button
							data-label
							class="sticky left-0 z-10 flex shrink-0 items-center gap-1 bg-surface-2 px-2 text-left whitespace-nowrap"
							style="height:29px;min-width:{LABW}px"
							onclick={() => timeline.toggle(g.id)}
							aria-expanded={g.open}
						>
							<ChevronDown size={16} class={g.open ? '' : '-rotate-90'} />
							<span class="font-display text-[18px] font-bold">{g.label}</span>
						</button>
					</div>
					{#if g.open}
						{#each g.rows as row (row.id)}
							{@const pk = packed.get(row.id)}
							{@const h = (pk?.lanes ?? 1) * LANE + PAD}
							<div class="relative flex border-b border-line-soft" data-row={row.writable ? row.id : undefined} style="height:{h}px">
								<button
									data-label
									class="sticky left-0 z-10 flex shrink-0 cursor-pointer items-start gap-2 border-r border-line bg-surface px-2 text-left text-sm leading-5"
									style="width:{LABW}px;padding-top:{PAD / 2 + 3}px"
									title={timeline.hidden.has(row.id) ? `Show ${row.label}` : `Hide ${row.label}`}
									aria-pressed={timeline.hidden.has(row.id)}
									onclick={() => timeline.toggleRow(row.id)}
								>
									<span class="mt-[5px] size-2.5 shrink-0 rounded-full" style="background:{timeline.hidden.has(row.id) ? 'transparent' : row.color};box-shadow:inset 0 0 0 2px {row.color}"></span>
									<span class="truncate" class:text-muted={timeline.hidden.has(row.id)}>{row.label}</span>
									{#if timeline.hidden.has(row.id)}<EyeOff size={14} class="mt-[3px] shrink-0 text-muted" />{/if}
								</button>
								<div class="relative z-[1]" style="width:{N_DAYS * DAYW}px">
									{#if sel && sel.rowId === row.id}
										<div class="absolute inset-y-0.5 rounded border-2 border-dashed border-accent bg-accent/15" style="left:{Math.min(sel.a, sel.b) * DAYW}px;width:{(Math.abs(sel.b - sel.a) + 1) * DAYW}px"></div>
									{/if}
									{#each pk?.items ?? [] as it (it.ev.id)}
										<button
											data-ev
											class="evt absolute overflow-clip rounded-md text-left text-[13px] leading-[26px] text-white"
											class:hatched={it.linked}
											class:tentative={it.ev.status === 'tentative'}
											class:hot={hot === it.ev.linkId}
											style="left:{it.s * DAYW + 1}px;width:{(it.e - it.s) * DAYW - 2}px;top:{PAD / 2 + it.lane * LANE}px;--c:{row.color}"
											onmousemove={(e) => showTip(e, it)}
											onclick={() => openEvent(it.ev)}
											onmouseenter={() => canHover && canHover.matches && (hot = it.ev.linkId)}
											onmouseleave={() => ((hot = null), (tip = null))}
										>
											<span class="sticky inline-block max-w-full truncate px-2" style="left:{LABW + 4}px">{it.ev.title}</span>
										</button>
									{/each}
								</div>
							</div>
						{/each}
					{/if}
				{/each}
				{#if !timeline.meta && !timeline.error}
					<p class="p-4 text-sm text-muted" style="margin-left:{LABW}px">Loading calendars…</p>
				{/if}
			</div>
		</div>

		{#if panelOpen}
			<aside
				class="fixed inset-x-0 bottom-0 z-40 flex max-h-[58vh] flex-col overflow-hidden rounded-t-2xl border-t border-line bg-surface shadow-sheet md:static md:max-h-none md:w-[380px] md:shrink-0 md:rounded-none md:border-t-0 md:border-l md:shadow-sheet"
			>
				{@render children()}
			</aside>
		{:else}
			<div class="hidden">{@render children()}</div>
		{/if}
	</div>
</div>

{#if tip}
	<div class="pointer-events-none fixed z-50 max-w-60 rounded-md bg-ink px-2.5 py-1.5 text-xs text-canvas shadow-panel" style="left:{tip.x}px;top:{tip.y}px">{tip.text}</div>
{/if}

<style>
	.btn {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		border: 1px solid var(--app-line);
		border-radius: 0.5rem;
		background: var(--app-surface);
		padding: 0.35rem 0.7rem;
		font-size: 0.9rem;
	}
	.btn:hover {
		background: var(--app-surface-2);
	}
	.btn-primary {
		background: var(--app-accent);
		border-color: var(--app-accent);
		color: var(--app-surface);
	}
	.btn-primary:hover {
		background: var(--app-accent);
		opacity: 0.9;
	}
	.month-start {
		border-left-color: var(--app-line);
	}
	.weekend {
		background: var(--app-weekend);
	}
	.today {
		background: var(--app-today);
	}
	.evt {
		background: color-mix(in oklab, var(--c) 88%, black);
		touch-action: pan-x pan-y;
	}
	.evt.hatched {
		background-image: repeating-linear-gradient(135deg, rgb(255 255 255 / 0.18) 0 4px, transparent 4px 9px);
		box-shadow: inset 3px 0 0 rgb(0 0 0 / 0.35);
	}
	.evt.tentative {
		opacity: 0.7;
		outline: 1px dashed rgb(255 255 255 / 0.7);
		outline-offset: -3px;
	}
	.evt.hot {
		outline: 2px solid var(--app-ink);
		outline-offset: 1px;
		z-index: 2;
	}
</style>
