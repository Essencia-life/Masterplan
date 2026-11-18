import type { LayoutServerLoad } from './$types';
import { rowsForVisitor } from '#lib/server/google';
import { mailTimings } from '#lib/server/mail/timings';

export const load: LayoutServerLoad = async ({ locals }) => {
	const user = locals.user ?? null;
	// read from content/mail/*.json (the CMS); only the days, so the page can say when the mails go out
	const mails = { guest: mailTimings('guest'), volunteer: mailTimings('volunteer') };
	// rows, groups and colours are rendered with the page; a Google error shows as a banner instead of a failed page
	try {
		return { user, mails, meta: await rowsForVisitor(), metaError: null };
	} catch (e) {
		console.error('calendar list failed', e);
		return { user, mails, meta: null, metaError: e instanceof Error ? e.message : 'Could not load calendars' };
	}
};
