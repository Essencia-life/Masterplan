import { error } from '@sveltejs/kit';
import { command, query } from '$app/server';
import * as z from 'zod';
import type { EventDetail } from '#lib/types';
import {
	addDays,
	calendar,
	isMainKey,
	listEvents,
	loadMeta,
	resolveCalendarId,
	resolveOrganizer,
	shiftTimes
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
				const start = (ev.start?.date ?? ev.start?.dateTime ?? '').slice(0, 10);
				const end = ev.end?.date ?? addDays((ev.end?.dateTime ?? start).slice(0, 10), 1);
				return {
					id: ev.id!,
					linkId: ev.iCalUID ?? ev.id!,
					calendar: ownerRow,
					title: ev.summary ?? '',
					start,
					end,
					status: ev.status === 'tentative' ? 'tentative' : 'confirmed',
					description: ev.description ?? '',
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
	calendar: z.string().refine(isMainKey, 'Pick a calendar'),
	title: z.string().trim().min(1).max(200),
	start: isoDate,
	end: isoDate,
	status: z.enum(['confirmed', 'tentative']),
	description: z.string().max(5000).default(''),
	resourceIds: z.array(z.string()).max(40).default([])
});

export const saveEvent = command(saveSchema, async (input) => {
	if (input.end <= input.start) error(400, 'End must be after start');
	const { resourceIds } = await loadMeta();
	for (const r of input.resourceIds) if (!resourceIds.has(r)) error(400, 'Unknown resource');
	const calendarId = await resolveCalendarId(input.calendar);
	const requestBody = {
		summary: input.title,
		description: input.description,
		status: input.status,
		start: { date: input.start },
		end: { date: input.end },
		attendees: input.resourceIds.map((email) => ({ email, resource: true }))
	};
	const api = calendar().events;
	const res = input.id
		? await api.patch({ calendarId, eventId: input.id, requestBody, sendUpdates: 'none' })
		: await api.insert({ calendarId, requestBody, sendUpdates: 'none' });
	return { id: res.data.id!, calendar: input.calendar };
});

export const deleteEvent = command(
	z.object({ calendar: z.string().refine(isMainKey), id: z.string() }),
	async ({ calendar: key, id }) => {
		const calendarId = await resolveCalendarId(key);
		await calendar().events.delete({ calendarId, eventId: id, sendUpdates: 'none' });
	}
);

/** Drag & drop: shift an event (and with it all linked resource bookings) by whole days. */
export const moveEvent = command(
	z.object({ rowId: z.string(), eventId: z.string(), days: z.number().int().min(-3650).max(3650) }),
	async ({ rowId, eventId, days }) => {
		if (days === 0) return;
		const target = await resolveOrganizer(rowId, eventId);
		const api = calendar().events;
		const ev = (await api.get(target)).data;
		await api.patch({ ...target, requestBody: shiftTimes(ev, days), sendUpdates: 'none' });
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
		await api.patch({ ...target, requestBody: { attendees }, sendUpdates: 'none' });
	}
);
