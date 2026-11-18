import { randomUUID } from 'node:crypto';

export type Attachment = { filename: string; content: Buffer; type: string };
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
export function buildMime(m: { from: Address; to: Address; subject: string; text: string; html: string; attachments?: Attachment[] }): string {
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
	if (!attachments.length) return [...head, `Content-Type: multipart/alternative; boundary="${alt}"`, '', ...alternative, ''].join('\r\n');
	const files = attachments.flatMap((a) => {
		const ascii = a.filename.replace(/[^A-Za-z0-9._-]/g, '_');
		return [
			`--${mixed}`,
			`Content-Type: ${a.type}; name="${ascii}"`,
			`Content-Disposition: attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(a.filename)}`,
			'Content-Transfer-Encoding: base64',
			'',
			b64(a.content)
		];
	});
	return [...head, `Content-Type: multipart/mixed; boundary="${mixed}"`, '', `--${mixed}`, `Content-Type: multipart/alternative; boundary="${alt}"`, '', ...alternative, ...files, `--${mixed}--`, ''].join('\r\n');
}
