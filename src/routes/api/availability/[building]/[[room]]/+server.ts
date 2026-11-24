import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { TIME_ZONE, localTodayIso } from '#lib/time';
import { loadMeta, serviceCalendar, slug, withBackoff } from '#lib/server/google';

/** Only these groups are public, matched by label ("Event Spaces" → /api/availability/event-spaces). */
const PUBLIC_GROUPS = ['event spaces', 'guesthouse', 'tents', 'yurts'];

/**
 * Free/busy of the room calendars of one building (= group), or of one room, for a month.
 * GET /api/availability/guesthouse?month=2026-12  (month defaults to the current one)
 * Only busy intervals are returned, never titles or calendar ids.
 */
export const GET: RequestHandler = async ({ params, url, setHeaders }) => {
	const month = url.searchParams.get('month') ?? localTodayIso().slice(0, 7);
	if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) error(400, 'month must be YYYY-MM');

	const { meta } = await loadMeta();
	const group = meta.groups.find((g) => g.id === 'g-' + params.building && PUBLIC_GROUPS.includes(g.label.trim().toLowerCase()));
	if (!group) error(404, 'Unknown building');
	const rooms = meta.rows.filter((r) => r.kind === 'resource' && r.groupId === group.id && (!params.room || slug(r.label) === params.room));
	if (!rooms.length) error(404, 'Unknown room');

	const [y, m] = month.split('-').map(Number);
	const timeMin = new Date(Date.UTC(y, m - 1, 1)).toISOString();
	const timeMax = new Date(Date.UTC(y, m, 1)).toISOString();
	const res = await withBackoff(() =>
		serviceCalendar().freebusy.query({
			requestBody: {
				timeMin,
				timeMax,
				timeZone: TIME_ZONE,
				items: rooms.map((r) => ({ id: r.id }))
			}
		})
	);
	const calendars = res.data.calendars ?? {};
	if (rooms.some((r) => calendars[r.id]?.errors?.length)) error(502, 'Google could not read all calendars');

	setHeaders({ 'cache-control': 'public, s-maxage=60, stale-while-revalidate=120' });
	return json({
		building: group.label,
		month,
		rooms: rooms.map((r) => ({ room: slug(r.label), name: r.label, busy: (calendars[r.id]?.busy ?? []).map((b) => ({ start: b.start, end: b.end })) }))
	});
};
