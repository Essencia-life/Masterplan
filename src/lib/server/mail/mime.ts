import { randomUUID } from 'node:crypto';

export type Attachment = { filename: string; content: Buffer; type: string };
/** An image the HTML refers to as <img src="cid:…"> */
export type Inline = { cid: string; filename: string; content: Buffer; type: string };
type Address = { name?: string; email: string };

const wrap = (b64: string) => (b64.match(/.{1,76}/g) ?? []).join('\r\n');
const b64 = (data: Buffer | string) => wrap(Buffer.from(data).toString('base64'));

/** RFC 2047: non-ASCII header text as encoded words (short pieces, so none exceeds 75 characters). */
function words(s: string) {
	if (/^[\x20-\x7e]*$/.test(s)) return s;
	const chars = Array.from(s);
	const parts: string[] = [];
	for (let i = 0; i < chars.length; i += 16) parts.push(`=?UTF-8?B?${Buffer.from(chars.slice(i, i + 16).join('')).toString('base64')}?=`);
	return parts.join('\r\n ');
}

function address({ name, email }: Address) {
	if (!/^[^\s<>,;"()\\]+@[^\s<>,;"()\\]+$/.test(email)) throw new Error(`Invalid email address: ${email}`);
	const n = name?.replace(/[\r\n]+/g, ' ').trim();
	if (!n) return email;
	return /^[\x20-\x7e]*$/.test(n) ? `"${n.replace(/["\\]/g, '\\$&')}" <${email}>` : `${words(n)} <${email}>`;
}

/** A complete RFC 822 message: text and HTML alternatives, optional attachments. */
export function buildMime(m: { from: Address; to: Address; subject: string; text: string; html: string; attachments?: Attachment[]; inline?: Inline }): string {
	const alt = `alt_${randomUUID()}`;
	const mixed = `mixed_${randomUUID()}`;
	const part = (type: string, body: string) => [`Content-Type: ${type}; charset=UTF-8`, 'Content-Transfer-Encoding: base64', '', b64(body)];
	const alternative = [`--${alt}`, ...part('text/plain', m.text), `--${alt}`, ...part('text/html', m.html), `--${alt}--`];
	const attachments = m.attachments ?? [];
	const head = [
		`From: ${address(m.from)}`,
		`To: ${address(m.to)}`,
		`Subject: ${words(m.subject.replace(/[\r\n]+/g, ' ').trim())}`,
		`Date: ${new Date().toUTCString()}`,
		'MIME-Version: 1.0'
	];
	const alt_ = [`Content-Type: multipart/alternative; boundary="${alt}"`, '', ...alternative];
	// the logo the HTML refers to as cid:…; Gmail lists attachments in the order of the parts
	const inline = m.inline
		? [
				`Content-Type: ${m.inline.type}; name="${m.inline.filename}"`,
				`Content-ID: <${m.inline.cid}>`,
				// like Gmail's own mails: with a name and an attachment id it keeps the image in the body instead of listing it
				`X-Attachment-Id: ${m.inline.cid}`,
				`Content-Disposition: inline; filename="${m.inline.filename}"`,
				'Content-Transfer-Encoding: base64',
				'',
				b64(m.inline.content)
			]
		: [];
	if (!attachments.length) {
		if (!m.inline) return [...head, ...alt_, ''].join('\r\n');
		const rel = `rel_${randomUUID()}`;
		return [...head, `Content-Type: multipart/related; boundary="${rel}"`, '', `--${rel}`, ...alt_, `--${rel}`, ...inline, `--${rel}--`, ''].join('\r\n');
	}
	const files = attachments.flatMap((a) => {
		// ê -> e: accents are split off and dropped, so "Essência" does not become "Ess_ncia"
		const plain = a.filename.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
		const ascii = plain.replace(/[^A-Za-z0-9._-]/g, '_');
		return [
			`--${mixed}`,
			`Content-Type: ${a.type}; name="${ascii}"`,
			`Content-Disposition: attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(plain)}`,
			'Content-Transfer-Encoding: base64',
			'',
			b64(a.content)
		];
	});
	// with PDFs: body, PDFs, then the logo, so the PDFs come first in the attachment list
	return [...head, `Content-Type: multipart/mixed; boundary="${mixed}"`, '', `--${mixed}`, ...alt_, ...files, ...(m.inline ? [`--${mixed}`, ...inline] : []), `--${mixed}--`, ''].join('\r\n');
}
