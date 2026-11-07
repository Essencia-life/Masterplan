import type { LayoutServerLoad } from './$types';
import { rowsForVisitor } from '#lib/server/google';

export const load: LayoutServerLoad = async ({ locals }) => {
	const user = locals.user ?? null;
	// rows, groups and colours are rendered with the page; a Google error shows as a banner instead of a failed page
	try {
		return { user, meta: await rowsForVisitor(), metaError: null };
	} catch (e) {
		console.error('calendar list failed', e);
		return { user, meta: null, metaError: e instanceof Error ? e.message : 'Could not load calendars' };
	}
};
