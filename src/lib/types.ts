export type MainKey = 'events' | 'retreats' | 'bookings' | 'community' | 'coworking';
export const MAIN_KEYS: MainKey[] = ['events', 'retreats', 'bookings', 'community', 'coworking'];

export type RowInfo = {
	/** MainKey for the configured calendars, the Google calendar id for resource calendars */
	id: string;
	label: string;
	kind: 'calendar' | 'resource';
	groupId: string;
	color: string;
	available: boolean;
};

export type GroupInfo = { id: string; label: string };

export type CalendarMeta = { groups: GroupInfo[]; rows: RowInfo[] };

export type CalEvent = {
	id: string;
	rowId: string;
	/** same iCalUID across organizer and resource copies, used to visually link bars */
	linkId: string;
	title: string;
	/** ISO dates, end is exclusive */
	start: string;
	end: string;
	status: 'confirmed' | 'tentative' | 'cancelled';
	description: string;
};

export type EventDetail = {
	id: string;
	linkId: string;
	calendar: string;
	title: string;
	start: string;
	end: string;
	status: 'confirmed' | 'tentative';
	description: string;
	allDay: boolean;
	/** HH:mm, only for timed events */
	startTime: string;
	endTime: string;
	resourceIds: string[];
};
