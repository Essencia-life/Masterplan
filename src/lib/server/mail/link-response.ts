/**
 * The answer of the Telegram link endpoint: JSON with `link` (or `url`), or just the URL as text.
 * Only https URLs are accepted, anything else counts as a failure (the fallback link is used then).
 */
export function parseLinkResponse(body: string): string | null {
	const text = body.trim();
	let candidate: unknown = text;
	if (text.startsWith('{')) {
		try {
			const json = JSON.parse(text) as { link?: unknown; url?: unknown };
			candidate = json.link ?? json.url;
		} catch {
			return null;
		}
	}
	if (typeof candidate !== 'string' || !/^https:\/\/[^\s<>"]+$/.test(candidate.trim())) return null;
	return candidate.trim();
}
