import { claimedAt } from '#lib/server/cache';
import { timingSchema, type Timing } from './timing';

// its own glob (JSON only), so the pages do not load the PDFs of templates.ts
const contents = import.meta.glob('/content/mail/*.json', { eager: true, import: 'default' }) as Record<string, { timing?: unknown }>;

/** When the mails of a kind go out, for the hint in the People tab: the part of the file name after "guest-" / "volunteer-" and its timing. */
export function mailTimings(kind: 'guest' | 'volunteer'): (Timing & { name: string })[] {
	return Object.entries(contents)
		.flatMap(([path, c]) => {
			const slug = path.replace(/^.*\/|\.json$/g, '');
			const t = timingSchema.safeParse(c.timing);
			return slug.startsWith(`${kind}-`) && t.success ? [{ name: slug.slice(kind.length + 1), ...t.data }] : [];
		})
		.sort((a, b) => Number(a.when === 'after') - Number(b.when === 'after') || a.days - b.days);
}

/** Redis key that marks a mail as sent to one person for one event (the cron claims it before sending). */
export const mailKey = (slug: string, eventId: string, email: string) => `mail:${slug}:${eventId}:${email.toLowerCase()}`;

/** Per person (lower-case email) and mail ("welcome", "thanks", …): when it was sent, null when not. */
export type MailSent = Record<string, Record<string, string | null>>;

export async function mailSent(kind: 'guest' | 'volunteer', eventId: string, emails: string[]): Promise<MailSent> {
	const names = mailTimings(kind).map((m) => m.name);
	const pairs = emails.flatMap((email) => names.map((name) => ({ email: email.toLowerCase(), name })));
	const times = await claimedAt(pairs.map((p) => mailKey(`${kind}-${p.name}`, eventId, p.email)));
	const out: MailSent = {};
	pairs.forEach((p, i) => ((out[p.email] ??= {})[p.name] = times[i]));
	return out;
}
