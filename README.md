# Masterplan

Essência booking tool: a horizontal timeline of everything that is booked (events, retreats, guests, community, rooms) on top of Google Calendar.

SvelteKit 3 (Svelte 5 runes, remote functions), Tailwind CSS 4, flowbite-svelte, `googleapis`, zod.

## What it does

- One scrollable timeline with virtual scrolling (only the visible days plus a buffer are rendered). Header: month, day, moon phase (new and full moon highlighted).
- One row per calendar and per resource (room) calendar, grouped. Groups can be collapsed, reordered by drag and drop, and single rows can be hidden. Collapsed groups and hidden rows are not fetched.
- A retreat books several rooms; all bars of one booking are linked (hatched, highlighted together on hover).
- Click an event or drag over days (mobile: long press, then drag) to open the booking panel (side panel on desktop, bottom sheet on mobile).
- Panel: details (incl. times for non-all-day events), resources, and a **Conflicts** tab. A conflicting booking keeps its event; only the room reservation is released or moved to a free room (for series only that one instance).
- Warnings (not blocks): double-booked rooms, less than one free day between retreats.
- Bars show a warning badge when a room declined the booking and a note badge when the event has a description.
- Declined room bookings are hidden in the room calendars.

## Access model

| Visitor | Sees | Can |
| --- | --- | --- |
| anonymous | availability only: bars titled "Booked", no notes, no details | scroll the timeline |
| signed-in Workspace user | everything | create/edit/delete in every calendar they have write access to in Google |

Hybrid authentication:

- **Reads** (calendar list, events, resource calendars) use a **service account**, so everybody, signed in or not, gets the same data. Anonymous visitors only receive sanitised events.
- **Writes** use the **signed-in user's own OAuth token**. Google's calendar sharing decides what is allowed; the organizer of a booking is the real person.
- Write permission per calendar comes from the user's own Google calendar list (`owner` or `writer`). Shared calendars must be in that user's list, otherwise they are read-only for them.
- Sign-in is limited to the Workspace domain (`ALLOWED_DOMAIN`, checked on the verified ID token: `hd` and `email_verified`).
- Session: AES-256-GCM encrypted httpOnly cookie (`SESSION_SECRET`), 30 days. The refresh token never reaches the browser.

## Setup

### 1. Google Cloud

Use a project that belongs to the Workspace **organization** (an OAuth consent screen can only be "Internal" for such projects; a project created from a private account has to be moved first).

1. Enable the **Google Calendar API**.
2. **Service account** (reading): create it, create a JSON key, enable domain-wide delegation, and in the Workspace admin console (Security → API controls → Domain-wide delegation) allow the scope `https://www.googleapis.com/auth/calendar` for its client ID.
3. **OAuth client** (login/writing): type "Web application", consent screen "Internal", authorised redirect URIs `http://localhost:5173/auth/callback` and `<production origin>/auth/callback`.

### 2. Calendars

The timeline is built entirely from the calendar list of the impersonated user (`GOOGLE_IMPERSONATE_USER`); nothing is configured per calendar in the app.

- **Event calendars** are named `Group/Name` (e.g. `Programme/Retreats`). The part before the first `/` is the group, the rest is the row name. Calendars that do not follow the scheme are ignored.
- **Resource calendars** (rooms) are named `Group-Floor-Name (capacity)`, e.g. `Farmhouse-1-Room 5 (4)`. The group is the first part, the row shows `Name`, floor is used for ordering, the capacity in brackets is dropped. A room group with the same name as an event calendar group ends up in the same group.
- The impersonated user has to have all event and resource calendars in their calendar list. Calendars called `Private` or `Phases of the Moon`, holiday and contact calendars are ignored.
- Colours come from the calendar list (`backgroundColor`).
- Groups with event calendars come first, groups with only rooms after them (alphabetical). The user can reorder them.
- A retreat warning is shown when the selected calendar's name contains "retreat".
- Time zone for everything shown and written: `Europe/Lisbon`.

### 3. Environment

Copy `.env.example` to `.env` (variables are declared in `src/env.ts`):

| Variable | Purpose |
| --- | --- |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | service account JSON (raw or base64), or only the PEM private key |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | only when the variable above holds just the private key |
| `GOOGLE_IMPERSONATE_USER` | Workspace user the service account acts as for reading |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth client |
| `ALLOWED_DOMAIN` | Workspace domain allowed to sign in, e.g. `essencia.life` |
| `SESSION_SECRET` | random string, at least 32 characters (`openssl rand -base64 48`) |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | optional shared cache (or `KV_REST_API_URL` / `KV_REST_API_TOKEN` from the Vercel marketplace); without them an in-process cache is used |

### 4. Run

```sh
npm install
npm run dev        # http://localhost:5173
npm run check      # svelte-check
npm run lint
npm run test
npm run build
```

## Routes

| Route | Purpose |
| --- | --- |
| `/` | timeline |
| `/event` | new booking (panel); `?row=<resource>&from=&to=` when started from a room row |
| `/event/<calendar>` | new booking in that calendar, `?from=&to=` preselects days |
| `/event/<calendar>/<eventId>` | edit a booking |
| `/auth/login`, `/auth/callback`, `/auth/logout` | Google sign-in (logout is a POST) |

`<calendar>` is the Google calendar id without the `@group.calendar.google.com` suffix. The panel is a child route rendered inside the `(app)` layout, which holds the timeline. `/event…` redirects to the login for anonymous visitors and returns afterwards.

## Code map

| Path | Content |
| --- | --- |
| `src/routes/(app)/+layout.svelte` | timeline: virtual window, rows, lanes, selection gestures, group reordering |
| `src/routes/(app)/event/[[calendarId]]/[[eventId]]/+page.svelte` | booking panel and conflict handling |
| `src/lib/calendar.remote.ts` | remote functions (zod): `getCalendars`, `getEvents`, `getEvent`, `saveEvent`, `deleteEvent`, `resolveConflict`, `refreshRows` |
| `src/lib/server/google.ts` | Google clients, row model, event normalisation, auth helpers (service account vs. user) |
| `src/lib/server/session.ts`, `oauth.ts` | encrypted cookie session, OAuth client |
| `src/lib/timeline.svelte.ts` | client cache of events (per row and 90-day chunk), expanded groups, hidden rows, group order |
| `src/lib/time.ts` | day maths (days since a base date), moon phase, wall-clock minutes |
| `src/hooks.server.ts` | puts the signed-in user on `event.locals` |

Data flow: the layout asks `getEvents` for the rows of expanded groups for the visible window (in 90-day chunks). Mutations return the fresh state of every touched row in the same response (single flight) and the client merges it into its cache. Room copies of a new booking are shown as tentative placeholders and confirmed by a delayed re-read, because Google creates them asynchronously.

## Caching and quota

- Google Calendar quota: 600 requests per minute per user and 10,000 per project. All reads go through the service account, so they are cached for 60 seconds per row and window (`src/lib/server/cache.ts`): Upstash Redis when configured, otherwise in-process memory. One cache round trip serves all rows of a request.
- Every mutation (and the delayed re-read of room copies) drops the cached rows it touched.
- Google calls are attributed to the visitor with `quotaUser` (hashed email or client address) and retried with exponential backoff on 429/403 usage limit errors.
- A failing cache never breaks the app, it only costs a Google request.

## Browser storage

`localStorage`: `expandedGroups`, `hiddenRows`, `groupOrder`. All reads and writes are wrapped; the app works without storage.

## Status and limits

- Written without being able to build or run it in the authoring environment: run `npm run check` and click through the flows before relying on it.
- Reading and writing both depend on Google's own permissions; the app does not add a role system.
- Bookings are shifted/edited only in the panel (no drag and drop of bars).
