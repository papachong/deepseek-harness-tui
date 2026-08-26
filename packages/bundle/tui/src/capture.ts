/**
 * SessionEnd capture hook: a thin Evidence-collection stub that mirrors the
 * `ai-cli` role in the memory scheme (analysis note §9.2). On session end it
 * logs a dry-run capture intent; per the solution note Phase 3, the actual
 * `sf memory capture` call is deferred until the user confirms (the capture
 * must reuse ai-cli's redaction/queue/replay, not bypass it).
 *
 * @module @ruhooai/dsh-tui/capture
 */

import type { Session } from '@deepseek-ai/dsh-session'

/**
 * A dry-run capture record: logs the session that would be captured, without
 * writing anywhere. The real capture (M2 partial) reuses `sf memory capture`
 * out-of-tree.
 */
export interface CaptureIntent {
  /** The session id whose JSONL transcript would be captured. */
  sessionId: string
  /** The event count in the transcript. */
  eventCount: number
  /** Dry-run marker: no evidence is written until the user confirms. */
  dryRun: true
}

/**
 * Produce a dry-run capture intent for a session. Logs to stderr; does not
 * invoke `sf memory capture` until the user confirms (solution note Phase 3,
 * risk #4: any capture must reuse ai-cli's redaction/idempotence).
 * @param session - the session whose transcript would be captured.
 * @returns the dry-run capture intent (sessionId, event count, dry-run flag).
 */
export function dryRunCapture(session: Session): CaptureIntent {
  const intent: CaptureIntent = {
    sessionId: session.id,
    eventCount: session.events.length,
    dryRun: true,
  }
  process.stderr.write(
    `[capture] dry-run: session ${intent.sessionId} (${intent.eventCount} events) — `
    + 'run `sf memory capture --file <transcript>` to collect evidence\n',
  )
  return intent
}
