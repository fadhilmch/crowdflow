# CrowdFlow

[![CI](https://github.com/fadhilmch/crowdflow/actions/workflows/ci.yml/badge.svg)](https://github.com/fadhilmch/crowdflow/actions/workflows/ci.yml)

Open-source interactive real-time presentations - a modern rebuild of this repository's original Mentimeter-style app. Presenters build slides, the audience joins with a 6-digit code (no account needed), and results update live on the big screen.

## Brand colours

The app's base colours are the logo's: indigo `#5757DB` (primary actions, selection, focus), pink `#F12F83` (live dot and result accents) and amber `#FFB224` (warm accents). They live in `client/src/assets/main.css` (`--lead`, `--signal`, `--warmth`) and the default "Candy" theme in `client/src/themes.ts`, and `client/src/__tests__/brandColors.test.ts` checks them against `logo-mark.svg`. Pink is kept to bars, dots and large accents, since white on pink is 3.8:1. Dark mode uses lighter indigo variants (`#7D7DE8`) so text stays readable. The other themes keep their own palettes.

## Features

- **Six slide types**: multiple-choice polls with live bar charts, quizzes whose correct answer and scores reveal when the presenter closes voting, word clouds sized by how many people said each word, 1-10 ratings with average and distribution, option rankings scored by points, and open-ended questions where the audience submits answers and upvotes each other's.
- **Quiz timer**: a quiz slide can have a time limit (10 s to 2 min). The presenter presses Start timer; stage and phones count down together (synced to the server clock), the presenter screen closes voting at zero, and the server rejects answers that arrive more than 1.5 s late. Slides with no limit work as before.
- **Speed scoring**: per presentation, quizzes score either 1 point per correct answer (default) or 1000 down to 500 by answer speed over the time limit (30 s window when a question has no limit).
- **Winners podium**: Show winners on the presenter screen closes voting and shows a final podium with confetti on stage and phones (confetti is off under reduced motion).
- **Layout slides**: title, columns (2-3 text columns) and image-only slides carry nothing to answer, are skipped in results and CSV exports.
- **Image upload**: slide and quiz-question images can be uploaded (JPEG, PNG or WebP, shrunk in the browser to 600 KB or less). Files are stored in MongoDB and served from `/api/media/<id>` (200 per account), so there is no new service or cost. The id is 128 random bits, but the image is public: anyone with its link can view it, so do not upload private photos (the editor says so). The editor's image tile opens a picker dialog: upload, choose from your uploads (with an "On this slide" or "In use" badge and the 200 limit), or paste an https link. The tile's x (*Remove from slide*) only detaches the picture; the trash icon on an upload (*Delete file*, with a confirmation) removes the file for good and is refused while any deck or saved session still shows it, so slides never end up with a broken picture. At the 200 limit an alert in the picker says so, and deleting unused files frees space. Pasted image links still work and must be https.
- **Per-slide design**: pick an accent color from the presentation's palette and add an image beside or behind the question, per slide.
- **Presenter keyboard**: Left/Right arrows and Page Up/Down change slides (ignored while typing or when the join panel is open).
- **Landing page**: `/` introduces the product with a create-a-presentation call to action and a join-with-code field. Its join-code field has a persistent visible label; joining requires no account, and nicknames are quiz-only. The join form itself lives at `/join` (also reachable as `/join?code=123456`); audience links `/p/<code>` are unchanged.
- **6-digit join codes and QR**: audience joins from any browser, no signup. The presenter header's join chip opens a QR code (dark on white, readable in either color mode) that links to `/p/<code>` on the origin the presenter is using, plus the code and a copyable link.
- **Light and dark mode**: a toggle in every header; the choice is saved per browser and defaults to the system setting. Presenter and audience screens keep the presentation's chosen palette in both modes.
- **Live everywhere**: presenter screen, audience phones, and results stay in sync in real time.
- **One vote per browser, not per human**: joining is anonymous. The server issues each browser a credential scoped to that presentation (`POST /api/live/<code>/credential`, valid 30 days, refreshed on every join) and checks it on every answer, so one browser cannot answer as another participant or on another presentation. It cannot prove a unique person: clearing browser storage or using another browser creates a new participant. Upvotes toggle. After a refresh, `GET /api/live/<code>/me` (credential in the `x-participant-token` header) returns that person's own answers.
- **Abuse limits** (HTTP and Socket.IO share them): per participant 20 answers per 10 s and 6 nickname changes per minute, plus a per-IP backstop of 1200 actions per minute so a classroom behind one network is not blocked. Over the limit returns 429 (`rate_limited`, with `Retry-After`). Tune with `LIVE_ANSWERS_PER_10S`, `LIVE_IDENTIFY_PER_MIN`, `LIVE_ACTIONS_PER_IP_PER_MIN`, `LIVE_CREDENTIALS_PER_IP_PER_MIN`. Counters are in memory per server instance, so on serverless they are a best-effort brake per warm instance, not a global cap. These defaults are proposals, not measured against real classrooms.
- **Rollout**: clients without a credential still work (old id-only path). Set `REQUIRE_PARTICIPANT_TOKEN=true` to require one once clients have updated.
- **Presenter accounts**: signup/login (JWT), create/edit/delete presentations, keep already-cast votes when editing slides.
- **Presentation editor**: a slide sorter with per-slide mini previews on the left (click to edit, drag to reorder), the edit form for the selected slide in the middle, and a pinned, labelled stage preview on the right that follows the slide being edited. Slides are added from an Add a slide sheet that shows each type with a stage thumbnail and a one-line explanation. On phones the sorter becomes a thumbnail strip on top and the preview docks at the bottom.
- **Presenter live controls**: close/reopen voting, hide/reveal results on stage and audience, and reset votes per slide, all from the presenter screen.
- **Quiz leaderboard**: players on a deck that has a quiz slide choose a nickname before their first quiz question (type one or tap Generate nickname for a short adjective + animal; no Skip; plain presentations never ask; a name saved on the device is reused), earn +1 per correct answer - the final answer counts, changes are allowed until voting closes - and the top 5 plus your own rank appear on stage and audience once voting closes. Answers and scores stay hidden while voting is open.
- **Honest limits by design**: quiz players stay anonymous beyond their nickname or alias. Word cloud takes one word per participant (a new word replaces the old). Rankings use tap-to-order.
- **Playful, accessible motion**: directional slide transitions, animated bars and count-up tallies, and selection feedback, all disabled under `prefers-reduced-motion`. The landing demo is visitor-driven, not an automatic voting loop: switch between poll, word cloud and quiz, answer from the sample phone, and try presenter controls. It uses deterministic sample totals only, never creates a live room, never sends answers and resets on reload. The hero enters in a stagger and sections reveal on scroll, with the same reduced-motion guard.
- **Busy feedback everywhere**: any button that talks to the server (sign up, log in, join, create, start a session, duplicate, audience sends, presenter controls) locks and shows a spinner with a status label until the answer arrives, so a slow connection never looks like a dead tap.
- **Two realtime transports** (same event protocol, same UI):
  - **Socket.IO** - default, fully self-hosted and open-source.
  - **Ably** - for serverless hosting (e.g. Vercel) where a persistent WebSocket server cannot run.

## Tech stack

| Layer | Choice |
| --- | --- |
| Client | Vue 3 + TypeScript, Vite, Pinia, Vue Router, hand-rolled responsive CSS |
| Server | Node.js (>=20), Express 5, Mongoose 9, Socket.IO 4, Zod validation, Helmet, rate limiting |
| Realtime (serverless) | Ably (subscribe-only token per join code) |
| Data | MongoDB (Atlas free tier or self-hosted) |
| Tests | Vitest + Supertest + mongodb-memory-server |

## Quickstart

### One-command demo (no MongoDB install)

```bash
cd server && npm install && npm run dev:memory
```

Starts an in-memory MongoDB with seeded demo data on http://localhost:3000:

- Audience join code: **123456**
- Presenter login: **demo / demo1234**

The demo account and join code exist only in this in-memory demo seed. A normal deployment has no pre-seeded users or presentations.

Build the client first (`cd client && npm install && npm run build`) to have the server serve it, or run the Vite dev server alongside.

### Local development

```bash
# Terminal 1 - API + Socket.IO on :3000
cd server && npm install && cp .env.example .env
npm run dev

# Terminal 2 - Vite dev server on :5173 (proxies /api and /socket.io)
cd client && npm install && npm run dev
```

### Docker (self-hosted, all-in-one)

```bash
JWT_SECRET=$(openssl rand -hex 32) docker compose up --build
```

Serves API, Socket.IO and the built client on http://localhost:3000 with a persistent MongoDB volume.

## Deployment

### Self-hosted (default)

Any Node host works: build the client, set `CLIENT_DIST`, and the Express server serves the UI plus Socket.IO:

```bash
cd client && npm run build
cd ../server && MONGODB_URI=... JWT_SECRET=... CLIENT_DIST=../client/dist npm start
```

### Vercel + Ably + MongoDB Atlas (serverless)

1. Create a free [Ably](https://ably.com) app and copy its root API key.
2. Create a free [MongoDB Atlas](https://www.mongodb.com/pricing) M0 cluster and a connection string.
3. Import this repo into Vercel (`vercel.json` is included) and set environment variables:
   - `MONGODB_URI` - Atlas connection string
   - `JWT_SECRET` - long random string
   - `ABLY_API_KEY` - Ably root key
   - `CLIENT_ORIGIN` - your deployment origin (or `*`)
4. Set `VITE_LIVE_MODE=ably` so the client uses the Ably transport (mutations go over HTTP, state arrives over Ably).

The `api/index.js` serverless entry reuses the same Express app with a cached Mongo connection. Persistent Socket.IO is not available on Vercel; the Ably path exists for exactly that case.

## Environment variables

See [`server/.env.example`](server/.env.example) and [`client/.env.example`](client/.env.example). Nothing secret is committed; `JWT_SECRET` and `MONGODB_URI` are required in production and the server refuses to boot without them.

## Sign-in with Firebase (optional)

By default CrowdFlow uses its own username and password login. Setting the variables below turns on
[Firebase Authentication](https://firebase.google.com/docs/auth) (email and password or Google sign-in, with
password-reset email sent by Firebase). Nothing changes until you set them, and nothing here creates a project
for you.

| Where | Variable | Purpose |
| --- | --- | --- |
| client (build time) | `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID` | Identify the project to the browser (not secrets) |
| server | `FIREBASE_PROJECT_ID` | Turns Firebase on and verifies ID tokens |
| server | `FIREBASE_API_KEY` | The same public web key. Without a service account, the server uses it to check that a sign-in token was not revoked (signed out everywhere, password reset, account disabled or deleted). Required for keyless profile, move and delete requests; not a secret |
| server | `FIREBASE_SERVICE_ACCOUNT` | Service-account JSON, optional. Without it, the browser removes its own Firebase login after the server deletes the account data (no key to store). A secret: never commit it |
| server | `FIREBASE_AUTH_DOMAIN` | Optional override for the project's auth domain, used in the page security policy for the Google sign-in popup. Defaults to `<project>.firebaseapp.com` |

How it fits the existing app:

- The server still owns profiles and presentations. `User` gains `email` and `firebaseUid`; `username` and
  `passwordHash` become optional. Presentations keep pointing at the same `owner` id.
- **Old accounts move, they are not copied.** `/move-account` asks for the old username and password once, then
  attaches a Firebase login to the same user record. The old password hash is removed after the move.
- **Google sign-in** appears on the login and signup pages once the Google provider is enabled in the Firebase
  console (Authentication > Sign-in method). The site's own domain must be an authorized domain there; localhost
  and the project's `firebaseapp.com` domain are allowed by default. A new Google login still picks its display
  name on the finish-setup screen, prefilled from Google. No extra environment variables.
- **Deleting an account** asks for the password again, or for a Google-only login a fresh Google sign-in
  (the browser re-authenticates, and the server accepts the
  request only if the sign-in is under five minutes old). It then removes the presentations, the profile and the
  Firebase user, in an order that is safe to repeat if a step fails.
- Built-in signup and login return `410` while Firebase is on. Existing 7-day sessions from the old login keep
  working until they expire, except for an account that has moved to Firebase: its old token is refused at once.
- Token revocation: ordinary requests accept a valid ID token (up to one hour old) without asking Google whether it
  was revoked, and the profile, move and delete routes do check. After a password reset or account deletion an old
  token can therefore still open ordinary routes for up to an hour, but a deleted account has no profile, so it
  cannot.
- ID tokens are short lived. The browser SDK refreshes them and the app sends the current one on each request.

Try it locally without a Firebase project, using the [Auth emulator](https://firebase.google.com/docs/emulator-suite):

```bash
npx firebase-tools emulators:start --only auth --project demo-crowdflow
# server: FIREBASE_PROJECT_ID=demo-crowdflow FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npm run dev:memory
# client: VITE_FIREBASE_API_KEY=fake VITE_FIREBASE_PROJECT_ID=demo-crowdflow VITE_FIREBASE_AUTH_EMULATOR_URL=http://127.0.0.1:9099 npm run build
```

The existing `username` index is not changed. A Firebase account gets a generated placeholder username
(`fb-` plus a hash of its uid) that is never shown and cannot be used to log in. New indexes are added
for `email` and `firebaseUid` (unique, sparse), which is safe on an existing database.

Known limits: Spark-plan password-reset emails are capped per day (see the
[Firebase limits](https://firebase.google.com/docs/auth/limits)), and the default sender is a Google address that
can land in spam until a custom domain is set up.

## Architecture

```
client/            Vue 3 SPA
  src/live/        Transport interface + Socket.IO and Ably implementations
  src/stores/      Pinia stores (auth, live session)
server/
  src/lib/         Pure, unit-tested logic: access codes, results/tallies, live actions
  src/routes/      REST: auth, presentations CRUD, live HTTP endpoints (Ably mode)
  src/sockets/     Socket.IO room protocol (self-hosted mode)
  src/models/      Mongoose schemas (User, Presentation)
api/index.js       Vercel serverless entry (HTTP API only)
```

Both realtime transports share one action vocabulary (`slide:change`, `vote:cast`, `response:add`, `response:upvote`) validated with Zod on the server. State broadcasts are audience-safe snapshots - vote identities and response authors never leave the server.

## Testing

```bash
cd server && npm test          # access codes, tallies for all six slide types, live actions, auth, REST, sockets
cd client && npm test          # presentation theme variables and contrast in light and dark mode
cd client && npm run typecheck # vue-tsc strict typecheck
```

Business logic (code generation, tally math, vote/upvote rules) lives in pure functions under `server/src/lib/` and is covered by unit tests independent of Express or MongoDB.

## Security notes

- Passwords hashed with bcrypt; JWT auth with a required secret in production.
- Helmet headers, CORS allowlist, JSON body limits, rate-limited auth endpoints.
- All inputs validated with Zod; audience-visible state strips voter identities.
- Audience actions are keyed by join code: anyone with the code can vote. Presenter controls (edit, delete, change slide, open/close voting, hide results, reset votes) require the owner account.

- Account deletion: `DELETE /api/users/me` (password required) removes the account and all its presentations, including votes, answers and audience nicknames. A deleted account's token stops working immediately. There is no automatic expiry of presentations or votes.
- Sessions last 7 days. When the server rejects a stored token, the app signs the user out and returns them to the log-in page, then back to where they were.

## Roadmap / open decisions

- Account recovery depends on the sign-in mode. With the built-in username and password login there is no password reset (accounts hold no email), so a forgotten password cannot be recovered: keep it in a password manager, or turn on Firebase sign-in, which sends password-reset email (see the Firebase section above). Whether to add email to built-in accounts is an open decision.
- Footer contact details: the footer shows only the licence and a GitHub link until an owner contact is chosen.
- Optional per-presentation audience authentication

## Project docs

- [Design system](docs/DESIGN_SYSTEM.md): tokens, light/dark rules, what not to hard-code.
- [Dependency licences](docs/DEPENDENCY_LICENSES.md): licence summary of the lockfiles.
- Licence: [MIT](LICENSE).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Credits

The interface uses [Plus Jakarta Sans](https://github.com/tokotype/PlusJakartaSans) (SIL Open Font License 1.1, copy in `client/public/fonts/OFL.txt`), served from this app rather than a font CDN. Only Latin characters are included.

Originally inspired by [Mentimeter](https://www.mentimeter.com). Rebuilt in 2026 with a modern stack, preserving the original feature set. CrowdFlow is an independent project and is not affiliated with or endorsed by Mentimeter.

## Operations

- `GET /api/health` is liveness (the process is up). `GET /api/ready` is readiness: it pings the database and returns 503 when it does not answer. Point load balancer or orchestrator checks at `/api/ready`.
- `GET /api/presentations` returns metadata only (`title`, `accessCode`, `slideCount`, dates), newest first, paged with `?limit=` (default 24, max 100) and the `nextCursor` it returns. It never includes slides, answers or voter ids.
## CSV export

`GET /api/presentations/<id>/export.csv?kind=summary|responses|leaderboard` (owner only, also on the dashboard). It is a snapshot of the results at that moment, not a frozen report: live sessions are not yet separate from decks.
- `summary`: one row per answer item (votes and percent, word counts, rating average and buckets, ranking points, quiz correct flag once revealed). No participant ids or names.
- `responses`: written answers with upvotes and UTC time. No author ids.
- `leaderboard`: quiz rank, name and score. Names are what players chose, so this is its own export.
UTF-8 with a byte-order mark, UTC timestamps. Text cells starting with `=`, `+`, `-`, `@`, tab or carriage return get a leading apostrophe so spreadsheets do not run them as formulas. The response is `private, no-store`. "Answers" means stored submissions, not connected clients and not distinct people. The file is built in memory, which is fine for a deck of at most 50 slides but is not streamed.

### Timer, scoring, layouts and uploads

New fields on a slide: `timeLimit`, `body`, `columns`; on a presentation: `quizScoring` (`standard` or `speed`). Presenter actions `timer:start` and `finale:set` are in the live action set. After pulling this change, rebuild the client (`npm run build`). Logic lives in `server/src/lib/scoring.js`, `lib/media.js`, `client/src/quizTimer.ts`, `podium.ts` and `imageUpload.ts`, each unit tested. E2E: `npx playwright test e2e/timer-podium-layouts.spec.ts` after `npm run build`. Not verified against real Firebase or Ably.

### Session basics

- **End** on the presenter screen now closes answers for everyone and saves the ended state. Phones show a thank-you message instead of waiting forever. Leaving a browser tab is not the same as ending a presentation. The legacy deck can be presented again explicitly; that keeps its existing answers and quiz reveal locks. With separate sessions enabled, start a new session for a fresh run.
- Phones show multiple-choice counts/percentages and ranking points, alongside the existing word clouds, ratings, comments and quiz feedback. **Hide results** still removes aggregate results from both screens and public snapshots; **Reveal results** restores them.
- Empty decks point to the editor before presenting. An editor starter slide is not live until it has been saved. A direct empty-stage link also explains what to do next.

Regression coverage: `E2E_CHROME=/path/to/chrome npm run test:e2e -- e2e/session-basics.spec.ts` after `npm run build`. Add `E2E_SESSIONS=true` to cover the separate-session terminal broadcast. This uses the local demo backend, not Firebase or a live Ably account.

### Landing product proof

The landing page includes real editor and presenter screenshots from the seeded local in-memory demo, not customer decks. Open either image at full size on a phone. Assets live in `client/public/landing/`; both are 1280 x 800 WebP captures of the Candy theme in light mode. Refresh them from a local sample if these screens change. Never capture a private presentation or a credential.

Checks for the landing demo: `npm --prefix client test -- src/__tests__/landingDemo.test.ts`, then `npm run build && npm run test:e2e -- e2e/landing-demo.spec.ts`. The browser test covers the three question types, answer replacement, quiz locking/reveal, closed voting, hidden results, reset, join validation/routing, keyboard operation, no live writes, accessibility in all three demo modes, image loading, reduced motion and no overflow at 320/390/768/1280px in light and dark mode.

### First-use review fixes

The editor shows saved/unsaved status on phones and only warns when its current snapshot differs from the last save. New-presentation keyboard focus stays in the modal with arrow-key starting-point selection. The landing code form joins directly with shared nickname restoration, inline failure feedback and a busy state. Quiz samples allow answer changes until reveal, matching the app. Ending a presentation replaces answer/waiting controls with the terminal state. The dashboard explains fresh-session versus existing-run behavior, while landing product proof precedes compact steps/types and uses a readable editor crop on phones.

### Resume and safe ending

When sessions are enabled, dashboard cards list active run codes with Resume links. Resume opens the existing run without creating a new code or clearing answers; reports offer the same link for active sessions. Ending from presenter or report asks once, starts focus on Cancel and explains whether the run can resume. Separate sessions are frozen when ended; reusable deck runs can be presented again with their existing answers. Closing voting remains immediate.
