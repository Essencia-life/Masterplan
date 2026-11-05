<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { Button, Checkbox, Input, Label, Select, Textarea } from 'flowbite-svelte';
	import { X } from '@lucide/svelte';
	import { deleteEvent, getEvent, resolveConflict, saveEvent } from '#lib/calendar.remote';
	import { timeline } from '#lib/timeline.svelte';
	import { TODAY, dayToIso, isoToDay } from '#lib/time';
	import type { CalEvent, EventDetail } from '#lib/types';

	const eventId = $derived(page.params.eventId);

	const calendars = [
		{ value: 'events', name: 'Events' },
		{ value: 'retreats', name: 'Retreats' },
		{ value: 'bookings', name: 'Guests & volunteers' },
		{ value: 'community', name: 'Community' },
		{ value: 'coworking', name: 'Co-working' }
	];

	let form = $state({
		id: undefined as string | undefined,
		linkId: '',
		calendar: 'bookings',
		title: '',
		start: '',
		end: '', // inclusive in the UI, converted to exclusive on save
		status: 'confirmed' as 'confirmed' | 'tentative',
		description: '',
		resourceIds: [] as string[]
	});
	let tab = $state<'details' | 'resources' | 'conflicts'>('details');
	let resolving = $state<string | null>(null);
	let moveTo = $state<Record<string, string>>({});
	let busy = $state(false);
	let loadError = $state<string | null>(null);
	let saveError = $state<string | null>(null);

	// (re)initialise whenever the route changes
	$effect(() => {
		const id = eventId;
		const sp = page.url.searchParams;
		loadError = saveError = null;
		if (id) {
			getEvent({ eventId: id, calendar: sp.get('cal') ?? undefined })
				.then((e: EventDetail) => {
					form = { id: e.id, linkId: e.linkId, calendar: e.calendar, title: e.title, start: e.start, end: dayToIso(isoToDay(e.end) - 1), status: e.status, description: e.description, resourceIds: e.resourceIds };
				})
				.catch((e: unknown) => (loadError = e instanceof Error ? e.message : 'Could not load the event'));
		} else {
			const row = sp.get('row');
			const isMain = calendars.some((c) => c.value === row);
			const from = sp.get('from') ?? dayToIso(TODAY);
			const to = sp.get('to');
			form = {
				id: undefined,
				linkId: '',
				calendar: isMain ? row! : 'bookings',
				title: '',
				start: from,
				end: to ? dayToIso(isoToDay(to) - 1) : from,
				status: 'confirmed',
				description: '',
				resourceIds: row && !isMain ? [row] : []
			};
		}
	});

	const resourceGroups = $derived(
		(timeline.meta?.groups ?? [])
			.map((g) => ({ ...g, rows: (timeline.meta?.rows ?? []).filter((r) => r.groupId === g.id && r.kind === 'resource') }))
			.filter((g) => g.rows.length)
	);

	function toggle(id: string, on: boolean) {
		form.resourceIds = on ? [...new Set([...form.resourceIds, id])] : form.resourceIds.filter((x) => x !== id);
	}
	function toggleGroup(ids: string[]) {
		const all = ids.every((i) => form.resourceIds.includes(i));
		form.resourceIds = all ? form.resourceIds.filter((x) => !ids.includes(x)) : [...new Set([...form.resourceIds, ...ids])];
	}

	// ----- warnings -----
	const sD = $derived(form.start ? isoToDay(form.start) : 0);
	const eD = $derived(form.end ? isoToDay(form.end) + 1 : 0); // exclusive
	type Conflict = { key: string; rid: string; label: string; ev: CalEvent };
	const overlaps = (e: CalEvent) => isoToDay(e.start) < eD && isoToDay(e.end) > sD;
	const isSelf = (e: CalEvent) => e.id === form.id || (!!form.linkId && e.linkId === form.linkId);
	const conflicts = $derived.by(() => {
		const out: Conflict[] = [];
		for (const rid of form.resourceIds) {
			const label = timeline.meta?.rows.find((r) => r.id === rid)?.label ?? rid;
			for (const ev of timeline.eventsOf(rid)) if (!isSelf(ev) && overlaps(ev)) out.push({ key: rid + ev.id, rid, label, ev });
		}
		return out;
	});

	// load the resources we may need for conflict checks / alternatives (selected rooms + their group mates)
	$effect(() => {
		if (!timeline.meta || !form.start || !form.end) return;
		const groupIds = new Set(form.resourceIds.map((id) => timeline.meta!.rows.find((r) => r.id === id)?.groupId));
		const ids = timeline.meta.rows.filter((r) => r.kind === 'resource' && (form.resourceIds.includes(r.id) || groupIds.has(r.groupId))).map((r) => r.id);
		const a = sD,
			b = eD;
		if (ids.length) untrack(() => timeline.ensure(ids, a, b));
	});

	/** rooms of the same group that are free for the conflicting booking and not wanted by this booking */
	function alternatives(c: Conflict) {
		const rows = timeline.meta?.rows ?? [];
		const group = rows.find((r) => r.id === c.rid)?.groupId;
		const s0 = isoToDay(c.ev.start),
			e0 = isoToDay(c.ev.end);
		return rows.filter(
			(r) =>
				r.kind === 'resource' &&
				r.groupId === group &&
				r.id !== c.rid &&
				!form.resourceIds.includes(r.id) &&
				!timeline.eventsOf(r.id).some((e) => e.linkId !== c.ev.linkId && isoToDay(e.start) < e0 && isoToDay(e.end) > s0)
		);
	}

	async function resolve(c: Conflict, action: 'release' | 'move') {
		resolving = c.key;
		saveError = null;
		try {
			await resolveConflict({ rowId: c.rid, eventId: c.ev.id, action, toResourceId: action === 'move' ? moveTo[c.key] : undefined });
			timeline.invalidate();
		} catch (e) {
			saveError = e instanceof Error ? e.message : 'Could not update the booking';
		} finally {
			resolving = null;
		}
	}
	const retreatGap = $derived.by(() => {
		if (form.calendar !== 'retreats') return null;
		for (const e of timeline.eventsOf('retreats')) {
			if (e.id === form.id || (form.linkId && e.linkId === form.linkId)) continue;
			const s = isoToDay(e.start),
				en = isoToDay(e.end);
			const gap = s >= eD ? s - eD : sD >= en ? sD - en : -1;
			if (gap >= 0 && gap < 1) return `Less than one free day between this retreat and "${e.title}".`;
			if (gap < 0) return `Overlaps with the retreat "${e.title}".`;
		}
		return null;
	});

	const valid = $derived(form.title.trim() && form.start && form.end && form.end >= form.start);

	async function save() {
		busy = true;
		saveError = null;
		try {
			await saveEvent({
				id: form.id,
				calendar: form.calendar,
				title: form.title,
				start: form.start,
				end: dayToIso(isoToDay(form.end) + 1),
				status: form.status,
				description: form.description,
				resourceIds: form.resourceIds
			});
			timeline.invalidate();
			await close();
		} catch (e) {
			saveError = e instanceof Error ? e.message : 'Could not save';
		} finally {
			busy = false;
		}
	}
	async function remove() {
		if (!form.id || !confirm('Delete this booking?')) return;
		busy = true;
		try {
			await deleteEvent({ calendar: form.calendar, id: form.id });
			timeline.invalidate();
			await close();
		} catch (e) {
			saveError = e instanceof Error ? e.message : 'Could not delete';
		} finally {
			busy = false;
		}
	}
	const close = () => goto('/', { reset: false });
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && close()} />

<div class="flex items-center gap-2 border-b border-line px-4 py-3">
	<h2 class="mr-auto text-xl">{eventId ? 'Edit booking' : 'New booking'}</h2>
	<button class="rounded p-1 hover:bg-surface-2" onclick={close} aria-label="Close"><X size={18} /></button>
</div>

<div class="flex gap-1 border-b border-line px-3 pt-2">
	{#each [['details', 'Details'], ['resources', `Resources (${form.resourceIds.length})`], ...(conflicts.length ? [['conflicts', `Conflicts (${conflicts.length})`]] : [])] as [id, label] (id)}
		<button class="rounded-t-md border-b-2 px-3 py-1.5 text-sm {tab === id ? 'border-accent font-bold text-accent' : 'border-transparent text-muted'}" onclick={() => (tab = id as typeof tab)}>{label}</button>
	{/each}
</div>

<div class="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
	{#if loadError}<p class="text-sm text-secondary-700 dark:text-secondary-300">{loadError}</p>{/if}
	{#if conflicts.length}
		<button type="button" class="w-full rounded-md bg-amber/15 px-3 py-2 text-left text-sm" onclick={() => (tab = 'conflicts')}>⚠ {conflicts.length} conflicting {conflicts.length === 1 ? 'booking' : 'bookings'} – release or move them</button>
	{/if}
	{#if retreatGap}<p class="rounded-md bg-amber/15 px-3 py-2 text-sm">⚠ {retreatGap}</p>{/if}

	{#if tab === 'details'}
		<div>
			<Label for="f-title" class="mb-1">Title</Label>
			<Input id="f-title" bind:value={form.title} placeholder="e.g. Yoga retreat" />
		</div>
		<div>
			<Label for="f-cal" class="mb-1">Calendar</Label>
			<Select id="f-cal" items={calendars} bind:value={form.calendar} disabled={!!form.id} />
		</div>
		<div class="grid grid-cols-2 gap-3">
			<div>
				<Label for="f-from" class="mb-1">From</Label>
				<Input id="f-from" type="date" bind:value={form.start} />
			</div>
			<div>
				<Label for="f-to" class="mb-1">To (inclusive)</Label>
				<Input id="f-to" type="date" min={form.start} bind:value={form.end} />
			</div>
		</div>
		<div>
			<Label for="f-status" class="mb-1">Status</Label>
			<Select id="f-status" items={[{ value: 'confirmed', name: 'Confirmed' }, { value: 'tentative', name: 'Tentative' }]} bind:value={form.status} />
		</div>
		<div>
			<Label for="f-desc" class="mb-1">Notes</Label>
			<Textarea id="f-desc" rows={4} bind:value={form.description} />
		</div>
	{:else if tab === 'conflicts'}
		<p class="text-sm text-muted">The booking itself stays – only its room reservation is changed. For a series this affects just the conflicting date.</p>
		{#each conflicts as c (c.key)}
			{@const alts = alternatives(c)}
			<div class="space-y-2 rounded-lg border border-line p-3">
				<div class="text-sm"><b>{c.ev.title}</b><br /><span class="text-muted">{c.label} · {c.ev.start}{c.ev.end > dayToIso(isoToDay(c.ev.start) + 1) ? ` – ${dayToIso(isoToDay(c.ev.end) - 1)}` : ''}</span></div>
				<div class="flex flex-wrap items-center gap-2">
					<Button size="xs" color="alternative" disabled={resolving === c.key} onclick={() => resolve(c, 'release')}>Release room</Button>
					<Select class="!w-auto flex-1" size="sm" placeholder="Move to…" items={alts.map((r) => ({ value: r.id, name: r.label }))} bind:value={moveTo[c.key]} disabled={!alts.length} />
					<Button size="xs" disabled={!moveTo[c.key] || resolving === c.key} onclick={() => resolve(c, 'move')}>Move</Button>
				</div>
				{#if !alts.length}<p class="text-xs text-muted">No free alternative room in this group.</p>{/if}
			</div>
		{/each}
	{:else}
		{#each resourceGroups as g (g.id)}
			<fieldset>
				<legend class="mb-1 flex w-full items-center justify-between font-display text-base font-bold">
					{g.label}
					<button type="button" class="text-xs font-normal text-accent underline" onclick={() => toggleGroup(g.rows.map((r) => r.id))}>toggle all</button>
				</legend>
				<div class="grid grid-cols-2 gap-x-3 gap-y-1">
					{#each g.rows as r (r.id)}
						<Checkbox checked={form.resourceIds.includes(r.id)} onchange={(e) => toggle(r.id, (e.currentTarget as HTMLInputElement).checked)}>{r.label}</Checkbox>
					{/each}
				</div>
			</fieldset>
		{:else}
			<p class="text-sm text-muted">No resource calendars found. Subscribe the service account's user to them first.</p>
		{/each}
	{/if}
	{#if saveError}<p class="text-sm text-secondary-700 dark:text-secondary-300">{saveError}</p>{/if}
</div>

<div class="flex items-center gap-2 border-t border-line p-3">
	{#if form.id}<Button color="red" outline size="sm" onclick={remove} disabled={busy}>Delete</Button>{/if}
	<Button color="alternative" size="sm" class="ml-auto" onclick={close}>Cancel</Button>
	<Button size="sm" onclick={save} disabled={!valid || busy}>{busy ? 'Saving…' : 'Save'}</Button>
</div>
