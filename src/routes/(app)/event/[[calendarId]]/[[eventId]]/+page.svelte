<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { Badge, Button, Checkbox, CloseButton, Input, Label, Select, TabItem, Tabs, Textarea, Toggle } from 'flowbite-svelte';
	import { deleteEvent, getEvent, resolveConflict, saveEvent } from '#lib/calendar.remote';
	import { calendarIdFromSlug } from '#lib/calendar-id';
	import { getTimeline } from '#lib/timeline.svelte';
	import { TODAY, dayToIso, exclusiveEndIso, isoToDay, toMinutes } from '#lib/time';
	import type { CalEvent, EventDetail } from '#lib/types';

	const timeline = getTimeline();

	const eventId = $derived(page.params.eventId);
	/** calendar from the path: the booking's calendar (edit) or the calendar of the row it was created in (new) */
	const pathCalendar = $derived(calendarIdFromSlug(page.params.calendarId));

	const fromResource = $derived(!eventId && !!page.url.searchParams.get('row')?.endsWith('@resource.calendar.google.com'));
	const groupLabel = (id: string) => timeline.meta?.groups.find((g) => g.id === id)?.label ?? '';
	const calendars = $derived(
		(timeline.meta?.rows ?? []).filter((r) => r.kind === 'calendar' && r.writable).map((r) => ({ value: r.id, name: r.label }))
	);
	/** writable calendars grouped for <optgroup> */
	const calendarOptions = $derived(
		(timeline.meta?.groups ?? [])
			.map((g) => ({ label: g.label, items: (timeline.meta?.rows ?? []).filter((r) => r.groupId === g.id && r.kind === 'calendar' && r.writable) }))
			.filter((g) => g.items.length)
	);
	const defaultCalendar = $derived(
		timeline.meta?.rows.find((r) => r.writable && /guest|volunteer|booking/i.test(r.label + groupLabel(r.groupId)))?.id ?? calendars[0]?.value ?? ''
	);

	let form = $state({
		id: undefined as string | undefined,
		linkId: '',
		calendar: '',
		title: '',
		start: '',
		end: '', // inclusive in the UI, converted to exclusive on save
		status: 'confirmed' as 'confirmed' | 'tentative',
		description: '',
		allDay: true,
		startTime: '09:00',
		endTime: '10:00',
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
			getEvent({ eventId: id, calendar: pathCalendar })
				.then((e: EventDetail) => {
					form = { id: e.id, linkId: e.linkId, calendar: e.calendar, title: e.title, start: e.start, end: e.allDay ? dayToIso(isoToDay(e.end) - 1) : e.end, status: e.status, description: e.description, allDay: e.allDay, startTime: e.startTime || '09:00', endTime: e.endTime || '10:00', resourceIds: e.resourceIds };
				})
				.catch((e: unknown) => (loadError = e instanceof Error ? e.message : 'Could not load the event'));
		} else {
			const row = pathCalendar ?? sp.get('row');
			const isMain = !!row && !row.endsWith('@resource.calendar.google.com');
			const from = sp.get('from') ?? dayToIso(TODAY);
			const to = sp.get('to');
			form = {
				id: undefined,
				linkId: '',
				calendar: isMain ? row! : '',
				title: '',
				start: from,
				end: to ? dayToIso(isoToDay(to) - 1) : from,
				status: 'confirmed',
				description: '',
				allDay: true,
				startTime: '09:00',
				endTime: '10:00',
				resourceIds: row && !isMain ? [row] : []
			};
		}
	});

	// preselect a calendar once the calendar list is known
	$effect(() => {
		// created from a room row: the user has to pick the calendar
		if (!form.calendar && defaultCalendar && !fromResource) form.calendar = defaultCalendar;
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
	// exclusive end day, same rule as the timeline bars: a timed event ending exactly at 00:00 does not occupy that day
	const eD = $derived(!form.end ? 0 : isoToDay(exclusiveEndIso(form.start, form.end, form.allDay ? null : form.endTime)));
	type Conflict = { key: string; rid: string; label: string; ev: CalEvent };
	/** time span in wall-clock minutes: exact for timed events, whole days for all-day ones */
	const spanOf = (e: CalEvent): [number, number] =>
		e.fromLocal && e.toLocal
			? [toMinutes(e.fromLocal.slice(0, 10), e.fromLocal.slice(11)), toMinutes(e.toLocal.slice(0, 10), e.toLocal.slice(11))]
			: [isoToDay(e.start) * 1440, isoToDay(e.end) * 1440];
	const formSpan = $derived<[number, number]>(
		!form.start || !form.end
			? [0, 0]
			: form.allDay
				? [isoToDay(form.start) * 1440, (isoToDay(form.end) + 1) * 1440]
				: [toMinutes(form.start, form.startTime), toMinutes(form.end, form.endTime)]
	);
	const overlaps = (e: CalEvent) => {
		const [a, b] = spanOf(e);
		return a < formSpan[1] && b > formSpan[0];
	};
	const timeLabel = (e: CalEvent) => (e.fromLocal && e.toLocal ? ` ${e.fromLocal.slice(11)}–${e.toLocal.slice(11)}` : '');
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
		// with conflicts every room is a possible move target, so all of them are loaded
		const all = conflicts.length > 0;
		const ids = timeline.meta.rows.filter((r) => r.kind === 'resource' && (all || form.resourceIds.includes(r.id) || groupIds.has(r.groupId))).map((r) => r.id);
		const a = sD,
			b = eD;
		if (ids.length) untrack(() => timeline.ensure(ids, a, b));
	});

	/** every room that is free for the conflicting booking and not wanted by this booking, grouped; same group first */
	function alternatives(c: Conflict) {
		const rows = timeline.meta?.rows ?? [];
		const own = rows.find((r) => r.id === c.rid)?.groupId;
		const [s0, e0] = spanOf(c.ev);
		const free = rows.filter(
			(r) =>
				r.kind === 'resource' &&
				r.id !== c.rid &&
				!form.resourceIds.includes(r.id) &&
				!timeline.eventsOf(r.id).some((e) => e.linkId !== c.ev.linkId && spanOf(e)[0] < e0 && spanOf(e)[1] > s0)
		);
		return (timeline.meta?.groups ?? [])
			.map((g) => ({ label: g.label, own: g.id === own, items: free.filter((r) => r.groupId === g.id) }))
			.filter((g) => g.items.length)
			.sort((a, b) => Number(b.own) - Number(a.own));
	}

	async function resolve(c: Conflict, action: 'release' | 'move') {
		resolving = c.key;
		saveError = null;
		try {
			const res = await resolveConflict({ rowId: c.rid, eventId: c.ev.id, action, toResourceId: action === 'move' ? moveTo[c.key] : undefined });
			timeline.applyFresh(res.fresh);
		} catch (e) {
			saveError = e instanceof Error ? e.message : 'Could not update the booking';
		} finally {
			resolving = null;
		}
	}
	const retreatGap = $derived.by(() => {
		const cal = timeline.meta?.rows.find((r) => r.id === form.calendar);
		if (!cal || !/retreat/i.test(cal.label)) return null;
		for (const e of timeline.eventsOf(cal.id)) {
			if (e.id === form.id || (form.linkId && e.linkId === form.linkId)) continue;
			const s = isoToDay(e.start),
				en = isoToDay(e.end);
			const gap = s >= eD ? s - eD : sD >= en ? sD - en : -1;
			if (gap >= 0 && gap < 1) return `Less than one free day between this retreat and "${e.title}".`;
			if (gap < 0) return `Overlaps with the retreat "${e.title}".`;
		}
		return null;
	});

	const valid = $derived(form.calendar && form.title.trim() && form.start && form.end && form.end >= form.start);

	async function save() {
		busy = true;
		saveError = null;
		try {
			const res = await saveEvent({
				id: form.id,
				calendar: form.calendar,
				title: form.title,
				start: form.start,
				end: form.allDay ? dayToIso(isoToDay(form.end) + 1) : form.end,
				allDay: form.allDay,
				startTime: form.allDay ? undefined : form.startTime,
				endTime: form.allDay ? undefined : form.endTime,
				status: form.status,
				description: form.description,
				resourceIds: form.resourceIds
			});
			timeline.applyFresh(res.fresh);
			// no conflicts: show the room bookings right away as tentative, Google mirrors them a moment later
			if (!conflicts.length) {
				const pending = form.resourceIds.filter((rid) => !res.fresh.rows[rid]?.some((e) => e.linkId === res.linkId));
				if (pending.length) {
					timeline.addOptimistic(
						pending.map((rid) => ({
							id: `optimistic:${res.linkId}:${rid}`,
							rowId: rid,
							linkId: res.linkId,
							title: form.title,
							start: form.start,
							end: dayToIso(isoToDay(form.end) + 1),
							status: 'tentative' as const,
							description: form.description
						}))
					);
					void timeline.confirm(pending, res.fresh.from, res.fresh.to, res.linkId);
				}
			}
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
			const res = await deleteEvent({ calendar: form.calendar, id: form.id });
			timeline.applyFresh(res.fresh);
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
	<CloseButton onclick={close} />
</div>

<!-- the tab bodies are rendered below; the items only carry the titles -->
<Tabs bind:selected={tab} tabStyle="underline" class="px-3" contentClass="hidden">
	<TabItem key="details" title="Details" />
	<TabItem key="resources" title="Resources ({form.resourceIds.length})" />
	{#if conflicts.length}<TabItem key="conflicts" title="Conflicts ({conflicts.length})" />{/if}
</Tabs>

<div class="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
	{#if loadError}<p class="text-sm text-secondary-700 dark:text-secondary-300">{loadError}</p>{/if}
	{#if conflicts.length}
		<button type="button" class="block w-full text-left" onclick={() => (tab = 'conflicts')}>
			<Badge color="yellow" large class="w-full justify-start whitespace-normal">⚠ {conflicts.length} conflicting {conflicts.length === 1 ? 'booking' : 'bookings'} – release or move them</Badge>
		</button>
	{/if}
	{#if retreatGap}<Badge color="yellow" large class="w-full justify-start whitespace-normal">⚠ {retreatGap}</Badge>{/if}

	{#if tab === 'details'}
		<div>
			<Label for="f-title" class="mb-1">Title</Label>
			<Input id="f-title" bind:value={form.title} placeholder="e.g. Yoga retreat" />
		</div>
		<div>
			<Label for="f-cal" class="mb-1">Calendar</Label>
			<select
				id="f-cal"
				class="block w-full rounded-lg border border-line bg-surface p-2.5 text-sm text-ink focus:border-primary-500 focus:ring-primary-500 disabled:opacity-60"
				bind:value={form.calendar}
				disabled={!!form.id}
			>
				<option value="" disabled>Choose a calendar…</option>
				{#each calendarOptions as g (g.label)}
					<optgroup label={g.label}>
						{#each g.items as r (r.id)}<option value={r.id}>{r.label}</option>{/each}
					</optgroup>
				{/each}
			</select>
			{#if !form.calendar}<p class="mt-1 text-xs text-muted">Pick the calendar this booking belongs to.</p>{/if}
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
		<Checkbox bind:checked={form.allDay}>All day</Checkbox>
		{#if !form.allDay}
			<div class="grid grid-cols-2 gap-3">
				<div>
					<Label for="f-t1" class="mb-1">Start time</Label>
					<Input id="f-t1" type="time" bind:value={form.startTime} />
				</div>
				<div>
					<Label for="f-t2" class="mb-1">End time</Label>
					<Input id="f-t2" type="time" bind:value={form.endTime} />
				</div>
			</div>
		{/if}
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
				<div class="text-sm"><b>{c.ev.title}</b><br /><span class="text-muted">{c.label} · {c.ev.start}{timeLabel(c.ev)}{c.ev.end > dayToIso(isoToDay(c.ev.start) + 1) ? ` – ${dayToIso(isoToDay(c.ev.end) - 1)}` : ''}</span></div>
				<div class="flex flex-wrap items-center gap-2">
					<Button size="xs" color="alternative" disabled={resolving === c.key} onclick={() => resolve(c, 'release')}>Release room</Button>
					<select
						class="min-w-0 flex-1 rounded-lg border border-line bg-surface p-2 text-sm text-ink disabled:opacity-60"
						bind:value={moveTo[c.key]}
						disabled={!alts.length}
						aria-label="Move the room reservation to"
					>
						<option value={undefined} disabled>Move to…</option>
						{#each alts as g (g.label)}
							<optgroup label={g.label}>
								{#each g.items as r (r.id)}<option value={r.id}>{r.label}</option>{/each}
							</optgroup>
						{/each}
					</select>
					<Button size="xs" disabled={!moveTo[c.key] || resolving === c.key} onclick={() => resolve(c, 'move')}>Move</Button>
				</div>
				{#if !alts.length}<p class="text-xs text-muted">No free room for these dates: all {(timeline.meta?.rows ?? []).filter((r) => r.kind === 'resource').length} room calendars are either part of this booking or already booked.</p>{/if}
			</div>
		{/each}
	{:else}
		{#each resourceGroups as g (g.id)}
			<fieldset>
				<legend class="mb-1 flex w-full items-center justify-between font-display text-base font-bold">
					{g.label}
					<Toggle size="small" class="text-xs font-normal" checked={g.rows.every((r) => form.resourceIds.includes(r.id))} onchange={() => toggleGroup(g.rows.map((r) => r.id))}>All</Toggle>
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
	<Button size="sm" onclick={save} loading={busy} disabled={!valid}>Save</Button>
</div>
