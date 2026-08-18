/**
 * Session-event stream unifier: normalizes the in-process `session/event`
 * firehose and the BFF SSE mux stream into one `TransportEvent` feed the
 * render layer consumes. The local mode attaches directly to
 * `ctx.on('session/event')`; the remote mode attaches to a
 * {@link BffSseTransport}. Both feed the same render path.
 *
 * @module @deepseek-ai/dsh-tui/transport/session-event
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { TransportEvent } from './event-source.js'

/** A unified listener receiving transport events from either source. */
export type UnifiedListener = (event: TransportEvent) => void

/**
 * Subscribe to the in-process `session/event` firehose and forward each
 * event as a {@link TransportEvent}. Returns a disposer.
 */
export function subscribeInProcess(ctx: Context, listener: UnifiedListener): () => void {
  return ctx.on('session/event', (session: Session, event: SessionEvent) => {
    listener({
      sessionId: session.id,
      event,
      view: undefined,
      type: 'session/event',
    })
  })
}
