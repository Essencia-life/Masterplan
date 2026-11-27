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
- **Jobs**: events in Community, Events and Retreat calendars can carry jobs (title, slots, "ask for details", "call for help if empty") that people sign up for in the Telegram week plan. Configured in the panel's **Jobs** tab, for a whole series or a single event.
- **Saving a series event**: the arrow next to Save offers only this event (default), this and following events (the series is split: the old one ends the day before, a new one starts with this event) or all events. For the last two the day of the event cannot change; only times, length, title, rooms and jobs.
- **Deleting a series event**: the arrow next to Delete offers only this event, this and following events (the series ends the day before) or all events.
- **Repeat**: for new events, single events and series created here (changing it applies to the whole series and can reset edits to single events in it). Other recurrence rules (every 2 weeks, daily, …) are shown as custom and stay untouched. Options: weekly (an RRULE, optionally until a date) or by moon phase, e.g. "last Friday before the full moon". Moon dates are listed one by one (RDATE) for up to about a year, since Google has no rule for them; the phase times are an approximation (mean synodic month, the same model as the moons in the timeline).

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

## Jobs (Telegram week plan)

Calendars whose group or name contains `community`, `event` or `retreat` (`JOB_CALENDARS` in `src/lib/jobs.ts`) get a **Jobs** tab in the booking panel. The configuration is stored on the Google event as two private extended properties:

| Property | Content |
| --- | --- |
| `jobs` | JSON array of `{ key, title, slots, askDetails, sos, description? }`. `key` is derived from the title when a job is created and never changes (lowercase letters and digits). `askDetails` needs `slots` = 1. `sos`: the daily agenda calls for help while the job is empty. `description` (optional, up to 200 characters) is shown folded under the job in the week plan. All jobs together must stay within 1024 characters, because Google cuts longer property values. |
| `type` | stable key of this kind of event, a slug of the title set once (e.g. `lunch`). Sign-ups are stored under it, so do not change it. |

- For an event of a series the properties go to the series master and the instances inherit them. "Only this event" writes them on the instance. Saving jobs for the whole series later overwrites such exceptions.
- Sign-ups are not stored in Google Calendar, only the job definitions are. They are written by the bot.
- Events that still carry the bot's older object-shaped `jobs` value show no jobs and cannot be saved with jobs here (409).

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
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | optional shared cache (or `KV_REST_API_URL` / `KV_REST_API_TOKEN` from the Vercel marketplace); without them an in-process cache is used |

### 4. Run

```sh
npm install
npm run dev        # http://localhost:5173
npm run check      # svelte-check
npm run lint
npm run test       # vitest: pure functions in time, calendar-id, server/parse
npm run build
```

## Welcome mails

Guests and volunteers get a welcome mail a few days before they arrive. A daily Vercel cron (`vercel.json`, 08:00 UTC) calls `/api/cron/welcome`, which

- looks at all confirmed bookings in calendars that support participants (name contains "guest" or "volunteer"),
- for every template of that kind whose mail is due (see below), sends one mail per participant (the event's attendees, see above) through the **Gmail API**, using the service account delegated to `MAIL_GUEST_SENDER` / `MAIL_VOLUNTEER_SENDER`,
- remembers every sent mail in Redis (`masterplan:mail:<template>:<event>:<sha256 of the email>`, 120 days; the value is the send time) so nobody gets it twice; if sending fails, the marker is released and the next run retries. **Redis is required**, the route refuses to run without it. At most 40 mails per run.

Templates are named `<kind>-<what>`: `guest-welcome`, `guest-thanks`, `volunteer-welcome`, `volunteer-thanks`. Calendars with "volunteer" in the group or calendar name use the `volunteer-` ones, all other participant calendars the `guest-` ones. Every template has a **timing**: N days *before arrival* or N days *after departure* (departure = the booking's last day). A mail is due from that day on, bookings made later get it with the next run, and a mail more than 7 days overdue is skipped (a missed cron run must not mail old guests). Unconfirmed bookings get nothing.

**Texts and attachments** are maintained in Sveltia CMS (open `/admin/` on the deployed site; config embedded in `static/admin/index.html`, backend GitHub). One entry per file in `content/mail/` (a folder collection: create new ones in the CMS; the file name is the slug and must start with `guest-` or `volunteer-`, otherwise it is ignored): subject, timing, message (simple Markdown: bold, italic, links, lists, `##` heading) and PDF attachments. The editor has components for the placeholders `{{name}}`, `{{arrival}}` and `{{departure}}`, which are replaced per guest. The files live in `content/mail/*.json` and `content/mail/files/*.pdf`; they are read at build time, so a change goes live with the next deployment, and the PDFs are not public.

**Links** in the texts: `{{feedbackLink}}` is `MAIL_FEEDBACK_URL`. `{{telegramJoinLink}}` is asked per guest from the Orga invite endpoint (`MAIL_TELEGRAM_ENDPOINT`, the full URL of `GET /orga/api/telegram/invite`): query `name`, `departure` (YYYY-MM-DD) and `type` (`guest` or `volunteer`), the secret `ORGA_BOT_INVITE_SECRET_TOKEN` (the same value the Orga app checks) in the `x-secret-token` header, answer `{ "invite_link": "https://…" }`. If the endpoint is not set, the secret is missing, it times out (5 s), answers with an error or without a valid https link, `MAIL_TELEGRAM_FALLBACK_URL` is used; if that is empty too, the mail is not sent and retried at the next run. Both links are only looked up for templates that contain the placeholder, and they work bare (a clickable link) or as a target: `[Join us]({{telegramJoinLink}})`.

**Layout** is MJML in the brand colours (`src/lib/server/mail/layout.ts`): the logo on the parchment background, a white message block, a footer linking to essencia.life. The logo (`logo.png`, the website's `logo.avif` converted, because mail clients do not show AVIF) is sent inside every mail as an inline image. Gmail ignores web fonts, the serif falls back to Georgia.

Setup:

1. Admin console, domain-wide delegation: add the scope `https://www.googleapis.com/auth/gmail.send` to the service account's client ID. Enable the Gmail API in the Google Cloud project.
2. Set `MAIL_GUEST_SENDER` and `MAIL_VOLUNTEER_SENDER` (real Workspace mailboxes, e.g. `guests@essencia.life`; Gmail shows the mail as sent by it). The sender names are fixed in `gmail.ts`: "Essência Nature Retreat" (guests) and "Essência Volunteer Program" (volunteers) and `CRON_SECRET`.
3. Test: `curl -H "Authorization: Bearer $CRON_SECRET" "https://<site>/api/cron/welcome?test=you@example.org&template=guest-welcome"` sends one sample mail and records nothing.

The GitHub login for Sveltia runs on this site (`src/routes/admin/auth`, copied from the website repo). Create a GitHub OAuth app with callback URL `https://<site>/admin/auth/callback` and set `CMS_GITHUB_CLIENT_ID` / `CMS_GITHUB_CLIENT_SECRET`. Editors need write access to this repo.

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
| `src/lib/jobs.ts` | jobs schema (zod), key/slug helpers, which calendars support jobs (unit tested) |
| `src/lib/calendar.remote.ts` | remote functions (zod): `getEvents`, `getEvent`, `saveEvent`, `deleteEvent`, `resolveConflict`, `refreshRows` |
| `src/lib/server/google.ts` | Google clients, row model (calendar list), event reads, auth helpers (service account vs. user) |
| `src/lib/server/parse.ts` | pure functions: calendar/room name schemes, time zone helpers, event normalisation (unit tested) |
| `src/lib/server/cache.ts` | Upstash/in-memory row cache, send-once markers |
| `src/lib/server/mail/` | welcome mails: templates (CMS content), Markdown subset, MJML layout, MIME, Gmail, the cron logic |
| `src/routes/api/cron/welcome/` | the cron endpoint |
| `content/mail/`, `static/admin/` | mail texts and PDFs, Sveltia CMS |
| `src/lib/server/session.ts`, `oauth.ts` | encrypted cookie session, OAuth client |
| `src/lib/timeline.svelte.ts` | `Timeline` state, one instance per page load via Svelte context (`setTimeline`/`getTimeline`): events per row, expanded groups, hidden rows, group order |
| `src/lib/time.ts` | the app time zone, day maths (days since a base date), end-of-event rule shared by server and panel, moon phase, wall-clock minutes |
| `src/hooks.server.ts` | puts the signed-in user on `event.locals` |

Data flow: the layout load (`+layout.server.ts`) delivers rows and groups with the page. The layout then asks `getEvents` for the rows of expanded groups for the visible window (in 90-day chunks). Mutations return the fresh state of every touched row in the same response (single flight) and the client merges it into its cache. Room copies of a new booking are shown as tentative placeholders and confirmed by a delayed re-read, because Google creates them asynchronously.

## Caching and quota

- Google Calendar quota: 600 requests per minute per user and 10,000 per project. All reads go through the service account, so they are cached for 60 seconds per row and window (`src/lib/server/cache.ts`): Upstash Redis when configured, otherwise in-process memory. One cache round trip serves all rows of a request.
- Every mutation (and the delayed re-read of room copies) drops the cached rows it touched.
- Google calls are attributed to the visitor with `quotaUser` (hashed email or client address) and retried with exponential backoff on 429/403 usage limit errors.
- A failing cache never breaks the app, it only costs a Google request.

## Browser storage

`localStorage`: `expandedGroups`, `hiddenRows`, `groupOrder`. Read once after mount (server render and hydration use the defaults), all reads and writes are wrapped; the app works without storage.

## Status and limits

- Written without being able to build or run it in the authoring environment: run `npm run check` and click through the flows before relying on it.
- Reading and writing both depend on Google's own permissions; the app does not add a role system.
- Bookings are shifted/edited only in the panel (no drag and drop of bars).
