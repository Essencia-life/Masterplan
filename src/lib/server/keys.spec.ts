import { describe, expect, it } from 'vitest';
import { PREFIX, emailHash, mailKey } from './keys';

describe('redis keys', () => {
	it('mail keys start with the prefix and do not hold the address', () => {
		const key = mailKey('guest-welcome', 'evt1', 'Ana@Example.org');
		expect(key.startsWith(`${PREFIX}mail:guest-welcome:evt1:`)).toBe(true);
		expect(key.toLowerCase()).not.toContain('ana');
		expect(key.toLowerCase()).not.toContain('example');
	});
	it('the hash ignores case and spaces', () => {
		expect(emailHash(' ANA@example.org ')).toBe(emailHash('ana@example.org'));
		expect(emailHash('ana@example.org')).toMatch(/^[0-9a-f]{64}$/);
	});
});
