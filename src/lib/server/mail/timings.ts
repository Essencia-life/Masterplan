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
