import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// bookings can only be created or edited by signed-in users; deep links go through the login and come back
export const load: PageServerLoad = ({ locals, url }) => {
	if (!locals.user) redirect(303, `/auth/login?returnTo=${encodeURIComponent(url.pathname + url.search)}`);
};
