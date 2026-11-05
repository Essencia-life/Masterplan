export type RowInfo = {
	/** Google calendar id */
	id: string;
	label: string;
	kind: 'calendar' | 'resource';
	groupId: string;
	color: string;
	available: boolean;
	/** bookings can be created/edited here (calendars with write access) */
	writable: boolean;
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

/** Result of a mutation: the fresh state of every row it touched (single-flight, no refetch round trip). */
export type Fresh = { from: string; to: string; rows: Record<string, CalEvent[]> };

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
