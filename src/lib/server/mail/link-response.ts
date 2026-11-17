/**
 * The answer of the Orga invite endpoint: JSON `{ "invite_link": "https://…" }`.
 * Only https URLs are accepted, anything else counts as a failure (the fallback link is used then).
 */
export function parseLinkResponse(body: string): string | null {
	let link: unknown;
	try {
		link = (JSON.parse(body) as { invite_link?: unknown } | null)?.invite_link;
	} catch {
		return null;
	}
	return typeof link === 'string' && /^https:\/\/[^\s<>"]+$/.test(link.trim()) ? link.trim() : null;
}
