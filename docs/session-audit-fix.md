# Session audit fix (local verification, 26 October 2026)

Fixes three current-master audit defects:

- New sessions retain title subtitles, column content, quiz time limits and speed scoring. Fresh runs still have new option ids, remapped correct answers, no votes/answer times, no reveal locks, no finale and no question-start clock. The source deck is unchanged.
- Legacy migration retains ended/active status, end time, scoring, clock, finale and moderation history. It remains dry-run by default and idempotent. This does not repair previously migrated sessions, because existing legacy sessions are deliberately not overwritten. Review any existing migration state before rollout. No real migration was run during this work.
- Audience credentials for separate sessions bind to their immutable session id, not their reusable code. HTTP answers, own-answer reads and Socket.IO actions check that scope. The action queue also checks the validated target id after loading/retrying. Separate sessions require a current credential even when legacy deck id-only compatibility is enabled. Existing session pages carrying old code-only credentials must reload; normal joins refresh credentials automatically. Anonymous joining is still allowed to anyone with the current code. Legacy deck token and no-token rollout behavior stays unchanged.

Local checks use isolated in-memory MongoDB, local auth and Socket.IO. They do not prove Firebase, Google sign-in, Ably, Atlas, hosted deployment, load or Mac/Safari behavior. No live DB/account, migration, deployment, push or merge is part of this change.

New regressions: `server/tests/sessionAudit.test.js` and `e2e/session-snapshot.spec.ts`. Existing session moderation test now obtains a real audience credential and asserts the submission succeeded, rather than silently making an unauthenticated request.

Known separate documentation drift remains in `docs/live-sessions.md`: some sections describe older pre-route phases. This focused fix does not merge or replace audit-docs PR #85.
