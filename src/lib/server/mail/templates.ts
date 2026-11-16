import * as z from 'zod';
import type { Attachment } from './mime';

/**
 * Welcome mail texts, maintained in Sveltia CMS (static/admin/config.yml) as content/mail/<slug>.json
 * and PDFs in content/mail/files/. Both are read at build time and end up in the server bundle, so a
 * change in the CMS (a commit) goes live with the next deployment, and the PDFs are not public.
 */
const contents = import.meta.glob('/content/mail/*.json', { eager: true, import: 'default' });
// Vite inlines the files as data URIs ("data:application/pdf;base64,…")
const files = import.meta.glob('/content/mail/files/*.pdf', { eager: true, query: '?inline', import: 'default' }) as Record<string, string>;

const MAX_ATTACHMENTS_BYTES = 20 * 1024 * 1024; // Gmail's limit is 25 MB per message, the encoding adds a third

const templateSchema = z.object({
	subject: z.string().trim().min(1, 'subject is empty'),
	message: z.string().trim().min(1, 'message is empty'),
	/** send this many days before arrival (and for bookings made later, as soon as the next run happens) */
	daysBefore: z.number().int().min(0).max(60).default(3),
	attachments: z.array(z.string()).default([])
});

export type MailTemplate = Omit<z.infer<typeof templateSchema>, 'attachments'> & { slug: string; attachments: Attachment[] };

export const TEMPLATE_SLUGS = Object.keys(contents).map((p) => p.replace(/^.*\/|\.json$/g, ''));

/** One template by its slug (file name); throws a readable error when it is missing, broken or lists a file that is not there. */
export function getTemplate(slug: string): MailTemplate {
	const raw = contents[`/content/mail/${slug}.json`];
	if (!raw) throw new Error(`Mail template "${slug}" does not exist`);
	const parsed = templateSchema.safeParse(raw);
	if (!parsed.success) throw new Error(`Mail template "${slug}": ${parsed.error.issues[0].message}`);
	let total = 0;
	const attachments = parsed.data.attachments.map((path) => {
		const filename = path.split('/').pop() ?? path;
		if (!/\.pdf$/i.test(filename)) throw new Error(`Mail template "${slug}": only PDF attachments are allowed (${filename})`);
		// the CMS stores a path like /content/mail/files/x.pdf; the file name is what matters
		const uri = files[`/content/mail/files/${filename}`];
		if (!uri) throw new Error(`Mail template "${slug}": attachment ${filename} was not found in content/mail/files`);
		const content = Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64');
		total += content.length;
		return { filename, content, type: 'application/pdf' };
	});
	if (total > MAX_ATTACHMENTS_BYTES) throw new Error(`Mail template "${slug}": attachments are larger than 20 MB`);
	return { ...parsed.data, slug, attachments };
}
