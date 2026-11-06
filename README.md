# Masterplan
Essência Booking tool

## Authentication

- Everybody can open the timeline and sees **availability only** (no titles or notes).
- **Workspace users** sign in with Google (`/auth/login`). They see all details and can create/edit bookings in every calendar they have write access to in Google. Writes are made with the user's own OAuth token.
- Reads (calendar list, events, resource calendars) use the service account (`GOOGLE_SERVICE_ACCOUNT_JSON`, optionally with `GOOGLE_IMPERSONATE_USER`).
- Google Cloud: OAuth client of type "Web", consent screen "Internal", redirect URI `<origin>/auth/callback`.
- Session: AES-256-GCM encrypted httpOnly cookie (`SESSION_SECRET`), 30 days. Write permission per calendar comes from the user's own calendar list, so shared calendars must be in their list.
