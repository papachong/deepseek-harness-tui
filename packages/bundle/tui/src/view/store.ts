/**
 * Solid reactive store consuming {@link TransportEvent}: the non-JSX reactive
 * spine of the OpenTUI view layer. Mirrors opencode's SDK flush pattern (the
 * upstream TUI's context/sdk module): queue events on `push`, `batch()`-emit
 * within 16ms windows so one burst of session events produces a single render.
 * The store is created under the Bun runtime at process start (the bin
 * entrypoint runs under Bun), so `Date.now()` and `setTimeout` are available —
 * the workflow script that orchestrates the build cannot use them, but this
 * module never runs under that script.
 *
 * @module @deepseek-ai/dsh-tui/view/store
 */

import { batch, createSignal } from 'solid-js'
import { createStore, produce, type SetStoreFunction } from 'solid-js/store'
import type { CallId } from '@deepseek-ai/dsh-llm'
import type {
  SessionEventMap,
  TodoItem,
} from '@deepseek-ai/dsh-session'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools/presentation'
import type { TransportEvent } from '../transport/event-source.js'

/**
 * The pending/completed state of one tool invocation in the transcript.
 */
export interface ToolEntry {
  /** Correlates the call with its result; stable within one step. */
  callId: CallId
  /** The tool's model-facing name. */
  name: string
  /** The turn the call was made in. */
  turn: number
  /** The step within the turn. */
  step: number
  /** Raw arguments JSON string exactly as the model produced it (unparsed). */
  arguments: string
  /** Call-time render intent, when the host computed one via `presentCall`. Absent for v1 (the store has no tool registry). */
  callView?: ToolCallView
  /** Result-time render intent, when the host computed one via `presentResult`. Absent for v1 (the store has no tool registry). */
  resultView?: ToolResultView
  /** Raw text fallback: the `tool/result` text blocks joined. Absent until the result lands. */
  resultText?: string
  /** Whether the tool reported an error. Absent until the result lands. */
  isError?: boolean
  /** Lifecycle state: `pending` on `tool/call`, `completed` on `tool/result`. */
  state: 'pending' | 'completed'
}

/**
 * One assistant message in the transcript, accumulated from streaming chunks.
 */
export interface MessageEntry {
  /** `${turn}:${step}` — the stable identity for one assistant step. */
  id: string
  /** The turn the message belongs to. */
  turn: number
  /** The step within the turn. */
  step: number
  /** Accumulated `text-delta` text (streaming append). */
  text: string
  /** Accumulated `reasoning-delta` text, when the adapter emitted reasoning. */
  reasoning?: string
  /** True while the step is still streaming; false after `assistant/message`. */
  streaming: boolean
  /** Token accounting, set when `assistant/message` carries `usage`. */
  usage?: { inputTokens: number; outputTokens: number }
  /** True when the step was cancelled mid-stream (set by `assistant/message`). */
  interrupted?: boolean
}

/**
 * Reactive view-model surface the OpenTUI components read. All fields are
 * reactive signals or stores; reads inside a Solid tracking scope subscribe.
 */
export interface TuiStore {
  /** Ordered assistant messages, one per `(turn, step)`. */
  readonly messages: readonly MessageEntry[]
  /** Ordered tool calls, one per `callId`. */
  readonly tools: readonly ToolEntry[]
  /** Latest `todo/write` snapshot (whole-list replace). */
  readonly todos: readonly TodoItem[]
  /** Latest `plan/mode` flag (true = plan mode active). Plan markdown is not carried by this event. */
  readonly planActive: boolean
  /** Latest agent status string (e.g. `idle`, `running`). */
  readonly status: string
  /**
   * The underlying Solid `createStore` proxy. Components that need
   * fine-grained reactivity (e.g. `<For each={store.state.messages}>`) read
   * the proxy directly so Solid tracks the deep property access. The
   * getter-based accessors above return the same proxy, but Solid does not
   * re-invoke a plain getter when the underlying store mutates, so `<For>`
   * must read `store.state.messages` (the proxy) in a tracking scope.
   */
  readonly state: StoreState
  /**
   * Queue a transport event for batched application. Events are applied within
   * a 16ms coalescing window so a burst of chunks produces one render.
   * @param event - the normalized transport event to apply.
   * @returns void; the store updates asynchronously after the flush.
   */
  push(event: TransportEvent): void
  /**
   * Set the agent status (from the separate `agent/status` firehose, which is
   * NOT a session event and so cannot flow through `push`).
   * @param status - the new status string.
   * @returns void; updates the status signal synchronously.
   */
  setStatus(status: string): void
  /**
   * Push a pending question into the store and await its answer. The `<Prompt>`
   * component routes a submitted line to resolve the returned promise when a
   * question is pending. This is the v1 answer to the OpenTUI raw-mode vs
   * readline conflict: the answerers call this instead of `readLine()`.
   * @param question - the question text to render as a transcript message.
   * @returns a promise resolving to the user's submitted answer.
   */
  awaitAnswer(question: string): Promise<string>
  /**
   * Read the pending question text, or undefined when the `<Prompt>` is in REPL
   * task mode. Used by `<Prompt>` to switch between answer and task routing.
   * @returns the pending question text, or undefined when none is pending.
   */
  pendingQuestion(): string | undefined
  /**
   * Resolve the pending question with the submitted answer. Called by `<Prompt>`
   * when a pending question exists. No-op (and returns false) when none is
   * pending, so `<Prompt>` can route: answer first, else REPL task.
   * @param answer - the submitted line.
   * @returns true when an answer was routed, false when no question was pending.
   */
  resolveAnswer(answer: string): boolean
}

/**
 * The mutable store state held under one Solid `createStore` proxy.
 */
export interface StoreState {
  messages: MessageEntry[]
  tools: ToolEntry[]
  todos: TodoItem[]
  planActive: boolean
  status: string
}

/**
 * The flush window in milliseconds. A burst of events within this window after
 * the last flush is coalesced into one `batch()` so Solid renders once.
 */
const FLUSH_WINDOW_MS = 16

/**
 * Create a reactive TUI store. The store queues incoming transport events and
 * applies them in a `batch()` within a 16ms coalescing window, mirroring
 * opencode's `sdk.tsx` flush pattern. Status updates and pending-answer
 * routing bypass the queue (status is synchronous; answers resolve promises).
 * @returns a {@link TuiStore} with reactive reads and `push`/`setStatus`/`awaitAnswer` write paths.
 */
export function createTuiStore(): TuiStore {
  const [state, setState] = createStore<StoreState>({
    messages: [],
    tools: [],
    todos: [],
    planActive: false,
    status: 'idle',
  })

  let queue: TransportEvent[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastFlush = 0

  const [pendingQuestion, setPendingQuestion] = createSignal<string | undefined>(undefined)
  let pendingResolver: ((answer: string) => void) | undefined

  const flush = (): void => {
    if (queue.length === 0) return
    const events = queue
    queue = []
    timer = undefined
    lastFlush = Date.now()
    batch(() => {
      for (const event of events) {
        applyEvent(state, setState, event)
      }
    })
  }

  const scheduleFlush = (): void => {
    if (timer !== undefined) return
    const elapsed = Date.now() - lastFlush
    if (elapsed < FLUSH_WINDOW_MS) {
      timer = setTimeout(flush, FLUSH_WINDOW_MS)
      return
    }
    flush()
  }

  const push = (event: TransportEvent): void => {
    if (event.event === undefined) return
    queue.push(event)
    scheduleFlush()
  }

  const setStatus = (status: string): void => {
    setState('status', status)
  }

  const awaitAnswer = (question: string): Promise<string> => {
    setPendingQuestion(question)
    return new Promise<string>((resolve) => {
      pendingResolver = resolve
    })
  }

  const resolveAnswer = (answer: string): boolean => {
    const resolver = pendingResolver
    if (resolver === undefined) return false
    pendingResolver = undefined
    setPendingQuestion(undefined)
    resolver(answer)
    return true
  }

  return {
    get messages(): readonly MessageEntry[] { return state.messages },
    get tools(): readonly ToolEntry[] { return state.tools },
    get todos(): readonly TodoItem[] { return state.todos },
    get planActive(): boolean { return state.planActive },
    get status(): string { return state.status },
    /**
     * The Solid store proxy. Components that need fine-grained reactivity
     * (e.g. `<For each={store.state.messages}>`) read the proxy directly so
     * Solid tracks the deep property access. The getter-based accessors above
     * return the same proxy but Solid does not re-invoke a plain getter when
     * the underlying store mutates, so the `<For>` never re-ran after the
     * initial empty read. Exposing `state` lets components read the proxy in
     * a tracking scope.
     */
    state,
    push,
    setStatus,
    awaitAnswer,
    pendingQuestion,
    resolveAnswer,
  }
}

/**
 * Apply one session event to the store state. Switches on the
 * {@link SessionEventMap} discriminant `event.type`. Unknown types are ignored.
 * @param state - the current store state (mutated in place by `setState`).
 * @param setState - the Solid store setter.
 * @param event - the session event to apply.
 * @returns void; mutates `state` via `setState`.
 */
function applyEvent(
  state: StoreState,
  setState: SetStoreFunction<StoreState>,
  transport: TransportEvent,
): void {
  const event = transport.event
  if (event === undefined) return
  // plan/mode is a plugin-merged SessionEventMap extension declared by
  // dsh-plan-mode, not a member of the base map the store imports. Handle it
  // before the switch so the discriminant narrowing does not collapse to never.
  if ((event as { type: string }).type === 'plan/mode') {
    const data = (event as { data: { active: boolean } }).data
    setState('planActive', data.active)
    return
  }
  switch (event.type) {
    case 'assistant/chunk': {
      const { turn, step, chunk } = event.data
      const id = `${turn}:${step}`
      const idx = state.messages.findIndex(m => m.id === id)
      if (idx === -1) {
        const entry: MessageEntry = {
          id, turn, step, text: '', streaming: true,
        }
        setState('messages', state.messages.length, entry)
        applyChunk(setState, state.messages.length - 1, chunk)
      } else {
        setState('messages', idx, 'streaming', true)
        applyChunk(setState, idx, chunk)
      }
      break
    }
    case 'tool/call': {
      const { turn, step, callId, name, arguments: raw } = event.data
      const idx = state.tools.findIndex(t => t.callId === callId)
      const entry: ToolEntry = {
        callId, name, turn, step, arguments: raw, state: 'pending',
      }
      if (idx === -1) {
        setState('tools', state.tools.length, entry)
      } else {
        setState('tools', idx, entry)
      }
      break
    }
    case 'tool/result': {
      const { turn, step, message } = event.data
      const [block] = message.content
      const resultText = block.content
        .filter(b => b.type === 'text')
        .map(b => (b.type === 'text' ? b.text : ''))
        .join('')
      const isError = block.isError === true
      const idx = state.tools.findIndex(t => t.turn === turn && t.step === step)
      if (idx !== -1) {
        setState('tools', idx, 'state', 'completed')
        setState('tools', idx, 'resultText', resultText)
        setState('tools', idx, 'isError', isError)
      }
      break
    }
    case 'assistant/message': {
      const { turn, step, usage, interrupted } = event.data
      const id = `${turn}:${step}`
      const idx = state.messages.findIndex(m => m.id === id)
      if (idx !== -1) {
        setState('messages', idx, 'streaming', false)
        if (usage !== undefined) {
          setState('messages', idx, 'usage', { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens })
        }
        if (interrupted === true) {
          setState('messages', idx, 'interrupted', true)
        }
      }
      break
    }
    case 'todo/write': {
      setState('todos', produce((todos: TodoItem[]) => {
        todos.length = 0
        for (const todo of event.data.todos) todos.push({ ...todo })
      }))
      break
    }
    case 'turn/end': {
      break
    }
    default:
      break
  }
}

/**
 * Apply one streaming chunk to an existing message entry.
 * @param setState - the Solid store setter.
 * @param idx - the message index in `state.messages`.
 * @param chunk - the streaming chunk to apply.
 * @returns void; mutates the message at `idx` via `setState`.
 */
function applyChunk(
  setState: SetStoreFunction<StoreState>,
  idx: number,
  chunk: SessionEventMap['assistant/chunk']['chunk'],
): void {
  if (chunk.type === 'text-delta') {
    setState('messages', idx, 'text', (prev: string) => prev + chunk.text)
  } else if (chunk.type === 'reasoning-delta') {
    setState('messages', idx, 'reasoning', (prev: string | undefined) => (prev ?? '') + chunk.text)
  }
}
