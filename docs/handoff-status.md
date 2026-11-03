# Engineer handoff: where each brief stands

Checked on master 043dfa3 by reading the code and tests, then running the server suite (268 pass), the session browser specs with `E2E_SESSIONS=true` (8 pass), and a throwaway probe of the session flow with the flag on. Nothing here was run against a deployed site, a real Ably account or a real database.

| Brief | Topic | Evidence in the repo | Not verified |
| --- | --- | --- | --- |
| 1 | Presenter broadcasts (Socket.IO and Ably) | `lib/broadcast.js`; `ably`, `serverlessBroadcast`, `sockets` tests | Real Ably: see `docs/real-ably-smoke.md` (never run) |
| 2 | Comment upvotes by stable id | `lib/slideIdentity.js`; `slideIdentity` test; `/me` returns `upvoteIds` | Old clients still get index based `upvotes` for compatibility |
| 3 | Quiz reveal lock survives saves | `quizLockOnSave`, `editorSaveRace` tests | |
| 4 | Active slide and participant credentials | `activeSlide`, `audienceProtection` tests. In session mode, a probe showed: a credential is bound to its session (401 elsewhere), a mismatched participant id gets 403, a future slide gets 409, and a participant who sends many answers gets 429 | Limits are in memory per instance, so not global on serverless |
| 5 | Decks and live sessions | Models, routes, migration, retention, dashboard and report UI; `sessionRoutes`, `sessionMigration`, `sessionRetention` tests; `sessions`, `session-*` browser specs | Flag is off by default. The migration has never been run on a real database. Whether production has the flag on is unknown |
| 6 | Scalability, dashboard, connection | `coalesce`, `dashboardList`, `indexReady` tests; `docs/load-testing.md` | No load test against a deployed site |
| 7 | Complete-session browser tests | `e2e/session-*.spec.ts` (skipped unless `E2E_SESSIONS=true`) | |
| 8 | Reports and safe CSV | `lib/report.js`, `lib/csvReport.js`; `report`, `csvExport` tests. Cells starting with `=`, `+`, `-`, `@`, tab or CR get a leading apostrophe | |
| 9 | Moderation | `lib/moderation.js`, `docs/moderation.md`; `moderation`, `sessionModeration` tests | |
| 10 | Templates, duplication, recoverable editing | `lib/templates.js`; `duplicateTemplates` test; `editor-undo` browser spec | |

One thing the probe noted: after a session ends its code is released, so a late answer or a page reload on that code gets `404 No presentation with that code` instead of an "ended" message. Phones that are connected when it ends get the terminal state (covered by `session-basics`). This was resolved by the later ended-session fix (PR86): reopening or joining an ended code now reports that the session ended. The audit above remains historical, not a new hosted validation.
