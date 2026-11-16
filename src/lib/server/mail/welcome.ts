import { fromAttendees, supportsParticipants, type Participant } from '#lib/participants';
import { claimOnce, canClaim, releaseClaim } from '#lib/server/cache';
import { addDays, dayOf, loadMeta, resolveCalendarId, serviceCalendar, withBackoff } from '#lib/server/google';
import { renderLayout } from './layout';
import { sendRaw, sender } from './gmail';
import { escapeHtml, fill, markdownToHtml, markdownToText } from './markdown';
import { buildMime } from './mime';
import { getTemplate, type MailTemplate } from './templates';

/** Bookings in a calendar whose name has "volunteer" get volunteer-welcome, all other participant calendars guest-welcome. */
export const templateSlugFor = (groupLabel: string, calendarLabel: string) => (/volunteer/i.test(`${groupLabel} ${calendarLabel}`) ? 'volunteer-welcome' : 'guest-welcome');

const MAX_PER_RUN = 40; // keeps a run inside the function time limit; the rest follows with the next run
const CLAIM_DAYS = 120;
const dateFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const longDate = (iso: string) => dateFormat.format(new Date(`${iso}T12:00:00Z`));

/** A template turned into HTML once; the placeholders are filled for every guest. */
async function compile(t: MailTemplate) {
	return { t, html: await renderLayout(markdownToHtml(t.message)), text: markdownToText(t.message) };
}
type Compiled = Awaited<ReturnType<typeof compile>>;

async function deliver(c: Compiled, to: Participant, arrival: string) {
	const html = fill(c.html, { name: escapeHtml(to.name), arrival: escapeHtml(arrival) });
	const text = fill(c.text, { name: to.name, arrival });
	const subject = fill(c.t.subject, { name: to.name, arrival });
	await sendRaw(buildMime({ from: sender(), to: { name: to.name, email: to.email }, subject, text, html, attachments: c.t.attachments }));
}

/** One sample mail to `to`, nothing is claimed or recorded. */
export async function sendTest(slug: string, to: string) {
	const c = await compile(getTemplate(slug));
	await deliver(c, { name: 'Test Guest', email: to }, longDate(addDays(new Date().toISOString().slice(0, 10), c.t.daysBefore)));
}

/**
 * Welcome mails for every confirmed booking in the guest and volunteer calendars that starts within the
 * template's "days before" window, for each participant who has not had one yet. Safe to run repeatedly:
 * a participant is claimed in Redis before the mail goes out and the claim is released if sending fails.
 */
export async function sendWelcomes(today: string) {
	if (!canClaim) throw new Error('Upstash Redis is required so that nobody receives a welcome mail twice');
	sender(); // fail early when the sender is not configured
	const { meta } = await loadMeta();
	const groupLabel = (id: string) => meta.groups.find((g) => g.id === id)?.label ?? '';
	const rows = meta.rows.filter((r) => r.kind === 'calendar' && r.available && supportsParticipants(groupLabel(r.groupId), r.label));

	const result = { sent: 0, skipped: 0, errors: [] as string[] };
	const templates = new Map<string, Compiled | Error>();
	const templateFor = async (slug: string) => {
		if (!templates.has(slug)) templates.set(slug, await compile(getTemplate(slug)).catch((e: Error) => e));
		return templates.get(slug)!;
	};

	for (const row of rows) {
		const slug = templateSlugFor(groupLabel(row.groupId), row.label);
		const c = await templateFor(slug);
		if (c instanceof Error) {
			result.errors.push(c.message);
			continue;
		}
		const lastDay = addDays(today, c.t.daysBefore);
		const calendarId = await resolveCalendarId(row.id);
		const res = await withBackoff(() =>
			serviceCalendar().events.list({
				calendarId,
				timeMin: new Date(`${today}T00:00:00Z`).toISOString(),
				timeMax: new Date(`${addDays(lastDay, 1)}T00:00:00Z`).toISOString(),
				singleEvents: true,
				orderBy: 'startTime',
				maxResults: 250
			})
		);
		for (const e of res.data.items ?? []) {
			const day = dayOf(e.start);
			if (e.status !== 'confirmed' || !e.id || day < today || day > lastDay) continue;
			for (const person of fromAttendees(e.attendees)) {
				if (result.sent >= MAX_PER_RUN) return result;
				const key = `welcome:${e.id}:${person.email.toLowerCase()}`;
				if (!(await claimOnce(key, CLAIM_DAYS * 86400))) {
					result.skipped++;
					continue;
				}
				try {
					await deliver(c, person, longDate(day));
					result.sent++;
				} catch (err) {
					await releaseClaim(key);
					result.errors.push(`${person.email}: ${err instanceof Error ? err.message : err}`);
				}
			}
		}
	}
	return result;
}
