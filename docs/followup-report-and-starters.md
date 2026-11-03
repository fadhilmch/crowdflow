# Run reports and creation intent

Follow-up to active-session Resume and End protection. Local implementation only; no deployment or real-account validation.

- End goes to the finished run's report, using the current state's existing id and session marker captured before leaving the live connection. A separate immutable session goes to its frozen session report. The original reusable deck goes to its current-results report.
- The owner's deck stores creationKind (quiz, presentation or blank) separately from its slides. Only new creations send this optional metadata. Reopening an empty deck uses that recorded intent; older decks keep the existing query/default fallback. Starter slides are still unsaved drafts, so discarding edits does not silently persist slide content or choose a correct quiz answer.
- This adds no account setup, credentials, migration, external service or public audience field. Existing decks without creationKind need no backfill.

Remaining live validation is separate: real Firebase/Google sign-in, Ably across a host and two phones, physical QR scanning and reconnecting after network interruption. These are unverified, not established defects. No deployment, account mutation or physical-device access is implied by local tests.
