<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Button, Checkbox, Input, Label, Select, Textarea } from 'flowbite-svelte';
	import { X } from '@lucide/svelte';
	import { deleteEvent, getEvent, saveEvent } from '#lib/calendar.remote';
	import { timeline } from '#lib/timeline.svelte';
	import { TODAY, dayToIso, isoToDay } from '#lib/time';
	import type { EventDetail } from '#lib/types';

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
	let tab = $state<'details' | 'resources'>('details');
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
	const conflicts = $derived.by(() => {
		const out: string[] = [];
		for (const rid of form.resourceIds) {
			const label = timeline.meta?.rows.find((r) => r.id === rid)?.label ?? rid;
			for (const e of timeline.eventsOf(rid)) {
				if (e.id === form.id || (form.linkId && e.linkId === form.linkId)) continue;
				if (isoToDay(e.start) < eD && isoToDay(e.end) > sD) out.push(`${label} is already booked: ${e.title}`);
			}
		}
		return out;
	});
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
	{#each [['details', 'Details'], ['resources', `Resources (${form.resourceIds.length})`]] as [id, label] (id)}
		<button class="rounded-t-md border-b-2 px-3 py-1.5 text-sm {tab === id ? 'border-accent font-bold text-accent' : 'border-transparent text-muted'}" onclick={() => (tab = id as typeof tab)}>{label}</button>
	{/each}
</div>

<div class="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
	{#if loadError}<p class="text-sm text-secondary-700 dark:text-secondary-300">{loadError}</p>{/if}
	{#each [...conflicts, ...(retreatGap ? [retreatGap] : [])] as w (w)}
		<p class="rounded-md bg-amber/15 px-3 py-2 text-sm">⚠ {w}</p>
	{/each}

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
