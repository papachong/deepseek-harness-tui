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
import type { CallId, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type {
  SessionEventMap,
  TodoItem,
} from '@deepseek-ai/dsh-session'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools/presentation'
import type { TransportEvent } from '../transport/event-source.js'
import type { WorkMode } from './modes.js'

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
  /** Monotonic session seq of the originating `tool/call` event; orders the merged transcript. */
  seq: number
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
 * One message in the transcript, accumulated from streaming chunks (assistant)
 * or projected from a `user/message` event (user). The `role` discriminant
 * drives the left-border color and prefix glyph in `<Message>`.
 */
export interface MessageEntry {
  /** `${turn}:${step}` for assistant steps; `user:${seq}` for user messages — stable identity. */
  id: string
  /** `user` for human prompts; `assistant` for model output. Drives rendering. */
  role: 'user' | 'assistant'
  /** The turn the message belongs to (0 for pre-turn user messages, if any). */
  turn: number
  /** The step within the turn (0 for user messages, which are not step-scoped). */
  step: number
  /** Monotonic session seq of the originating event; orders the merged transcript. */
  seq: number
  /** Accumulated `text-delta` text (assistant) or joined text blocks (user). */
  text: string
  /** Accumulated `reasoning-delta` text, when the adapter emitted reasoning. */
  reasoning?: string
  /** True while the step is still streaming; false after `assistant/message`. */
  streaming: boolean
  /** Token accounting, set when `assistant/message` carries `usage`. */
  usage?: TokenUsage
  /** True when the step was cancelled mid-stream (set by `assistant/message`). */
  interrupted?: boolean
  /** Wall-clock start time (epoch ms) of the first chunk; for duration display. */
  startedAt?: number
  /** Wall-clock end time (epoch ms) of the step (`assistant/message` event time). */
  finishedAt?: number
}

/**
 * One sidebar session row: title + liveness + id.
 */
export interface SessionListItem {
  /** The session id. */
  id: string
  /** Display title (folded from events or a fallback). */
  title: string
  /** True when the session is live (in-process attached). */
  live: boolean
  /** Epoch ms of last activity (createdAt or latest event time). */
  updatedAt: number
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
  /** Current model selection (provider + model), for the status bar and command palette. */
  readonly model: () => ModelSelection
  /** Session list for the sidebar (live + cold, updated on refresh). */
  readonly sessions: () => readonly SessionListItem[]
  /** The active surface page: `home` (centered hero) or `chat`. */
  readonly page: () => 'home' | 'chat'
  /** The active work mode (preset id) for the status bar and Tab cycling. */
  readonly mode: () => WorkMode
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
   * Set the current model selection (from a command-palette swap).
   * @param model - the new provider+model selection.
   * @returns void; updates the model signal synchronously.
   */
  setModel(model: ModelSelection): void
  /**
   * Replace the sidebar session list (from a sidebar/command-palette refresh).
   * @param sessions - the session list items.
   * @returns void; updates the sessions signal synchronously.
   */
  setSessions(sessions: readonly SessionListItem[]): void
  /**
   * Set the active surface page. Called by the runner on the first submission
   * to flip from the centered home hero to the chat layout.
   * @param page - the page to switch to.
   * @returns void; updates the page signal synchronously.
   */
  setPage(page: 'home' | 'chat'): void
  /**
   * Set the active work mode (preset id). Called by the runner on `/mode` or
   * by the view on Tab. The runner owns the agent rebuild; the store only
   * carries the display value.
   * @param mode - the work mode id.
   * @returns void; updates the mode signal synchronously.
   */
  setMode(mode: WorkMode): void
  /**
   * Reset the transcript for a session switch. Clears messages, tools, todos,
   * and plan state but keeps the page (chat) and mode so the surface stays
   * continuous. Called by the runner's `onSelectSession`.
   * @returns void; mutates state synchronously.
   */
  reset(): void
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
  /** Which surface page is active: `home` before the first submission, `chat` after. */
  page: 'home' | 'chat'
  /** The active work mode (preset id); Tab cycles it. `standard` is the default. */
  mode: WorkMode
}

/**
 * The flush window in milliseconds. A burst of events within this window after
 * the last flush is coalesced into one `batch()` so Solid renders once.
 */
const FLUSH_WINDOW_MS = 16

/**
 * Create a reactive TUI store. The store queues incoming transport events and
 * applies them in a `batch()` within a 16ms coalescing window, mirroring
 * opencode's `sdk.tsx` flush pattern. Status, model, and session-list updates
 * bypass the queue (synchronous); answers resolve promises.
 * @returns a {@link TuiStore} with reactive reads and `push`/`setStatus`/`setModel`/`setSessions`/`awaitAnswer` write paths.
 */
export function createTuiStore(): TuiStore {
  const [state, setState] = createStore<StoreState>({
    messages: [],
    tools: [],
    todos: [],
    planActive: false,
    status: 'idle',
    page: 'home',
    mode: 'standard',
  })

  let queue: TransportEvent[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastFlush = 0

  const [pendingQuestion, setPendingQuestion] = createSignal<string | undefined>(undefined)
  let pendingResolver: ((answer: string) => void) | undefined
  const [model, setModel] = createSignal<ModelSelection>({ provider: '', model: '' })
  const [sessions, setSessions] = createSignal<SessionListItem[]>([])
  const [page, setPage] = createSignal<'home' | 'chat'>('home')
  const [mode, setMode] = createSignal<WorkMode>('standard')

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

  const reset = (): void => {
    setState(produce((s: StoreState) => {
      s.messages.length = 0
      s.tools.length = 0
      s.todos.length = 0
      s.planActive = false
      s.status = 'idle'
    }))
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
    model: () => model(),
    sessions: () => sessions(),
    page: () => page(),
    mode: () => mode(),
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
    setModel,
    setSessions,
    setPage,
    setMode,
    reset,
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
    case 'user/message': {
      const message = event.data
      const seq = event.seq
      // One user/message event may carry a batch of messages, but each event
      // is one Message; the loop fires one event per claimed message. Project
      // the text blocks into one transcript entry.
      const text = message.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map(b => b.text)
        .join('')
      // Skip entries with no visible text (e.g. pure tool-result user turns);
      // their tool result renders as a ToolCard via tool/result.
      if (text === '') break
      setState('messages', state.messages.length, {
        id: `user:${seq}`,
        role: 'user',
        turn: 0,
        step: 0,
        seq,
        text,
        streaming: false,
      })
      break
    }
    case 'assistant/chunk': {
      const { turn, step, chunk } = event.data
      const seq = event.seq
      const id = `${turn}:${step}`
      const idx = state.messages.findIndex(m => m.id === id)
      if (idx === -1) {
        const entry: MessageEntry = {
          id, role: 'assistant', turn, step, seq, text: '', streaming: true,
          startedAt: event.time,
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
      const seq = event.seq
      const idx = state.tools.findIndex(t => t.callId === callId)
      // The runner's viewFor may have attached a host-computed callView via
      // transport.view (presentCall result); carry it onto the entry.
      const callView = transport.view !== undefined && transport.view.for === 'call'
        ? transport.view.view
        : undefined
      const entry: ToolEntry = {
        callId, name, turn, step, seq, arguments: raw, state: 'pending',
        ...callView === undefined ? {} : { callView },
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
      const callId = block.toolCallId
      const resultText = block.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map(b => b.text)
        .join('')
      const isError = block.isError === true
      // The runner's viewFor may have attached a host-computed resultView via
      // transport.view (presentResult result); carry it onto the entry.
      const resultView = transport.view !== undefined && transport.view.for === 'result'
        ? transport.view.view
        : undefined
      // Correlate by callId (stable per call), not turn+step (ambiguous when
      // one step makes several tool calls).
      const idx = state.tools.findIndex(t => t.callId === callId)
      if (idx !== -1) {
        setState('tools', idx, 'state', 'completed')
        setState('tools', idx, 'resultText', resultText)
        setState('tools', idx, 'isError', isError)
        if (resultView !== undefined) setState('tools', idx, 'resultView', resultView)
      } else {
        // Result without a preceding tool/call (e.g. replay starting mid-step):
        // synthesize a completed entry so the card still renders.
        setState('tools', state.tools.length, {
          callId, name: '', turn, step, seq: event.seq,
          arguments: '', state: 'completed', resultText, isError,
          ...resultView === undefined ? {} : { resultView },
        })
      }
      break
    }
    case 'assistant/message': {
      const { turn, step, usage, interrupted } = event.data
      const id = `${turn}:${step}`
      const idx = state.messages.findIndex(m => m.id === id)
      if (idx !== -1) {
        setState('messages', idx, 'streaming', false)
        setState('messages', idx, 'finishedAt', event.time)
        if (usage !== undefined) {
          // Preserve the full TokenUsage (cacheRead/Write + reasoning), not
          // just input/output — the status bar shows cache hit ratio.
          setState('messages', idx, 'usage', usage)
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
