import { createHash } from 'node:crypto';

/** Every Redis key of this app starts with it, so the database can be shared with other apps. */
export const PREFIX = 'masterplan:';

/** Redis keys must not hold addresses in clear text: SHA-256 of the lower-case email. */
export const emailHash = (email: string) => createHash('sha256').update(email.trim().toLowerCase()).digest('hex');

/** Marks a mail as sent to one person for one event (the cron claims it before sending); the value is the send time. */
export const mailKey = (slug: string, eventId: string, email: string) => `${PREFIX}mail:${slug}:${eventId}:${emailHash(email)}`;

/** The key before the prefix and the hash. shortcut: only read to carry old markers over, delete with the 120 days the markers live (CLAIM_DAYS), then the next deploy can drop it. */
export const legacyMailKey = (slug: string, eventId: string, email: string) => `mail:${slug}:${eventId}:${email.trim().toLowerCase()}`;
