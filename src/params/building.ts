import type { ParamMatcher } from '@sveltejs/kit';
import { BUILDINGS } from '#lib/buildings';

export const match: ParamMatcher = (param) => BUILDINGS.includes(param);
