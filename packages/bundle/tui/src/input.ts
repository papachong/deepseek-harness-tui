/**
 * Single-owner line input dispatcher for the TUI REPL.
 *
 * Fixes the shared-readline double-consumption bug (optimization note
 * 2026-08-19-tui-optimization-plan.zh.md §3): the REPL's
 * `for await (const line of rl)` and the answerers' `rl.once('line')` both
 * received every line — an approval/ask-user answer was ALSO queued into the
 * REPL iterator and, after the turn ended, sent to the agent as a fake task
 * line. This module owns the readline interface and routes each line to
 * exactly ONE consumer: a pending prompt reader (approval / ask-user) if any,
 * otherwise the task-line queue consumed by the REPL loop.
 *
 * @module @deepseek-ai/dsh-tui/input
 */

import { createInterface } from 'node:readline'

/** Options for {@link createLineInput}; mirrors readline createInterface. */
export interface LineInputOptions {
  /** The stdin stream (readline input). */
  input: NodeJS.ReadableStream
  /** The terminal surface (readline output — required for echo). */
  output: NodeJS.WritableStream
  /** terminal:true enables raw-mode echo/line-editing on a real TTY. */
  terminal: boolean
}

/** The single-owner line dispatcher: one readline, exactly one consumer per line. */
export interface LineInput {
  /**
   * Next task line for the REPL loop, or `null` on EOF/close (Ctrl-D on an
   * empty line, or a piped writer ending the stream).
   */
  nextTaskLine(): Promise<string | null>
  /**
   * Next line for a pending prompt (approval / ask-user). Lines typed while a
   * reader is pending go to the reader and NEVER to the task queue.
   * Resolves `null` on EOF/close.
   */
  readLine(): Promise<string | null>
  /** Close the underlying readline interface (idempotent). */
  close(): void
}

/**
 * Create the line dispatcher. The caller must ensure stdin was paused before
 * a long async boot (runner.ts) so buffered piped data survives; readline
 * resumes the stream on creation and lines are queued here until drained.
 * @param options - readline wiring options.
 * @returns the dispatcher.
 */
export function createLineInput(options: LineInputOptions): LineInput {
  const rl = createInterface({
    input: options.input,
    output: options.output,
    terminal: options.terminal,
  })

  const taskQueue: string[] = []
  const taskWaiters: Array<() => void> = []
  const readerQueue: Array<(line: string | null) => void> = []
  let closed = false

  rl.on('line', (line: string) => {
    if (closed) return
    const reader = readerQueue.shift()
    if (reader !== undefined) {
      reader(line)
      return
    }
    taskQueue.push(line)
    taskWaiters.shift()?.()
  })

  rl.on('close', () => {
    if (closed) return
    closed = true
    for (const resolve of readerQueue.splice(0)) resolve(null)
    for (const wake of taskWaiters.splice(0)) wake()
  })

  function nextTaskLine(): Promise<string | null> {
    const queued = taskQueue.shift()
    if (queued !== undefined) return Promise.resolve(queued)
    if (closed) return Promise.resolve(null)
    return new Promise((resolve) => {
      taskWaiters.push(() => { resolve(taskQueue.shift() ?? null) })
    })
  }

  function readLine(): Promise<string | null> {
    if (closed) return Promise.resolve(null)
    return new Promise((resolve) => {
      readerQueue.push(resolve)
    })
  }

  function close(): void {
    if (closed) return
    closed = true
    // Settle deterministically rather than relying on readline's 'close'
    // event: rl.close() on a non-terminal stream may not fire it.
    for (const resolve of readerQueue.splice(0)) resolve(null)
    for (const wake of taskWaiters.splice(0)) wake()
    rl.close()
  }

  return { nextTaskLine, readLine, close }
}
