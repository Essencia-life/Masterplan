import { describe, expect, it } from 'vitest';
import { escapeHtml, fill, markdownToHtml, markdownToText } from './markdown';

describe('markdownToHtml', () => {
	it('makes paragraphs, line breaks, bold and italic', () => {
		expect(markdownToHtml('Hello **you**\nand *her*\n\nBye')).toBe('<p>Hello <strong>you</strong><br>and <em>her</em></p>\n<p>Bye</p>');
	});
	it('makes lists and headings', () => {
		expect(markdownToHtml('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
		expect(markdownToHtml('## Arrival')).toBe('<h2>Arrival</h2>');
	});
	it('escapes HTML in the source', () => {
		expect(markdownToHtml('<script>alert(1)</script>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
	});
	it('only links http(s) and mailto', () => {
		expect(markdownToHtml('[site](https://essencia.life/a?b=1&c=2)')).toBe('<p><a href="https://essencia.life/a?b=1&amp;c=2">site</a></p>');
		expect(markdownToHtml('[x](javascript:alert(1))')).toBe('<p>x</p>');
	});
	it('keeps placeholders for fill()', () => {
		expect(markdownToHtml('Dear {{name}}')).toBe('<p>Dear {{name}}</p>');
	});
});

describe('fill', () => {
	it('replaces placeholders and blanks unknown ones', () => {
		expect(fill('Hi {{name}}, {{ arrival }} {{other}}', { name: 'Ana', arrival: 'Friday' })).toBe('Hi Ana, Friday ');
	});
	it('guest names cannot inject markup when escaped first', () => {
		expect(fill('<p>{{name}}</p>', { name: escapeHtml('<b>Eve</b>') })).toBe('<p>&lt;b&gt;Eve&lt;/b&gt;</p>');
	});
});

describe('markdownToText', () => {
	it('keeps links readable', () => {
		expect(markdownToText('See [the map](https://x.org) **now**')).toBe('See the map (https://x.org) now');
	});
});
