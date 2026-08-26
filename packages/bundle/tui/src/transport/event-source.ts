/**
 * BFF SSE transport adapter: connects to the dsh Web BFF
 * (`packages/host/apiproxy`) via `EventSource` for the mux stream
 * (`session/event` / `approval/requested` / `question/requested`) and
 * `POST /api/respond` for answers. Unifies with the in-process event firehose
 * via {@link session-event.ts}'s `SessionEventStream`.
 *
 * Phase 2 ships the adapter skeleton + event normalization; the live approval
 * answer over SSE is wired here, the in-process answerer path stays the
 * default for local mode.
 *
 * @module @ruhooai/dsh-tui/transport/event-source
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools/presentation'

/**
 * A host-computed render-intent view, mirroring
 * `@deepseek-ai/dsh-host-apiproxy/api`'s `ToolEventView`. Defined locally so
 * the TUI does not depend on the host BFF package; the in-process runner
 * computes the same shape from `ToolRuntime.presentCall`/`presentResult`.
 */
export type ToolEventView =
  | { for: 'call'; view: ToolCallView }
  | { for: 'result'; view: ToolResultView }

/** A normalized event the render layer consumes, regardless of transport. */
export interface TransportEvent {
  /** The session the event belongs to. */
  sessionId: string
  /** The session event, or undefined for a non-session-event mux frame. */
  event: SessionEvent | undefined
  /** A host-computed render-intent view, when the BFF or runner attached one. */
  view: ToolEventView | undefined
  /** The mux frame type for non-session frames (approval/question). */
  type: string | undefined
}

/** Callback receiving normalized transport events. */
export type TransportListener = (event: TransportEvent) => void

/**
 * A BFF SSE transport. Opens an `EventSource` against the BFF mux stream,
 * normalizes frames into {@link TransportEvent}, and exposes a `respond`
 * method that posts answers to `POST /api/respond`.
 */
export class BffSseTransport {
  private source: EventSource | undefined
  private readonly url: string
  private readonly respondUrl: string

  /** @param bffBaseUrl - the BFF origin (e.g. `http://localhost:3000`). */
  constructor(bffBaseUrl: string) {
    this.url = `${bffBaseUrl}/api/events`
    this.respondUrl = `${bffBaseUrl}/api/respond`
  }

  /**
   * Open the SSE stream and forward normalized events to the listener.
   * @param listener - the callback receiving normalized transport events.
   */
  connect(listener: TransportListener): void {
    this.source = new EventSource(this.url)
    this.source.addEventListener('message', (msg: MessageEvent) => {
      const frame = JSON.parse(msg.data as string) as { type: string; sessionId?: string; event?: SessionEvent; view?: ToolEventView }
      listener({
        sessionId: frame.sessionId ?? '',
        event: frame.event,
        view: frame.view,
        type: frame.type,
      })
    })
  }

  /**
   * Post an approval/ask-user answer back to the BFF.
   * @param payload - the rpc id and outcome to post.
   */
  async respond(payload: { rpcId: string; outcome: string }): Promise<void> {
    await fetch(this.respondUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  }

  /** Close the SSE stream. */
  disconnect(): void {
    this.source?.close()
    this.source = undefined
  }
}
