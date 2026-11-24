import { defineParams } from '@sveltejs/kit/params';
import { BUILDINGS } from '#lib/buildings';

export const params = defineParams({
	building: (param) => (BUILDINGS.includes(param) ? param : undefined)
});
