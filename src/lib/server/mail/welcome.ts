import { fromAttendees, supportsParticipants, type Participant } from '#lib/participants';
import { claimOnce, canClaim, releaseClaim } from '#lib/server/cache';
import { addDays, eventRange, loadMeta, resolveCalendarId, serviceCalendar, withBackoff } from '#lib/server/google';
import { renderLayout } from './layout';
import { sendRaw, sender } from './gmail';
import { feedbackLink, telegramJoinLink } from './links';
import { escapeHtml, fill, markdownToHtml, markdownToText } from './markdown';
import { buildMime } from './mime';
import { CATCH_UP_DAYS, isDue } from './timing';
import { getTemplate, TEMPLATE_SLUGS, type MailTemplate } from './templates';

/** Templates are named "<kind>-<what>" (guest-welcome, volunteer-thanks, …); calendars with "volunteer" in the group or calendar name are volunteers, all other participant calendars guests. */
export const kindOf = (groupLabel: string, calendarLabel: string) => (/volunteer/i.test(`${groupLabel} ${calendarLabel}`) ? 'volunteer' : 'guest');

const MAX_PER_RUN = 40; // keeps a run inside the function time limit; the rest follows with the next run
const CLAIM_DAYS = 120;
const dateFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const longDate = (iso: string) => dateFormat.format(new Date(`${iso}T12:00:00Z`));

/** A template turned into HTML once; the placeholders are filled for every guest. */
async function compile(t: MailTemplate) {
	return { t, html: await renderLayout(markdownToHtml(t.message)), text: markdownToText(t.message) };
}
type Compiled = Awaited<ReturnType<typeof compile>>;

type Dates = { arrival: string; departure: string };

const uses = (c: Compiled, key: string) => new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`).test(c.t.message + c.t.subject);

async function deliver(c: Compiled, to: Participant, d: Dates, role: 'guest' | 'volunteer') {
	const vars: Record<string, string> = { name: to.name, arrival: longDate(d.arrival), departure: longDate(d.departure) };
	// links are only fetched for templates that contain them (the endpoint may create a personal invite)
	if (uses(c, 'feedbackLink')) vars.feedbackLink = feedbackLink();
	if (uses(c, 'telegramJoinLink')) vars.telegramJoinLink = await telegramJoinLink({ name: to.name, departure: d.departure, role });
	const escaped = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, escapeHtml(v)]));
	await sendRaw(
		role,
		buildMime({ from: sender(role), to: { name: to.name, email: to.email }, subject: fill(c.t.subject, vars), text: fill(c.text, vars), html: fill(c.html, escaped), attachments: c.t.attachments })
	);
}

/** One sample mail to `to` (arrival and departure are made up), nothing is claimed or recorded. Links are fetched like for real mails. */
export async function sendTest(slug: string, to: string) {
	const c = await compile(getTemplate(slug));
	const day = new Date().toISOString().slice(0, 10);
	await deliver(c, { name: 'Test Guest', email: to }, { arrival: addDays(day, 3), departure: addDays(day, 10) }, slug.startsWith('volunteer-') ? 'volunteer' : 'guest');
}

/**
 * Sends every mail that is due: for each confirmed booking in the guest and volunteer calendars, each
 * participant who has not had a template's mail yet. Safe to run repeatedly: a participant is claimed in
 * Redis before the mail goes out and the claim is released if sending fails.
 */
export async function sendWelcomes(today: string) {
	if (!canClaim) throw new Error('Upstash Redis is required so that nobody receives a mail twice');
	sender('guest'); // fail early when a sender is not configured
	sender('volunteer');
	const { meta } = await loadMeta();
	const groupLabel = (id: string) => meta.groups.find((g) => g.id === id)?.label ?? '';
	const rows = meta.rows.filter((r) => r.kind === 'calendar' && r.available && supportsParticipants(groupLabel(r.groupId), r.label));

	const result = { sent: 0, skipped: 0, errors: [] as string[] };
	const compiled = new Map<string, Compiled | Error>();
	const templateFor = async (slug: string) => {
		if (!compiled.has(slug)) compiled.set(slug, await compile(getTemplate(slug)).catch((e: Error) => e));
		return compiled.get(slug)!;
	};

	for (const row of rows) {
		const kind = kindOf(groupLabel(row.groupId), row.label);
		const templates: Compiled[] = [];
		for (const slug of TEMPLATE_SLUGS.filter((s) => s.startsWith(`${kind}-`))) {
			const c = await templateFor(slug);
			if (c instanceof Error) result.errors.push(c.message);
			else templates.push(c);
		}
		if (!templates.length) continue;
		// one read covers every template: bookings that start soon, and bookings that ended recently
		const ahead = Math.max(0, ...templates.filter((c) => c.t.timing.when === 'before').map((c) => c.t.timing.days));
		const back = Math.max(0, ...templates.filter((c) => c.t.timing.when === 'after').map((c) => c.t.timing.days)) + CATCH_UP_DAYS;
		const calendarId = await resolveCalendarId(row.id);
		const res = await withBackoff(() =>
			serviceCalendar().events.list({
				calendarId,
				timeMin: new Date(`${addDays(today, -back)}T00:00:00Z`).toISOString(),
				timeMax: new Date(`${addDays(today, ahead + 1)}T00:00:00Z`).toISOString(),
				singleEvents: true,
				orderBy: 'startTime',
				maxResults: 250 // shortcut: no paging, more than 250 bookings in the window would be cut off
			})
		);
		for (const e of res.data.items ?? []) {
			if (e.status !== 'confirmed' || !e.id) continue;
			const [first, end] = eventRange(e);
			const last = addDays(end, -1);
			for (const c of templates) {
				if (!isDue(c.t, today, first, last)) continue;
				for (const person of fromAttendees(e.attendees)) {
					if (result.sent >= MAX_PER_RUN) return result;
					const key = `mail:${c.t.slug}:${e.id}:${person.email.toLowerCase()}`;
					if (!(await claimOnce(key, CLAIM_DAYS * 86400))) {
						result.skipped++;
						continue;
					}
					try {
						await deliver(c, person, { arrival: first, departure: last }, kind);
						result.sent++;
					} catch (err) {
						await releaseClaim(key);
						result.errors.push(`${person.email}: ${err instanceof Error ? err.message : err}`);
					}
				}
			}
		}
	}
	return result;
}
