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
import { buildRecurrence, repeatSchema } from '#lib/recurrence';
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
					type: ev.extendedProperties?.private?.type ?? '',
					seriesId: ev.recurringEventId ?? (ev.recurrence?.length ? ev.id! : '')
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
	/** for an event of a series: write the jobs to the whole series or only to this event */
	jobsScope: z.enum(['series', 'instance']).default('series'),
	/** new events only: repeat weekly (RRULE) or on moon dates (RDATE list) */
	repeat: repeatSchema.optional()
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
	let recurrence: string[] | undefined;
	if (input.repeat) {
		if (input.id) error(400, 'Repeating can only be set when creating an event');
		const r = buildRecurrence(input.repeat, input.start, input.allDay, input.startTime);
		if (!r) error(400, 'The repeat rule has no dates in that period');
		// the event itself becomes the first occurrence of the rule
		input.end = addDaysIso(input.end, Math.round((Date.parse(r.start) - Date.parse(input.start)) / DAY_MS));
		input.start = r.start;
		recurrence = r.recurrence;
	}
	const requestBody: calendar_v3.Schema$Event = {
		...(recurrence?.length ? { recurrence } : {}),
		summary: input.title,
		description: input.description,
		status: input.status,
		start: input.allDay ? { date: input.start } : { dateTime: `${input.start}T${input.startTime}:00`, timeZone: TIME_ZONE },
		end: input.allDay ? { date: input.end } : { dateTime: `${input.end}T${input.endTime}:00`, timeZone: TIME_ZONE },
		attendees: input.resourceIds.map((email) => ({ email, resource: true }))
	};
	// rows/dates of the previous state also change (rooms released, event moved)
	const before = input.id ? (await serviceCalendar().events.get({ calendarId, eventId: input.id })).data : null;
	// jobs live in private extended properties; null removes a property in a patch
	let series: { id: string; props: Record<string, string> } | undefined;
	if (input.jobs) {
		if (!(await calendarSupportsJobs(input.calendar))) error(400, 'Jobs are not available in this calendar');
		if (isLegacyJobs(before?.extendedProperties?.private?.jobs)) error(409, 'This event still has sign-ups in the bot\'s older format, its jobs cannot be edited here yet');
		const props = input.jobs.length
			? { jobs: JSON.stringify(input.jobs), type: input.type || slugify(input.title) || 'event' }
			: { jobs: null as unknown as string, type: null as unknown as string };
		const master = before?.recurringEventId ?? (before?.recurrence?.length ? before.id : undefined);
		if (input.jobsScope === 'series' && master && master !== input.id) series = { id: master, props };
		else requestBody.extendedProperties = { private: props };
	}
	// written as the signed-in user, so Google's calendar sharing decides what is allowed
	const res = await asUser((api) =>
		input.id
			? api.events.patch({ calendarId, eventId: input.id, requestBody, sendUpdates: 'none' })
			: api.events.insert({ calendarId, requestBody, sendUpdates: 'none' })
	);
	// a series keeps its jobs on the master event; the instances inherit them
	if (series) await asUser((api) => api.events.patch({ calendarId, eventId: series!.id, requestBody: { extendedProperties: { private: series!.props } }, sendUpdates: 'none' }));
	const oldRooms = (before?.attendees ?? []).filter((a) => a.resource).map((a) => a.email!);
	const [oldStart, oldEnd] = before ? eventRange(before) : [input.start, input.end];
	const fresh = await freshRows(
		[input.calendar, ...oldRooms, ...input.resourceIds],
		[oldStart, input.start].sort()[0],
		[oldEnd, input.end].sort().at(-1)!
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
	z.object({ calendar: z.string(), id: z.string() }),
	async ({ calendar: key, id }) => {
		requireUser();
		const calendarId = await resolveCalendarId(key);
		await assertCanWrite(calendarId);
		const before = (await serviceCalendar().events.get({ calendarId, eventId: id })).data;
		await asUser((api) => api.events.delete({ calendarId, eventId: id, sendUpdates: 'none' }));
		const rooms = (before.attendees ?? []).filter((a) => a.resource).map((a) => a.email!);
		const [s, e] = eventRange(before);
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
