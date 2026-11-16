import * as z from 'zod';

/**
 * Jobs people can sign up for (Telegram week plan). They are stored on the event as two private
 * extended properties: `jobs` (JSON array of `Job`) and `type` (stable event key, see `slugify`).
 */

/** Calendars whose events can carry jobs. Matched on "group name", like the retreat warning in the panel. */
export const JOB_CALENDARS = /community|event|retreat/i;
export const supportsJobs = (groupLabel: string, calendarLabel: string) => JOB_CALENDARS.test(`${groupLabel} ${calendarLabel}`);

export const jobSchema = z
	.object({
		/** internal name, stable once people have signed up (Telegram buttons, sign-up storage) */
		key: z.string().regex(/^[a-z0-9]{1,16}$/, 'Job key: up to 16 lowercase letters and digits'),
		title: z.string().trim().min(1, 'Every job needs a title').max(60),
		slots: z.number({ error: 'Slots must be a number' }).int().min(1, 'At least one slot').max(20),
		/** the person is asked what they offer, only meaningful for a single slot */
		askDetails: z.boolean(),
		/** the daily agenda calls for help while the job is empty */
		sos: z.boolean()
	})
	.refine((j) => !j.askDetails || j.slots === 1, { message: 'Asking for details needs exactly one slot', path: ['askDetails'] });

export const jobsSchema = z
	.array(jobSchema)
	.max(12, 'At most 12 jobs')
	.refine((jobs) => new Set(jobs.map((j) => j.key)).size === jobs.length, 'Job keys must be unique');

/** Stable name of a kind of event, e.g. "lunch"; part of the sign-up storage key. */
export const typeSchema = z
	.string()
	.max(24, 'Event key: at most 24 characters')
	.regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Event key: lowercase letters, digits and single hyphens only');

export type Job = z.infer<typeof jobSchema>;

export const newJob = (): Job => ({ key: '', title: '', slots: 1, askDetails: false, sos: true });

/** "🧚 Fairy of the Week" → "fairy-of-the-week" */
export const slugify = (s: string, max = 24) =>
	s
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, max)
		.replace(/-+$/, '');

/** Gives new jobs their key (from the title, never changed afterwards) and drops settings that do not apply. */
export function prepareJobs(jobs: Job[]): Job[] {
	const used = new Set(jobs.map((j) => j.key).filter(Boolean));
	return jobs.map((j) => {
		let key = j.key;
		if (!key) {
			const base = slugify(j.title, 14).replaceAll('-', '') || 'job';
			key = base;
			for (let n = 2; used.has(key); n++) key = base + n;
			used.add(key);
		}
		return { ...j, key, title: j.title.trim(), askDetails: j.askDetails && j.slots === 1 };
	});
}

/** First problem with the jobs (and the event key, when there are jobs), or null. */
export function jobsProblem(jobs: Job[], type = ''): string | null {
	const problem = jobsSchema.safeParse(prepareJobs(jobs)).error?.issues[0]?.message;
	if (problem || !jobs.length || !type) return problem ?? null;
	return typeSchema.safeParse(type).error?.issues[0]?.message ?? null;
}

/** The bot's older `jobs` value is an object with the sign-ups inside; it must not be overwritten by a job list. */
export function isLegacyJobs(raw?: string | null): boolean {
	try {
		const v = JSON.parse(raw || 'null');
		return typeof v === 'object' && v !== null && !Array.isArray(v);
	} catch {
		return false;
	}
}

/** The `jobs` property of an event. Anything unreadable (including the bot's older object format) counts as "no jobs". */
export function parseJobs(raw?: string | null): Job[] {
	try {
		const r = jobsSchema.safeParse(JSON.parse(raw || '[]'));
		return r.success ? r.data : [];
	} catch {
		return [];
	}
}
