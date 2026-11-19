<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageProps } from './$types';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { ChevronDown } from '@lucide/svelte';
	import { Badge, Button, ButtonGroup, Checkbox, CloseButton, Dropdown, DropdownItem, Input, Label, Select, Spinner, TabItem, Tabs, Textarea, Toggle } from 'flowbite-svelte';
	import { deleteEvent, getEvent, resolveConflict, saveEvent } from '#lib/calendar.remote';
	import { calendarIdFromSlug } from '#lib/calendar-id';
	import { overlaps as overlapsSpan, spanOf } from '#lib/conflicts';
	import { getTimeline } from '#lib/timeline.svelte';
	import { dayToIso, exclusiveEndIso, isoToDay, localTodayIso, toMinutes } from '#lib/time';
	import type { CalEvent, EventDetail } from '#lib/types';
import { newParticipant, participantKind, participantsProblem, supportsParticipants, type Participant } from '#lib/participants';
import { jobsProblem, newJob, prepareJobs, slugify, supportsJobs, type Job } from '#lib/jobs';
	import { MOON_PHASES, MOON_RELATIONS } from '#lib/moon';
	import { moonDates, type Repeat } from '#lib/recurrence';

	let { data }: PageProps = $props();
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
		resourceIds: [] as string[],
		jobs: [] as Job[],
		participants: [] as Participant[],
		type: '',
		seriesId: ''
	});
	/** event key as stored on the event: fixed once set, sign-ups are stored under it */
	let savedType = $state('');
	/** jobs/key/scope as loaded, to tell whether the Jobs tab was touched */
	let jobsBase = $state(JSON.stringify([[], '']));
	/** participants as loaded, to tell whether the tab was touched */
	let partsBase = $state('[]');
	/** which mails were sent to whom (lower-case email -> mail -> time) */
	let mailSent = $state<EventDetail['mailSent']>({});
	let tab = $state<'details' | 'resources' | 'participants' | 'jobs' | 'conflicts'>('details');
	let resolving = $state<string | null>(null);
	let moveTo = $state<Record<string, string>>({});
	let busy = $state(false);
	let loadError = $state<string | null>(null);
	/** an existing booking is being fetched */
	let loading = $state(false);
	let saveError = $state<string | null>(null);
	let scopeOpen = $state(false);
	let deleteOpen = $state(false);
	/** first day when the event was opened: "following" and "all" cannot move it */
	let savedStart = $state('');
	const dayChanged = $derived(!!form.id && !!savedStart && form.start !== savedStart);

	// (re)initialise whenever the route changes
	$effect(() => {
		const id = eventId;
		const sp = page.url.searchParams;
		loadError = saveError = null;
		loading = !!id;
		mailSent = {};
		if (id) {
			getEvent({ eventId: id, calendar: pathCalendar })
				.then((e: EventDetail) => {
					if (id !== eventId) return; // another booking was opened meanwhile
					form = { id: e.id, linkId: e.linkId, calendar: e.calendar, title: e.title, start: e.start, end: e.allDay ? dayToIso(isoToDay(e.end) - 1) : e.end, status: e.status, description: e.description, allDay: e.allDay, startTime: e.startTime || '09:00', endTime: e.endTime || '10:00', resourceIds: e.resourceIds, jobs: e.jobs, participants: e.participants, type: e.type, seriesId: e.seriesId };
					savedType = e.type;
					const loaded = repFromEvent(e);
					rep = loaded;
					savedStart = e.start;
					repBase = JSON.stringify(loaded);
					jobsBase = JSON.stringify([e.jobs, e.type]);
					partsBase = JSON.stringify(e.participants);
					mailSent = e.mailSent;
				})
				.catch((e: unknown) => (loadError = e instanceof Error ? e.message : 'Could not load the event'))
				.finally(() => id === eventId && (loading = false));
		} else {
			const row = pathCalendar ?? sp.get('row');
			const isMain = !!row && !row.endsWith('@resource.calendar.google.com');
			const from = sp.get('from') ?? localTodayIso();
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
				resourceIds: row && !isMain ? [row] : [],
				jobs: [],
				participants: [],
				type: '',
				seriesId: ''
			};
			savedType = '';
			// not read back from `rep`: this effect would depend on the state it writes
			const fresh = newRep();
			rep = fresh;
			repBase = JSON.stringify(fresh);
			repeatCustom = [];
			jobsBase = JSON.stringify([[], '']);
			partsBase = '[]';
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

	// ----- repeat: new events, single events becoming a series, and existing series (changes apply to the whole series) -----
	const WEEKDAYS = [['Mon', 1], ['Tue', 2], ['Wed', 3], ['Thu', 4], ['Fri', 5], ['Sat', 6], ['Sun', 0]] as const;
	const MOON_LABELS = { NEW_MOON: 'New moon', FIRST_QUARTER: 'First quarter', FULL_MOON: 'Full moon', LAST_QUARTER: 'Last quarter' } as const;
	const RELATION_LABELS = { EXACT: 'on the day of', LAST_BEFORE: 'last one before', LAST_ON_OR_BEFORE: 'last one on or before', FIRST_AFTER: 'first one after', FIRST_ON_OR_AFTER: 'first one on or after' } as const;
	const newRep = () => ({ kind: 'none' as 'none' | 'weekly' | 'moon' | 'keep', days: null as number[] | null, interval: 1, until: '', phase: 'FULL_MOON' as (typeof MOON_PHASES)[number], relation: 'LAST_BEFORE' as (typeof MOON_RELATIONS)[number], weekday: null as number | null });
	let rep = $state(newRep());
	const startWeekday = $derived(form.start ? new Date(form.start + 'T00:00:00Z').getUTCDay() : 1);
	/** until chosen otherwise, the repeat falls on the weekday of the start date */
	const repDays = $derived(rep.days ?? [startWeekday]);
	const repWeekday = $derived(rep.weekday ?? startWeekday);
	let repBase = $state(JSON.stringify(newRep()));
	let repeatCustom = $state<string[]>([]);
	const inSeriesNow = $derived(!!form.seriesId);
	/** the repeat as stored on the event; unknown recurrence rules are kept as they are */
	function repFromEvent(e: EventDetail) {
		const r = newRep();
		repeatCustom = e.repeatCustom;
		if (e.repeat?.kind === 'weekly') Object.assign(r, { kind: 'weekly', interval: e.repeat.interval, days: e.repeat.weekdays, until: e.repeat.until ?? '' });
		else if (e.repeat?.kind === 'moon') Object.assign(r, { kind: 'moon', phase: e.repeat.phase, relation: e.repeat.relation, weekday: e.repeat.weekday, until: e.repeat.until });
		else if (e.repeatCustom.length) r.kind = 'keep';
		return r;
	}
	const repeat = $derived<Repeat | undefined>(
		JSON.stringify(rep) === repBase ? undefined
		: rep.kind === 'weekly' ? { kind: 'weekly', interval: Number(rep.interval), weekdays: repDays, until: rep.until || undefined }
		: rep.kind === 'moon' ? { kind: 'moon', phase: rep.phase, relation: rep.relation, weekday: Number(repWeekday), until: rep.until }
		: undefined
	);
	const moonPreview = $derived(repeat?.kind === 'moon' && repeat.until && form.start ? moonDates(repeat, form.start, repeat.until) : []);
	const repeatError = $derived(
		repeat?.kind === 'weekly' && !repeat.weekdays.length ? 'Pick at least one weekday'
		: repeat?.kind === 'moon' && !repeat.until ? 'Choose an end date'
		: repeat && dayChanged ? 'The repeat cannot be changed together with the day: save the day for this event first'
		: repeat?.kind === 'moon' && !moonPreview.length ? 'No matching dates in that period'
		: null
	);
	// moon dates are listed one by one, so they need an end: half a year by default
	$effect(() => {
		if (rep.kind === 'moon' && !rep.until && form.start) rep.until = dayToIso(isoToDay(form.start) + 180);
	});

	// ----- jobs -----
	const jobsEnabled = $derived.by(() => {
		const r = timeline.meta?.rows.find((x) => x.id === form.calendar);
		return !!r && supportsJobs(groupLabel(r.groupId), r.label);
	});
	const jobsError = $derived(jobsEnabled ? jobsProblem(form.jobs, form.type) : null);
	const jobsDirty = $derived(JSON.stringify([form.jobs, form.type]) !== jobsBase);

	// ----- participants (guest / volunteer bookings) -----
	const partsEnabled = $derived.by(() => {
		const r = timeline.meta?.rows.find((x) => x.id === form.calendar);
		return !!r && supportsParticipants(groupLabel(r.groupId), r.label);
	});
	const mailName = (name: string) => (name === 'thanks' ? 'thank-you' : name);
	/** "welcome: sent 18 Nov, 12:30 · thank-you: not sent" for a person who is already on the saved event */
	function sentLine(email: string) {
		const mails = mailSent[email.trim().toLowerCase()];
		if (!mails) return '';
		return Object.entries(mails)
			.map(([name, at]) => `${mailName(name)}: ${at === null ? 'not sent' : at ? `sent ${new Date(at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : 'sent'}`)
			.join(' · ');
	}
	/** "a welcome mail 7 days before arrival and a thank-you mail 1 day after departure", from the CMS texts */
	const mailHint = $derived.by(() => {
		const r = timeline.meta?.rows.find((x) => x.id === form.calendar);
		if (!r) return '';
		const parts = data.mails[participantKind(groupLabel(r.groupId), r.label)].map((m) => {
			const what = m.when === 'before' ? 'arrival' : 'departure';
			const when = m.days === 0 ? `on the day of ${what}` : `${m.days} day${m.days === 1 ? '' : 's'} ${m.when} ${what}`;
			return `a ${mailName(m.name)} mail ${when}`;
		});
		return parts.length ? `Each person gets ${parts.join(' and ')}.` : '';
	});
	const partsError = $derived(partsEnabled ? participantsProblem(form.participants) : null);
	const partsDirty = $derived(JSON.stringify(form.participants) !== partsBase);

	// ----- warnings -----
	const sD = $derived(form.start ? isoToDay(form.start) : 0);
	// exclusive end day, same rule as the timeline bars: a timed event ending exactly at 00:00 does not occupy that day
	const eD = $derived(!form.end ? 0 : isoToDay(exclusiveEndIso(form.start, form.end, form.allDay ? null : form.endTime)));
	type Conflict = { key: string; rid: string; label: string; ev: CalEvent };
	const formSpan = $derived<[number, number]>(
		!form.start || !form.end
			? [0, 0]
			: form.allDay
				? [isoToDay(form.start) * 1440, (isoToDay(form.end) + 1) * 1440]
				: [toMinutes(form.start, form.startTime), toMinutes(form.end, form.endTime)]
	);
	const overlaps = (e: CalEvent) => overlapsSpan(e, formSpan);
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

	const valid = $derived(form.calendar && form.title.trim() && form.start && form.end && form.end >= form.start && !jobsError && !partsError && !repeatError);

	// jobs and repeat describe the series, so they are saved for all events unless chosen otherwise
	async function save(scope: 'this' | 'following' | 'all' = repeat || (jobsEnabled && jobsDirty) ? 'all' : 'this') {
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
				resourceIds: form.resourceIds,
				scope,
				...(repeat ? { repeat } : {}),
				// only when the Jobs tab was touched, so other edits never rewrite them
				// likewise the participants; they belong to one booking, so no scope is forced
				...(partsEnabled && partsDirty ? { participants: form.participants } : {}),
				...(jobsEnabled && jobsDirty ? { jobs: prepareJobs(form.jobs), type: form.type || undefined } : {})
			});
			timeline.applyFresh(res.fresh);
			if ('conflict' in res) {
				// the rooms were booked meanwhile: nothing was saved, the Conflicts tab lists the bookings in the way
				tab = 'conflicts';
				return;
			}
			// no conflicts: show the room bookings right away as tentative, Google mirrors them a moment later
			if (!conflicts.length) {
				const pending = form.resourceIds.filter((rid) => !res.fresh.rows[rid]?.some((e) => e.linkId === res.linkId));
				if (pending.length) {
					const optimistic = pending.map((rid) => ({
						id: `optimistic:${res.linkId}:${rid}`,
						rowId: rid,
						originRow: form.calendar,
						linkId: res.linkId,
						title: form.title,
						start: form.start,
						end: dayToIso(isoToDay(form.end) + 1),
						status: 'tentative' as const,
						description: form.description
					}));
					timeline.addOptimistic(optimistic);
					void timeline.confirm(pending, res.fresh.from, res.fresh.to, res.linkId, optimistic);
				}
			}
			await close();
		} catch (e) {
			saveError = e instanceof Error ? e.message : 'Could not save';
		} finally {
			busy = false;
		}
	}
	async function remove(scope: 'this' | 'following' | 'all' = 'this') {
		const what = { this: 'Delete this booking?', following: 'Delete this and all following events of the series?', all: 'Delete all events of the series?' }[scope];
		if (!form.id || !confirm(what)) return;
		busy = true;
		try {
			const res = await deleteEvent({ calendar: form.calendar, id: form.id, scope });
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

<div class="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-surface px-4 md:static">
	<h2 class="mr-auto text-xl">{eventId ? 'Edit booking' : 'New booking'}</h2>
	<CloseButton onclick={close} />
</div>

<div class="flex min-h-0 flex-1 flex-col md:overflow-hidden">
	<div class="space-y-2 px-4 pt-3 empty:hidden">
		{#if loadError}<p class="text-sm text-secondary-700 dark:text-secondary-300">{loadError}</p>{/if}
		{#if conflicts.length}
			<button type="button" class="block w-full text-left" onclick={() => (tab = 'conflicts')}>
				<Badge color="yellow" large class="w-full justify-start whitespace-normal">⚠ {conflicts.length} conflicting {conflicts.length === 1 ? 'booking' : 'bookings'} – release or move them</Badge>
			</button>
		{/if}
		{#if retreatGap}<Badge color="yellow" large class="w-full justify-start whitespace-normal">⚠ {retreatGap}</Badge>{/if}
	</div>
	{#if loading}
		<div class="flex flex-1 items-center justify-center" role="status" aria-label="Loading booking"><Spinner size="10" /></div>
	{:else}
		<!-- the tab bodies scroll, the bar and footer stay -->
		<Tabs bind:selected={tab} tabStyle="underline" class="px-3" contentClass="mt-0 min-h-0 flex-1 space-y-3 md:overflow-y-auto rounded-none bg-transparent p-4 dark:bg-transparent">
			<TabItem key="details" title="Details">
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
						<Select id="f-status" items={[{ value: 'confirmed', name: 'Confirmed' }, { value: 'tentative', name: 'Unconfirmed' }]} bind:value={form.status} />
					</div>
						<div class="space-y-2">
							<Label for="f-rep" class="mb-1">Repeat</Label>
							<Select id="f-rep" items={[...(inSeriesNow ? (repeatCustom.length ? [{ value: 'keep', name: 'Custom (set in Google Calendar)' }] : []) : [{ value: 'none', name: 'Does not repeat' }]), { value: 'weekly', name: 'Weekly' }, { value: 'moon', name: 'By moon phase' }]} bind:value={rep.kind} />
							{#if rep.kind === 'keep'}
								<p class="text-xs text-muted">{repeatCustom.join(' · ')}</p>
							{/if}
							{#if inSeriesNow && rep.kind !== 'keep' && JSON.stringify(rep) !== repBase}
								<p class="text-xs text-muted">Changes the whole series. Edits to single events in it may be reset.</p>
							{/if}
							{#if rep.kind === 'weekly'}
								<Select items={[1, 2, 3, 4].map((value) => ({ value, name: value === 1 ? 'Every week' : `Every ${value} weeks` }))} bind:value={rep.interval} />
								<div class="flex flex-wrap gap-x-4 gap-y-1">
									{#each WEEKDAYS as [label, d] (d)}
										<Checkbox checked={repDays.includes(d)} onchange={(e) => (rep.days = (e.currentTarget as HTMLInputElement).checked ? [...repDays, d] : repDays.filter((x) => x !== d))}>{label}</Checkbox>
									{/each}
								</div>
								<div>
									<Label for="f-until" class="mb-1">Until (optional)</Label>
									<Input id="f-until" type="date" min={form.start} bind:value={rep.until} />
								</div>
							{:else if rep.kind === 'moon'}
								<div class="grid grid-cols-3 gap-2">
									<Select items={WEEKDAYS.map(([name, value]) => ({ value, name }))} value={repWeekday} onchange={(e) => (rep.weekday = Number((e.currentTarget as HTMLSelectElement).value))} />
									<Select items={MOON_RELATIONS.map((value) => ({ value, name: RELATION_LABELS[value] }))} bind:value={rep.relation} />
									<Select items={MOON_PHASES.map((value) => ({ value, name: MOON_LABELS[value] }))} bind:value={rep.phase} />
								</div>
								<div>
									<Label for="f-until" class="mb-1">Until</Label>
									<Input id="f-until" type="date" min={form.start} bind:value={rep.until} />
								</div>
								<p class="text-xs text-muted">
									{#if moonPreview.length}{moonPreview.length} dates from {moonPreview.slice(0, 4).join(', ')}{moonPreview.length > 4 ? ' …' : ''}. The series lists all of them, up to about two years.{:else}No dates in that period.{/if}
								</p>
							{/if}
							{#if repeatError}<p class="text-sm text-secondary-700 dark:text-secondary-300">{repeatError}</p>{/if}
						</div>

					<div>
						<Label for="f-desc" class="mb-1">Notes</Label>
						<Textarea id="f-desc" class="w-full" rows={4} bind:value={form.description} />
					</div>
			</TabItem>
			<TabItem key="resources" title="Resources ({form.resourceIds.length})">
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
			</TabItem>
			{#if partsEnabled}
				<TabItem key="participants" title="People ({form.participants.length})">
					{#if mailHint}<p class="text-sm text-muted">{mailHint}</p>{/if}
					{#each form.participants as p, i (i)}
						<div class="flex items-center gap-2">
							<Input class="min-w-0 flex-1" placeholder="Name" aria-label="Name" bind:value={p.name} />
							<Input class="min-w-0 flex-1" type="email" placeholder="Email" aria-label="Email" bind:value={p.email} />
							<CloseButton aria-label="Remove person" onclick={() => form.participants.splice(i, 1)} />
						</div>
						{#if sentLine(p.email)}<p class="-mt-1 text-xs text-muted">{sentLine(p.email)}</p>{/if}
					{/each}
					<Button size="xs" color="alternative" onclick={() => form.participants.push(newParticipant())}>Add person</Button>
					{#if partsError}<p class="text-sm text-secondary-700 dark:text-secondary-300">{partsError}</p>{/if}
				</TabItem>
			{/if}
			{#if jobsEnabled}
				<TabItem key="jobs" title="Jobs ({form.jobs.length})">
					<p class="text-sm text-muted">People sign up for these jobs in the Telegram week plan.</p>
					{#if form.seriesId}<p class="text-xs text-muted">Save saves the jobs for all events of the series; the arrow next to Save has the other options.</p>{/if}
					{#each form.jobs as job, i (i)}
						<div class="space-y-2 rounded-lg border border-line p-3">
							<div class="flex items-center gap-2">
								<Input class="flex-1" placeholder="e.g. Lunch chef" aria-label="Job title" bind:value={job.title} />
								<Button size="xs" color="alternative" onclick={() => form.jobs.splice(i, 1)}>Remove</Button>
							</div>
							<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
								<label class="flex items-center gap-2 text-sm">
									Slots
									<input type="number" min="1" max="20" class="w-16 rounded-lg border border-line bg-surface p-1.5 text-sm text-ink" bind:value={job.slots} />
								</label>
								<Checkbox bind:checked={job.askDetails} disabled={job.slots !== 1}>Ask for details</Checkbox>
								<Checkbox bind:checked={job.sos}>Call for help if empty</Checkbox>
								{#if job.key}<span class="ml-auto text-xs text-muted">{job.key}</span>{/if}
							</div>
						</div>
					{/each}
					<Button size="xs" color="alternative" onclick={() => form.jobs.push(newJob())}>Add job</Button>
					{#if form.jobs.length}
						<div>
							<Label for="f-type" class="mb-1">Event key</Label>
							<Input id="f-type" bind:value={form.type} placeholder={slugify(form.title) || 'event'} disabled={!!savedType} />
							<p class="mt-1 text-xs text-muted">Stable name of this kind of event; sign-ups are stored under it. Chosen once, do not change it afterwards.</p>
						</div>
					{/if}
					{#if jobsError}<p class="text-sm text-secondary-700 dark:text-secondary-300">{jobsError}</p>{/if}
				</TabItem>
			{/if}
			{#if conflicts.length}
				<TabItem key="conflicts" title="Conflicts ({conflicts.length})">
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
				</TabItem>
			{/if}
		</Tabs>
	{/if}
	{#if saveError}<p class="px-4 pb-2 text-sm text-secondary-700 dark:text-secondary-300">{saveError}</p>{/if}
</div>

<div class="sticky bottom-0 z-20 flex items-center gap-2 border-t border-line bg-surface p-3 md:static">
	{#if form.id && inSeriesNow}
		<ButtonGroup size="sm">
			<Button color="red" outline size="sm" onclick={() => remove()} disabled={busy || loading}>Delete</Button>
			<Button color="red" outline size="sm" id="delete-scope" aria-label="More ways to delete" disabled={busy || loading}><ChevronDown size={16} /></Button>
		</ButtonGroup>
		<Dropdown triggeredBy="#delete-scope" simple placement="top-start" bind:isOpen={deleteOpen}>
			<DropdownItem class="whitespace-nowrap" onclick={() => { deleteOpen = false; void remove('this'); }}>Delete only this event</DropdownItem>
			<DropdownItem class="whitespace-nowrap" onclick={() => { deleteOpen = false; void remove('following'); }}>Delete this and following events</DropdownItem>
			<DropdownItem class="whitespace-nowrap" onclick={() => { deleteOpen = false; void remove('all'); }}>Delete all events of the series</DropdownItem>
		</Dropdown>
	{:else if form.id}<Button color="red" outline size="sm" onclick={() => remove()} disabled={busy || loading}>Delete</Button>{/if}
	<Button color="alternative" size="sm" class="ml-auto" onclick={close}>Cancel</Button>
	{#if inSeriesNow}
		<ButtonGroup size="sm">
			<Button size="sm" onclick={() => save()} loading={busy} disabled={!valid || loading}>Save</Button>
			<Button size="sm" id="save-scope" aria-label="More ways to save" disabled={!valid || loading || busy}><ChevronDown size={16} /></Button>
		</ButtonGroup>
		<Dropdown triggeredBy="#save-scope" simple placement="top-end" bind:isOpen={scopeOpen}>
			{#if dayChanged}<p class="max-w-56 px-4 py-2 text-xs text-muted">The day changed, so this can only be saved for this event.</p>{/if}
			<DropdownItem class="whitespace-nowrap" disabled={!!repeat} onclick={() => { scopeOpen = false; void save('this'); }}>Save only this event</DropdownItem>
			<DropdownItem class="whitespace-nowrap" disabled={!!repeat || dayChanged} onclick={() => { scopeOpen = false; void save('following'); }}>Save this and following events</DropdownItem>
			<DropdownItem class="whitespace-nowrap" disabled={dayChanged} onclick={() => { scopeOpen = false; void save('all'); }}>Save all events of the series</DropdownItem>
		</Dropdown>
	{:else}
		<Button size="sm" onclick={() => save()} loading={busy} disabled={!valid || loading}>Save</Button>
	{/if}
</div>
