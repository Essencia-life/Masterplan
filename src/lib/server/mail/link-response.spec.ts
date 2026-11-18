import { describe, expect, it } from 'vitest';
import { parseLinkResponse } from './link-response';

describe('parseLinkResponse', () => {
	it('reads invite_link', () => {
		expect(parseLinkResponse('{"invite_link":"https://t.me/+abc"}')).toBe('https://t.me/+abc');
		expect(parseLinkResponse('{"invite_link":" https://t.me/+abc "}')).toBe('https://t.me/+abc');
	});
	it('refuses everything else', () => {
		expect(parseLinkResponse('')).toBeNull();
		expect(parseLinkResponse('null')).toBeNull();
		expect(parseLinkResponse('{"link":"https://t.me/+abc"}')).toBeNull();
		expect(parseLinkResponse('{"invite_link":42}')).toBeNull();
		expect(parseLinkResponse('{"invite_link":"http://t.me/+abc"}')).toBeNull();
		expect(parseLinkResponse('{"invite_link":"javascript:alert(1)"}')).toBeNull();
		expect(parseLinkResponse('{broken')).toBeNull();
		expect(parseLinkResponse('https://t.me/+abc')).toBeNull();
	});
});
