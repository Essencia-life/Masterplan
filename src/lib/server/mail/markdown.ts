/**
 * The small Markdown subset of the mail templates: paragraphs, "- " lists, "## " headings,
 * **bold**, *italic*, [links](https://…). Everything else is plain text; HTML in the source is escaped.
 */

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(src: string) {
	const links: string[] = [];
	// \0 marks a finished link while bold/italic are applied; it cannot occur in the input
	let s = escapeHtml(src.replaceAll('\0', '')).replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (_, text: string, url: string) => {
		if (!/^(https?:\/\/|mailto:)/i.test(url)) return text; // no javascript: and friends
		links.push(`<a href="${url}">${text}</a>`);
		return `\0${links.length - 1}\0`;
	});
	s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
	return s.replace(/\0(\d+)\0/g, (_, i: string) => links[Number(i)]);
}

export function markdownToHtml(md: string): string {
	const blocks = md.replace(/\r\n?/g, '\n').trim().split(/\n{2,}/).filter(Boolean);
	return blocks
		.map((block) => {
			const lines = block.split('\n');
			if (lines.every((l) => /^\s*[-*]\s+/.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*]\s+/, ''))}</li>`).join('')}</ul>`;
			const heading = /^#{1,3}\s+(.*)$/.exec(block);
			if (heading && lines.length === 1) return `<h2>${inline(heading[1])}</h2>`;
			return `<p>${lines.map(inline).join('<br>')}</p>`;
		})
		.join('\n');
}

/** Placeholders: {{name}}, {{arrival}}. Unknown ones become empty. Escape the values yourself when filling HTML. */
export const fill = (s: string, vars: Record<string, string>) => s.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? '');

/** The text part of a mail: the Markdown source, readable as it is. */
export const markdownToText = (md: string) => md.replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, '$1 ($2)').replace(/\*\*?([^*]+)\*\*?/g, '$1');
