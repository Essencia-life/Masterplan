import { error } from '@sveltejs/kit';
import { command, query } from '$app/server';
import * as z from 'zod';
import type { EventDetail } from '#lib/types';
import {
	addDays,
	calendar,
	dayOf,
	freshRows,
	localDay,
	localTime,
	TIME_ZONE,
	listEvents,
	loadMeta,
	resolveCalendarId,
	resolveOrganizer
} from '#lib/server/google';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Rows, groups and colours (resource calendars discovered dynamically). */
export const getCalendars = query(async () => (await loadMeta()).meta);

/** Only the rows the client asks for (= expanded groups) are fetched. */
export const getEvents = query(
	z.object({
		rowIds: z.array(z.string()).min(1).max(40),
		from: isoDate,
		to: isoDate
	}),
	async ({ rowIds, from, to }) => {
		const results = await Promise.all(
			rowIds.map((id) =>
				listEvents(id, from, to).catch((e) => {
					console.error('listEvents', id, e?.message);
					return [];
				})
			)
		);
		return results.flat();
	}
);

export const getEvent = query(
	z.object({ eventId: z.string(), calendar: z.string().optional() }),
	async ({ eventId, calendar: hint }): Promise<EventDetail> => {
		const { meta } = await loadMeta();
		const order = [hint, ...meta.rows.filter((r) => r.kind === 'calendar' && r.available).map((r) => r.id)].filter(
			(x): x is string => !!x
		);
		for (const rowId of [...new Set(order)]) {
			try {
				const calendarId = await resolveCalendarId(rowId);
				let ev = (await calendar().events.get({ calendarId, eventId })).data;
				let ownerRow = rowId;
				// a resource copy: jump to the organizer's event so edits go to the right place
				if (ev.organizer && !ev.organizer.self && ev.iCalUID) {
					for (const r of meta.rows.filter((x) => x.kind === 'calendar' && x.available)) {
						const id = await resolveCalendarId(r.id);
						const found = await calendar().events.list({ calendarId: id, iCalUID: ev.iCalUID });
						if (found.data.items?.[0]) {
							ev = found.data.items[0];
							ownerRow = r.id;
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
					resourceIds: (ev.attendees ?? []).filter((a) => a.resource).map((a) => a.email!)
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
	resourceIds: z.array(z.string()).max(40).default([])
});

export const saveEvent = command(saveSchema, async (input) => {
	if (input.allDay ? input.end <= input.start : input.end < input.start) error(400, 'End must be after start');
	if (!input.allDay && (!input.startTime || !input.endTime)) error(400, 'Times are required');
	if (!input.allDay && input.end === input.start && input.endTime! <= input.startTime!) error(400, 'End time must be after start time');
	const { resourceIds, writableIds } = await loadMeta();
	if (!writableIds.has(input.calendar)) error(400, 'This calendar is read-only');
	for (const r of input.resourceIds) if (!resourceIds.has(r)) error(400, 'Unknown resource');
	const calendarId = await resolveCalendarId(input.calendar);
	const requestBody = {
		summary: input.title,
		description: input.description,
		status: input.status,
		start: input.allDay ? { date: input.start } : { dateTime: `${input.start}T${input.startTime}:00`, timeZone: TIME_ZONE },
		end: input.allDay ? { date: input.end } : { dateTime: `${input.end}T${input.endTime}:00`, timeZone: TIME_ZONE },
		attendees: input.resourceIds.map((email) => ({ email, resource: true }))
	};
	const api = calendar().events;
	// rows/dates of the previous state also change (rooms released, event moved)
	const before = input.id ? (await api.get({ calendarId, eventId: input.id })).data : null;
	const res = input.id
		? await api.patch({ calendarId, eventId: input.id, requestBody, sendUpdates: 'none' })
		: await api.insert({ calendarId, requestBody, sendUpdates: 'none' });
	const oldRooms = (before?.attendees ?? []).filter((a) => a.resource).map((a) => a.email!);
	const oldStart = (dayOf(before?.start) || input.start);
	const oldEnd = (dayOf(before?.end) || input.end);
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
	async ({ rowIds, from, to }) => freshRows(rowIds, from, to)
);

export const deleteEvent = command(
	z.object({ calendar: z.string(), id: z.string() }),
	async ({ calendar: key, id }) => {
		if (!(await loadMeta()).writableIds.has(key)) error(400, 'This calendar is read-only');
		const calendarId = await resolveCalendarId(key);
		const api = calendar().events;
		const before = (await api.get({ calendarId, eventId: id })).data;
		await api.delete({ calendarId, eventId: id, sendUpdates: 'none' });
		const rooms = (before.attendees ?? []).filter((a) => a.resource).map((a) => a.email!);
		const s = dayOf(before.start);
		const e = (dayOf(before.end) || s);
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
		const { resourceIds } = await loadMeta();
		if (!resourceIds.has(rowId)) error(400, 'Not a resource calendar');
		if (action === 'move' && (!toResourceId || !resourceIds.has(toResourceId))) error(400, 'Pick a target room');
		const target = await resolveOrganizer(rowId, eventId);
		const api = calendar().events;
		const ev = (await api.get(target)).data;
		const rest = (ev.attendees ?? []).filter((a) => a.email !== rowId);
		const attendees = action === 'release' ? rest : [...rest.filter((a) => a.email !== toResourceId), { email: toResourceId!, resource: true }];
		await api.patch({ calendarId: target.calendarId, eventId: target.eventId, requestBody: { attendees }, sendUpdates: 'none' });
		const s = dayOf(ev.start);
		const e = (dayOf(ev.end) || s);
		return { fresh: await freshRows([target.rowKey, rowId, ...(toResourceId ? [toResourceId] : [])], s, e) };
	}
);
