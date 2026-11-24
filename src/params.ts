import { defineParams } from '@sveltejs/kit/params';

/** Public buildings (= calendar groups) as URL slugs: the group label lowercased, spaces as "-". Kept inline: this file is loaded by plain Node, which cannot resolve "#lib/…" without an extension. */
const BUILDINGS = ['event-spaces', 'guesthouse', 'tents', 'yurts'];

export const params = defineParams({
	building: (param) => (BUILDINGS.includes(param) ? param : undefined)
});
