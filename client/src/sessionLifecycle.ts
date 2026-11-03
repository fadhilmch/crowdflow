/** Consequences differ between an immutable session and the original reusable deck run. */
export function endMessage(session: boolean): string {
  return session
    ? 'Audience answering will stop and this join code will close. Answers stay in this session report. This session cannot be resumed; starting again creates a new session.'
    : 'Audience answering will stop. Answers stay in the report. You can present this run again with the same code and existing answers.'
}
