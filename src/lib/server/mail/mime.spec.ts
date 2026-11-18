import { describe, expect, it } from 'vitest';
import { buildMime } from './mime';

const base = { from: { name: 'Essência', email: 'welcome@essencia.life' }, to: { name: 'Ana', email: 'ana@example.org' }, text: 'Hi Ana', html: '<p>Hi Ana</p>' };

describe('buildMime', () => {
	it('encodes non-ASCII names and subjects and adds both bodies', () => {
		const raw = buildMime({ ...base, subject: 'Willkommen in Essência' });
		expect(raw).toContain('From: =?UTF-8?B?');
		expect(raw).toContain('To: "Ana" <ana@example.org>');
		expect(raw).toMatch(/Subject: =\?UTF-8\?B\?/);
		expect(raw).toContain('Content-Type: multipart/alternative');
		expect(raw).not.toContain('multipart/mixed');
		expect(raw).toContain(Buffer.from('<p>Hi Ana</p>').toString('base64'));
	});

	it('attaches files as base64', () => {
		const content = Buffer.from('%PDF-1.4 test');
		const raw = buildMime({ ...base, subject: 'Hello', attachments: [{ filename: 'House rules.pdf', content, type: 'application/pdf' }] });
		expect(raw).toContain('multipart/mixed');
		expect(raw).toContain('Content-Disposition: attachment; filename="House_rules.pdf"');
		expect(raw).toContain("filename*=UTF-8''House%20rules.pdf");
		expect(raw).toContain(content.toString('base64'));
	});

	it('puts an inline image next to the alternatives', () => {
		const content = Buffer.from('png-bytes');
		const raw = buildMime({ ...base, subject: 'Hello', inline: { cid: 'logo@x', filename: 'logo.png', content, type: 'image/png' } });
		expect(raw).toContain('multipart/related');
		expect(raw).toContain('Content-ID: <logo@x>');
		expect(raw).toContain('Content-Disposition: inline; filename="logo.png"');
		expect(raw).toContain(content.toString('base64'));
		expect(raw).not.toContain('multipart/mixed');
	});

	it('turns accented letters in file names into plain ones', () => {
		const raw = buildMime({ ...base, subject: 'Hello', attachments: [{ filename: 'How to get to Essência.pdf', content: Buffer.from('x'), type: 'application/pdf' }] });
		expect(raw).toContain('filename="How_to_get_to_Essencia.pdf"');
		expect(raw).toContain("filename*=UTF-8''How%20to%20get%20to%20Essencia.pdf");
	});

	it('lists the PDFs before the inline logo', () => {
		const raw = buildMime({
			...base,
			subject: 'Hello',
			attachments: [{ filename: 'a.pdf', content: Buffer.from('x'), type: 'application/pdf' }],
			inline: { cid: 'logo@x', filename: 'logo.png', content: Buffer.from('y'), type: 'image/png' }
		});
		expect(raw.indexOf('name="a.pdf"')).toBeLessThan(raw.indexOf('name="logo.png"'));
	});

	it('keeps line breaks in the subject out of the headers', () => {
		const raw = buildMime({ ...base, subject: 'Hi\r\nBcc: evil@example.org' });
		expect(raw.split('\r\n').some((l) => l.startsWith('Bcc:'))).toBe(false);
	});

	it('rejects broken addresses', () => {
		expect(() => buildMime({ ...base, to: { email: 'a@b.c\r\nBcc: x@y.z' }, subject: 's' })).toThrow('Invalid email address');
		expect(() => buildMime({ ...base, to: { email: 'nobody' }, subject: 's' })).toThrow('Invalid email address');
	});
});
