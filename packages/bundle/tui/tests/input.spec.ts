/**
 * LineInput dispatcher tests: single-owner routing of readline lines.
 *
 * Regression coverage for the shared-readline double-consumption bug
 * (optimization note 2026-08-19 §3): a line answered to a pending
 * approval/ask-user reader must NEVER also enter the REPL task queue (and
 * vice versa). Uses PassThrough streams — readline runs in non-terminal line
 * mode, which is the same routing path as a real TTY.
 */

import { PassThrough } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { describe, expect, it } from 'vitest'
import { registerApprovalAnswerer } from '../src/answerers.ts'
import { createLineInput, type LineInput } from '../src/input.ts'
import { createTuiStore } from '../src/view/store.js'

function make(): { stdin: PassThrough; stdout: PassThrough; input: LineInput } {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const input = createLineInput({ input: stdin, output: stdout, terminal: false })
  return { stdin, stdout, input }
}

describe('createLineInput', () => {
  it('queues task lines in order when no reader is pending', async () => {
    const { stdin, input } = make()
    stdin.write('first\n')
    stdin.write('second\n')
    expect(await input.nextTaskLine()).toBe('first')
    expect(await input.nextTaskLine()).toBe('second')
  })

  it('routes a line to a pending reader and NOT to the task queue (double-consumption fix)', async () => {
    const { stdin, input } = make()
    const reader = input.readLine()
    stdin.write('y\n')
    expect(await reader).toBe('y')
    // The answer line must not have been queued as a task: the next task
    // line is the one typed after the answer, not the answer itself.
    stdin.write('next task\n')
    expect(await input.nextTaskLine()).toBe('next task')
  })

  it('serves multiple pending readers FIFO', async () => {
    const { stdin, input } = make()
    const r1 = input.readLine()
    const r2 = input.readLine()
    stdin.write('a\n')
    stdin.write('b\n')
    expect(await r1).toBe('a')
    expect(await r2).toBe('b')
  })

  it('keeps lines typed before a prompt in the task queue, not the reader', async () => {
    const { stdin, input } = make()
    stdin.write('task typed before prompt\n')
    const reader = input.readLine()
    stdin.write('y\n')
    expect(await reader).toBe('y')
    expect(await input.nextTaskLine()).toBe('task typed before prompt')
  })

  it('does not trim lines (empty lines pass through)', async () => {
    const { stdin, input } = make()
    stdin.write('\n')
    stdin.write('  padded  \n')
    expect(await input.nextTaskLine()).toBe('')
    expect(await input.nextTaskLine()).toBe('  padded  ')
  })

  it('resolves pending readers and task waiters with null on EOF', async () => {
    const { stdin, input } = make()
    const reader = input.readLine()
    const task = input.nextTaskLine()
    stdin.end()
    expect(await reader).toBeNull()
    expect(await task).toBeNull()
  })

  it('returns null after close() and is idempotent', async () => {
    const { stdin, input } = make()
    input.close()
    input.close()
    expect(await input.nextTaskLine()).toBeNull()
    expect(await input.readLine()).toBeNull()
    // late input after close must not resurrect routing
    stdin.write('late\n')
    expect(await input.nextTaskLine()).toBeNull()
  })

  it('settles queued waiters on close()', async () => {
    const { input } = make()
    const reader = input.readLine()
    const task = input.nextTaskLine()
    input.close()
    expect(await reader).toBeNull()
    expect(await task).toBeNull()
  })

  it('keeps routing to readers after EOF has settled prior waiters (closed guard)', async () => {
    const { stdin, input } = make()
    stdin.end()
    expect(await input.nextTaskLine()).toBeNull()
    expect(await input.readLine()).toBeNull()
  })
})

describe('registerApprovalAnswerer (integration with TuiStore)', () => {
  /** Minimal ctx stub capturing the approval/request listener. */
  function captureListener(): {
    ctx: Context
    /** The captured handler; call AFTER registerApprovalAnswerer. */
    getHandler: () => (req: ApprovalRequest, next: () => Promise<ApprovalOutcome>) => Promise<ApprovalOutcome>
  } {
    let handler: ((req: ApprovalRequest, next: () => Promise<ApprovalOutcome>) => Promise<ApprovalOutcome>) | undefined
    const ctx = {
      on: (event: string, h: unknown) => {
        expect(event).toBe('approval/request')
        handler = h as typeof handler
        return () => {}
      },
    } as unknown as Context
    return { ctx, getHandler: () => handler! }
  }

  const req = { toolName: 'bash', callId: CallId('call_1'), reason: 'run echo', signal: undefined } as unknown as ApprovalRequest

  it('resolves allowed-once when the store answer is y', async () => {
    const store = createTuiStore()
    const { ctx, getHandler } = captureListener()
    const dispose = registerApprovalAnswerer(ctx, { store })
    const outcome = getHandler()(req, () => Promise.resolve('unavailable'))
    // The answerer pushed a pending question into the store; resolve it.
    expect(store.pendingQuestion()).toBeDefined()
    store.resolveAnswer('y')
    expect(await outcome).toBe('allowed-once')
    // Resolving clears the pending question so the REPL task path is unblocked.
    expect(store.pendingQuestion()).toBeUndefined()
    dispose()
  })

  it('rejects on n', async () => {
    const store = createTuiStore()
    const { ctx, getHandler } = captureListener()
    const dispose = registerApprovalAnswerer(ctx, { store })
    const rejected = getHandler()(req, () => Promise.resolve('unavailable'))
    store.resolveAnswer('n')
    expect(await rejected).toBe('rejected')
    dispose()
  })
})
