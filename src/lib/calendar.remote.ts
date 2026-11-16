import { error } from '@sveltejs/kit';
import { command, query } from '$app/server';
import * as z from 'zod';
import type { calendar_v3 } from 'googleapis';
import type { EventDetail } from '#lib/types';
import {
	asUser,
	assertCanWrite,
	dayOf,
	eventsForRows,
	forVisitor,
	freshRows,
	localDay,
	localTime,
	eventRange,
	loadMeta,
	requireUser,
	resolveCalendarId,
	resolveOrganizer,
	serviceCalendar
} from '#lib/server/google';
import { DAY_MS, TIME_ZONE, addDaysIso } from '#lib/time';
import { buildRecurrence, linesBefore, linesFrom, parseRecurrence, repeatSchema } from '#lib/recurrence';
import { fromAttendees, participantsSchema, supportsParticipants, toAttendee } from '#lib/participants';
import { isLegacyJobs, jobsSchema, parseJobs, slugify, supportsJobs, typeSchema } from '#lib/jobs';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Only the rows the client asks for (= expanded groups) are fetched. */
export const getEvents = query(
	z.object({
		rowIds: z.array(z.string()).min(1).max(40),
		from: isoDate,
		to: isoDate
	}),
	async ({ rowIds, from, to }) => {
		const results = await eventsForRows(rowIds, from, to);
		return forVisitor(results.flat());
	}
);

export const getEvent = query(
	z.object({ eventId: z.string(), calendar: z.string().optional() }),
	async ({ eventId, calendar: hint }): Promise<EventDetail> => {
		requireUser();
		const { meta } = await loadMeta();
		const calendars = meta.rows.filter((r) => r.kind === 'calendar' && r.available).map((r) => r.id);
		// the URL names the calendar, so normally exactly one lookup; scan all calendars only without a hint
		const order = hint ? [hint] : calendars;
		for (const rowId of order) {
			try {
				const calendarId = await resolveCalendarId(rowId);
				let ev = (await serviceCalendar().events.get({ calendarId, eventId })).data;
				let ownerRow = rowId;
				// a resource copy: jump to the organizer's event so edits go to the right place
				if (ev.organizer && !ev.organizer.self && ev.iCalUID) {
					for (const rid of calendars) {
						const found = await serviceCalendar().events.list({ calendarId: await resolveCalendarId(rid), iCalUID: ev.iCalUID });
						if (found.data.items?.[0]) {
							ev = found.data.items[0];
							ownerRow = rid;
							break;
						}
					}
				}
				// the recurrence lines live on the series master
				const master = ev.recurringEventId ? (await serviceCalendar().events.get({ calendarId, eventId: ev.recurringEventId })).data : ev;
				const { repeat, custom } = parseRecurrence(master.recurrence ?? [], master.extendedProperties?.private?.repeat);
				const start = dayOf(ev.start);
				const allDay = !!ev.start?.date;
				const end = allDay ? ev.end!.date! : localDay(ev.end?.dateTime ?? ev.start?.dateTime);
				return {
					id: ev.id!,
					linkId: ev.iCalUID ?? ev.id!,
					calendar: ownerRow,
					title: ev.summary ?? '',
					start,
					end,
					status: ev.status === 'tentative' ? 'tentative' : 'confirmed',
					description: ev.description ?? '',
					allDay,
					startTime: allDay ? '' : localTime(ev.start!.dateTime!),
					endTime: allDay ? '' : localTime(ev.end!.dateTime!),
					resourceIds: (ev.attendees ?? []).filter((a) => a.resource).map((a) => a.email!),
					jobs: parseJobs(ev.extendedProperties?.private?.jobs),
					participants: fromAttendees(ev.attendees),
					type: ev.extendedProperties?.private?.type ?? '',
					seriesId: ev.recurringEventId ?? (ev.recurrence?.length ? ev.id! : ''),
					repeat,
					repeatCustom: custom
				};
			} catch {
				// not in this calendar, try the next
			}
		}
		error(404, 'Event not found');
	}
);

const saveSchema = z.object({
	id: z.string().optional(),
	calendar: z.string(),
	title: z.string().trim().min(1).max(200),
	start: isoDate,
	end: isoDate,
	status: z.enum(['confirmed', 'tentative']),
	description: z.string().max(5000).default(''),
	allDay: z.boolean().default(true),
	startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
	endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
	resourceIds: z.array(z.string()).max(40).default([]),
	/** undefined = leave the jobs untouched, [] = remove them */
	jobs: jobsSchema.optional(),
	type: typeSchema.optional(),
	/** undefined = keep the people the event has, [] = remove them */
	participants: participantsSchema.optional(),
	/** new events only: repeat weekly (RRULE) or on moon dates (RDATE list) */
	repeat: repeatSchema.optional(),
	/** for an event of a series: only this event, this and all following ones, or the whole series */
	scope: z.enum(['this', 'following', 'all']).default('this')
});

async function calendarSupportsJobs(rowId: string) {
	const { meta } = await loadMeta();
	const row = meta.rows.find((r) => r.id === rowId);
	return !!row && supportsJobs(meta.groups.find((g) => g.id === row.groupId)?.label ?? '', row.label);
}

export const saveEvent = command(saveSchema, async (input) => {
	if (input.allDay ? input.end <= input.start : input.end < input.start) error(400, 'End must be after start');
	if (!input.allDay && (!input.startTime || !input.endTime)) error(400, 'Times are required');
	if (!input.allDay && input.end === input.start && input.endTime! <= input.startTime!) error(400, 'End time must be after start time');
	requireUser();
	const { resourceIds } = await loadMeta();
	for (const r of input.resourceIds) if (!resourceIds.has(r)) error(400, 'Unknown resource');
	const calendarId = await resolveCalendarId(input.calendar);
	await assertCanWrite(calendarId);
	const requestBody: calendar_v3.Schema$Event = {
		summary: input.title,
		description: input.description,
		status: input.status,
		start: input.allDay ? { date: input.start } : { dateTime: `${input.start}T${input.startTime}:00`, timeZone: TIME_ZONE },
		end: input.allDay ? { date: input.end } : { dateTime: `${input.end}T${input.endTime}:00`, timeZone: TIME_ZONE }
	};
	// rows/dates of the previous state also change (rooms released, event moved)
	const before = input.id ? (await serviceCalendar().events.get({ calendarId, eventId: input.id })).data : null;
	const masterId = before?.recurringEventId ?? (before?.recurrence?.length ? before.id! : undefined);
	// "this and following" and "all" change the series master instead of one instance
	const scope = masterId ? input.scope : 'this';
	if (input.repeat && masterId && scope !== 'all') error(400, 'The repeat can only be changed for all events of the series');
	const master = scope === 'this' ? undefined : masterId === input.id ? before! : (await serviceCalendar().events.get({ calendarId, eventId: masterId! })).data;
	const day = before ? dayOf(before.start) : '';
	if (master && input.start !== day) error(400, 'To move an event to another day, save only this event');
	const splitting = scope === 'following' && day !== dayOf(master!.start);
	const patchId = master && !splitting ? masterId! : input.id;
	if (master && !splitting) {
		// the master keeps its own first day; the times and the length come from the form
		const first = dayOf(master.start);
		const endDay = addDaysIso(first, Math.round((Date.parse(input.end) - Date.parse(input.start)) / DAY_MS));
		const same = input.allDay
			? master.start?.date === first && master.end?.date === endDay
			: !master.start?.date && localTime(master.start!.dateTime!) === input.startTime && localTime(master.end!.dateTime!) === input.endTime && localDay(master.end!.dateTime) === endDay;
		// untouched times must not be sent: a time change on the master resets the series' single-event changes
		if (same) {
			delete requestBody.start;
			delete requestBody.end;
		} else {
			requestBody.start = input.allDay ? { date: first } : { dateTime: `${first}T${input.startTime}:00`, timeZone: TIME_ZONE };
			requestBody.end = input.allDay ? { date: endDay } : { dateTime: `${endDay}T${input.endTime}:00`, timeZone: TIME_ZONE };
		}
	}
	// attendees are replaced as a whole: rooms plus people (the existing ones when the form did not touch them)
	requestBody.attendees = [
		...input.resourceIds.map((email) => ({ email, resource: true })),
		...(input.participants ?? fromAttendees((master ?? before)?.attendees)).map(toAttendee)
	];
	// private properties: null removes one in a patch
	const props: Record<string, string | null> = {};
	let lastDay = input.end;
	let firstDay = input.start;
	if (input.jobs) {
		if (!(await calendarSupportsJobs(input.calendar))) error(400, 'Jobs are not available in this calendar');
		if (isLegacyJobs(before?.extendedProperties?.private?.jobs)) error(409, 'This event still has sign-ups in the bot\'s older format, its jobs cannot be edited here yet');
		const jobProps = input.jobs.length
			? { jobs: JSON.stringify(input.jobs), type: input.type || slugify(input.title) || 'event' }
			: { jobs: null, type: null };
		Object.assign(props, jobProps);
	}
	if (input.participants) {
		const { meta } = await loadMeta();
		const row = meta.rows.find((r) => r.id === input.calendar);
		if (!row || !supportsParticipants(meta.groups.find((g) => g.id === row.groupId)?.label ?? '', row.label)) error(400, 'Participants are not available in this calendar');
	}
	if (input.repeat) {
		// the series' first event: the master, or this event (a new series, or a single event becoming one)
		const m = master ?? before;
		const allDay = m ? !!m.start?.date : input.allDay;
		const from = m ? dayOf(m.start) : input.start;
		const r = buildRecurrence(input.repeat, from, allDay, m ? (allDay ? undefined : localTime(m.start!.dateTime!)) : input.startTime);
		if (!r) error(400, 'The repeat rule has no dates in that period');
		const delta = Math.round((Date.parse(r.start) - Date.parse(from)) / DAY_MS);
		requestBody.recurrence = r.recurrence;
		props.repeat = input.repeat.kind === 'moon' ? JSON.stringify(input.repeat) : null;
		if (delta) {
			// the first date moves; instance ids change with it
			const shift = (t: calendar_v3.Schema$EventDateTime): calendar_v3.Schema$EventDateTime =>
				t.date ? { date: addDaysIso(t.date, delta) } : { dateTime: `${addDaysIso(localDay(t.dateTime), delta)}T${localTime(t.dateTime!)}:00`, timeZone: TIME_ZONE };
			const base = m ?? { start: requestBody.start, end: requestBody.end };
			requestBody.start = shift(base.start!);
			requestBody.end = shift(base.end!);
		}
		firstDay = [firstDay, from].sort()[0];
		lastDay = [lastDay, input.repeat.until ?? addDaysIso(from, 400)].sort().at(-1)!;
	}
	// "remove this property" (null) only means something when patching
	if (!input.id) for (const k of Object.keys(props)) if (props[k] === null) delete props[k];
	if (Object.keys(props).length) requestBody.extendedProperties = { private: props as Record<string, string> };
	// written as the signed-in user, so Google's calendar sharing decides what is allowed
	let res: { data: calendar_v3.Schema$Event };
	if (splitting) {
		// a new series from this day on (copying the master's properties), then the old one ends the day before
		const lines = linesFrom(master!.recurrence ?? [], day, input.allDay ? undefined : `${input.startTime!.replace(':', '')}00`);
		if (!lines) error(400, 'A series with a fixed number of events cannot be split here');
		const kept = { ...master!.extendedProperties?.private };
		for (const [k, v] of Object.entries(props)) if (v === null) delete kept[k]; else kept[k] = v;
		const body = { ...requestBody, recurrence: lines, extendedProperties: { private: kept } };
		res = await asUser((api) => api.events.insert({ calendarId, requestBody: body, sendUpdates: 'none' }));
		try {
			await asUser((api) => api.events.patch({ calendarId, eventId: masterId!, requestBody: { recurrence: linesBefore(master!.recurrence ?? [], day, !!master!.start?.date) }, sendUpdates: 'none' }));
		} catch (e) {
			await asUser((api) => api.events.delete({ calendarId, eventId: res!.data.id!, sendUpdates: 'none' })).catch(() => {});
			throw e;
		}
	} else {
		res = await asUser((api) =>
			patchId
				? api.events.patch({ calendarId, eventId: patchId, requestBody, sendUpdates: 'none' })
				: api.events.insert({ calendarId, requestBody, sendUpdates: 'none' })
		);
	}
	const oldRooms = (before?.attendees ?? []).filter((a) => a.resource).map((a) => a.email!);
	const [oldStart, oldEnd] = before ? eventRange(before) : [input.start, input.end];
	if (master) {
		// the whole series (or its tail) can change
		firstDay = [firstDay, scope === 'all' ? dayOf(master.start) : day].sort()[0];
		lastDay = [lastDay, addDaysIso(day, 400)].sort().at(-1)!;
	}
	// a changed repeat adds and removes events on other days too
	const fresh = await freshRows(
		[input.calendar, ...oldRooms, ...input.resourceIds],
		[oldStart, firstDay].sort()[0],
		[oldEnd, lastDay].sort().at(-1)!
	);
	return { id: res.data.id!, linkId: res.data.iCalUID ?? res.data.id!, calendar: input.calendar, fresh };
});

/** Re-read rows after a mutation (resource copies of an event show up with a delay). */
export const refreshRows = command(
	z.object({ rowIds: z.array(z.string()).min(1).max(40), from: isoDate, to: isoDate }),
	async ({ rowIds, from, to }) => {
		requireUser();
		return freshRows(rowIds, from, to);
	}
);

export const deleteEvent = command(
	z.object({ calendar: z.string(), id: z.string(), scope: z.enum(['this', 'following', 'all']).default('this') }),
	async ({ calendar: key, id, scope }) => {
		requireUser();
		const calendarId = await resolveCalendarId(key);
		await assertCanWrite(calendarId);
		const before = (await serviceCalendar().events.get({ calendarId, eventId: id })).data;
		const masterId = before.recurringEventId ?? (before.recurrence?.length ? before.id! : undefined);
		const day = dayOf(before.start);
		let [s, e] = eventRange(before);
		if (!masterId || scope === 'this') {
			await asUser((api) => api.events.delete({ calendarId, eventId: id, sendUpdates: 'none' }));
		} else {
			const master = masterId === id ? before : (await serviceCalendar().events.get({ calendarId, eventId: masterId })).data;
			if (scope === 'all' || day === dayOf(master.start)) {
				await asUser((api) => api.events.delete({ calendarId, eventId: masterId, sendUpdates: 'none' }));
				s = dayOf(master.start);
			} else {
				// the series ends the day before
				await asUser((api) => api.events.patch({ calendarId, eventId: masterId, requestBody: { recurrence: linesBefore(master.recurrence ?? [], day, !!master.start?.date) }, sendUpdates: 'none' }));
			}
			e = addDaysIso(day, 400);
		}
		const rooms = (before.attendees ?? []).filter((a) => a.resource).map((a) => a.email!);
		return { fresh: await freshRows([key, ...rooms], s, e) };
	}
);

/**
 * Conflict resolution for a booking sitting in a resource calendar. The event itself stays;
 * only the room reservation changes (series: an exception for that single instance).
 */
export const resolveConflict = command(
	z.object({
		rowId: z.string(),
		eventId: z.string(),
		action: z.enum(['release', 'move']),
		toResourceId: z.string().optional()
	}),
	async ({ rowId, eventId, action, toResourceId }) => {
		requireUser();
		const { resourceIds } = await loadMeta();
		if (!resourceIds.has(rowId)) error(400, 'Not a resource calendar');
		if (action === 'move' && (!toResourceId || !resourceIds.has(toResourceId))) error(400, 'Pick a target room');
		const target = await resolveOrganizer(rowId, eventId);
		await assertCanWrite(target.calendarId);
		const ev = (await serviceCalendar().events.get(target)).data;
		const rest = (ev.attendees ?? []).filter((a) => a.email !== rowId);
		const attendees = action === 'release' ? rest : [...rest.filter((a) => a.email !== toResourceId), { email: toResourceId!, resource: true }];
		await asUser((api) => api.events.patch({ calendarId: target.calendarId, eventId: target.eventId, requestBody: { attendees }, sendUpdates: 'none' }));
		const [s, e] = eventRange(ev);
		return { fresh: await freshRows([target.rowKey, rowId, ...(toResourceId ? [toResourceId] : [])], s, e) };
	}
);
