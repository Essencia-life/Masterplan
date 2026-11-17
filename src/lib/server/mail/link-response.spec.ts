import { describe, expect, it } from 'vitest';
import { parseLinkResponse } from './link-response';

describe('parseLinkResponse', () => {
	it('reads JSON with link or url', () => {
		expect(parseLinkResponse('{"link":"https://t.me/+abc"}')).toBe('https://t.me/+abc');
		expect(parseLinkResponse('{"url":"https://t.me/+abc"}')).toBe('https://t.me/+abc');
	});
	it('reads a plain URL', () => {
		expect(parseLinkResponse(' https://t.me/+abc\n')).toBe('https://t.me/+abc');
	});
	it('refuses everything else', () => {
		expect(parseLinkResponse('')).toBeNull();
		expect(parseLinkResponse('{"link":42}')).toBeNull();
		expect(parseLinkResponse('{broken')).toBeNull();
		expect(parseLinkResponse('http://t.me/+abc')).toBeNull();
		expect(parseLinkResponse('javascript:alert(1)')).toBeNull();
		expect(parseLinkResponse('<html>Error</html>')).toBeNull();
	});
});
