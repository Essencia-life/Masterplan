const GROUP_SUFFIX = '@group.calendar.google.com';
export const RESOURCE_SUFFIX = '@resource.calendar.google.com';

/** URL segment for a calendar id: the common "@group.calendar.google.com" suffix is dropped. */
export function calendarSlug(id: string) {
	return id.endsWith(GROUP_SUFFIX) ? id.slice(0, -GROUP_SUFFIX.length) : encodeURIComponent(id).replace(/%40/g, '@');
}

/** Inverse of calendarSlug: ids without an "@" are group calendars. */
export function calendarIdFromSlug(slug?: string | null) {
	if (!slug) return undefined;
	const v = decodeURIComponent(slug);
	return v.includes('@') ? v : v + GROUP_SUFFIX;
}

export const isResourceId = (id: string) => id.endsWith(RESOURCE_SUFFIX);
