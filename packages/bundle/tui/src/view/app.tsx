/**
 * The `<App>` root: the top-level component for the OpenTUI view layer. Reads
 * the reactive {@link TuiStore} signals and renders a status bar, the merged
 * transcript (messages + tool cards interleaved by session seq), the todo/plan
 * projections when non-empty, and the `<Prompt>` at the bottom.
 *
 * The transcript is a `<scrollbox stickyScroll stickyStart="bottom">` so the
 * view tracks the latest content as it streams. Messages and tools are merged
 * into one chronological list by their originating event `seq` so user prompts,
 * assistant chunks, and tool calls interleave in true time order — not two
 * separate `<For>` blocks stacked end-to-end.
 *
 * @module @deepseek-ai/dsh-tui/view/app
 */

import { type JSX, useKeyboard } from '@opentui/solid'
import { For, createMemo, createSignal } from 'solid-js'
import { CHROME } from './theme.js'
import type { TuiStore, MessageEntry, ToolEntry } from './store.js'
import { Message } from './components/message.js'
import { ToolCard } from './components/tool-card.js'
import { Plan, Todos } from './components/projections.js'
import { Prompt } from './components/prompt.js'
import { StatusBar } from './components/status-bar.js'
import { Sidebar } from './components/sidebar.js'
import { CommandPalette } from './components/command-palette.js'
import { Home } from './components/home.js'
import { workMode } from './modes.js'
import type { CommandEntry } from './components/command-palette.js'
import type { MentionEntry } from './components/mention-menu.js'

/** One merged transcript item: either a message or a tool card. */
type TranscriptItem =
  | { kind: 'message'; entry: MessageEntry; seq: number }
  | { kind: 'tool'; entry: ToolEntry; seq: number }

/** Props for {@link App}. */
export interface AppProps {
  /** The reactive store the components read. */
  store: TuiStore
  /** Fired when the user submits a task line (no pending question). */
  onSubmit: (text: string) => void
  /** The current session id, or an accessor for it (sidebar highlight). */
  currentSessionId: string | (() => string)
  /** Available commands for the command palette (populated by runner). */
  commands: readonly CommandEntry[]
  /** Fired when the user cycles the work mode with Tab (runner rebuilds agent). */
  onCycleMode?: () => void
  /** Fired when the user selects a sidebar session row (Enter). */
  onSelectSession?: (id: string) => void
  /** Resolves @-mention candidates (files + sessions) for the prompt menu. */
  resolveMentions?: (query: string) => Promise<readonly MentionEntry[]>
}

/**
 * Merge messages and tools into one seq-ordered transcript. Both lists carry
 * the originating session `seq`; sorting by it yields true chronological order
 * (user prompt → assistant chunk → tool call → tool result → …).
 * @param messages - the store's message entries.
 * @param tools - the store's tool entries.
 * @returns the merged, seq-sorted transcript items.
 */
function mergeTranscript(
  messages: readonly MessageEntry[],
  tools: readonly ToolEntry[],
): readonly TranscriptItem[] {
  const items: TranscriptItem[] = []
  for (const entry of messages) items.push({ kind: 'message', entry, seq: entry.seq })
  for (const entry of tools) items.push({ kind: 'tool', entry, seq: entry.seq })
  items.sort((a, b) => a.seq - b.seq)
  return items
}

/**
 * Render the app root: status bar + transcript scrollbox + projections + prompt.
 * The transcript merges messages and tools by session seq so they interleave in
 * chronological order; each item dispatches to `<Message>` or `<ToolCard>`.
 *
 * The todos/plan projections use memo-conditionals (not `<Show>`) because the
 * OpenTUI Solid reconciler emits a stray empty text node for `<Show>`'s falsy
 * branch that orphans under the non-text `<scrollbox>` parent.
 * @param props - the app props.
 * @returns the JSX element for the app root.
 */
export function App(props: AppProps): JSX.Element {
  const transcript = createMemo(() =>
    mergeTranscript(props.store.state.messages, props.store.state.tools),
  )
  const todosBlock = createMemo(() => <Todos todos={props.store.state.todos} />)
  const [paletteOpen, setPaletteOpen] = createSignal(false)
  // Sidebar↔prompt focus toggle: OpenTUI has no focusManager, so the app owns
  // the region via a signal. Ctrl-S flips it; the sidebar and prompt each
  // read the signal to focus/blur their element.
  const [sidebarFocused, setSidebarFocused] = createSignal(false)
  const shouldFocusPrompt = createMemo(() => !sidebarFocused())
  // Global keybind: Ctrl-S toggles focus between the prompt and the sidebar
  // (OpenTUI has no focusManager, so the app owns the region toggle). The
  // sidebar reads `sidebarFocused` to focus/blur; the prompt reads
  // `shouldFocusPrompt` (its inverse). The key is caught globally so it
  // works regardless of which region currently holds focus.
  useKeyboard((key) => {
    if (key.ctrl && key.name === 's') {
      setSidebarFocused(prev => !prev)
    }
  })
  const page = createMemo(() => props.store.state.page)
  const sessionId = createMemo(() =>
    typeof props.currentSessionId === 'function' ? props.currentSessionId() : props.currentSessionId,
  )
  const modeName = createMemo(() => workMode(props.store.state.mode)?.name ?? props.store.state.mode)
  // Home page: centered banner + hero prompt. The first submission flips the
  // store page to 'chat' in the runner's onSubmit, which swaps this branch out.
  // Rendered as a memo read inside the returned JSX (NOT an early return) so
  // Solid tracks the `page()` dependency and swaps layouts reactively.
  const layout = createMemo<JSX.Element>(() => {
    if (page() === 'home') {
      return (
        <Home
          store={props.store}
          onSubmit={props.onSubmit}
          {...props.onCycleMode === undefined ? {} : { onCycleMode: props.onCycleMode }}
          {...props.commands === undefined ? {} : { commands: props.commands }}
          {...props.resolveMentions === undefined ? {} : { resolveMentions: props.resolveMentions }}
        />
      )
    }
    // Chat layout: status bar + transcript + sidebar + prompt + bottom info area.
    return (
      <box flexDirection="column" height="100%">
        <StatusBar store={props.store} />
        <box flexDirection="row" flexGrow={1} minHeight={3}>
          <box flexGrow={1}>
            <scrollbox stickyScroll stickyStart="bottom">
              <For each={transcript()}>
                {(item: TranscriptItem) =>
                  item.kind === 'message'
                    ? <Message entry={item.entry} />
                    : <ToolCard tool={item.entry} />
                }
              </For>
              {todosBlock()}
              <Plan active={props.store.state.planActive} />
            </scrollbox>
          </box>
          <Sidebar
            store={props.store}
            currentSessionId={sessionId()}
            focused={sidebarFocused}
            onBlur={() => setSidebarFocused(false)}
            {...props.onSelectSession === undefined ? {} : { onSelectSession: props.onSelectSession }}
          />
        </box>
        <Prompt
          store={props.store}
          onSubmit={props.onSubmit}
          onOpenPalette={() => setPaletteOpen(true)}
          shouldFocus={shouldFocusPrompt}
          commands={props.commands}
          {...props.resolveMentions === undefined ? {} : { resolveMentions: props.resolveMentions }}
        />
        <box border={['top']} borderStyle="single" borderColor={CHROME.border} paddingLeft={1} paddingRight={1} flexDirection="column">
          <text fg={CHROME.textMuted}> mode: {modeName()} · session: {sessionId()} </text>
          <text fg={CHROME.textMuted}> Tab cycle mode · Ctrl+S sessions · Ctrl+P palette </text>
        </box>
        <CommandPalette
          open={paletteOpen()}
          onClose={() => setPaletteOpen(false)}
          commands={props.commands}
        />
      </box>
    )
  })
  return layout()
}

/**
 * Build the root factory the renderer mounts. The runner (a non-JSX, tsdown-
 * bundled module) cannot write JSX itself, so this factory closes over the
 * store and the submit handler and returns the `() => JSX.Element` the
 * `@opentui/solid` `render` expects. The runner imports this via a dynamic
 * `await import('./view/app.js')` so tsdown leaves the reference unresolved
 * and Bun.build (which produces `lib/view/app.js`) supplies it at runtime.
 * @param store - the reactive store the components read.
 * @param onSubmit - fired when the user submits a task line.
 * @returns a root factory returning the app JSX element.
 */
export function createAppRoot(
  store: TuiStore,
  onSubmit: (text: string) => void,
  currentSessionId: string | (() => string),
  commands: readonly CommandEntry[],
  onCycleMode?: () => void,
  onSelectSession?: (id: string) => void,
  resolveMentions?: (query: string) => Promise<readonly MentionEntry[]>,
): () => JSX.Element {
  return () => (
    <App
      store={store}
      onSubmit={onSubmit}
      currentSessionId={currentSessionId}
      commands={commands}
      {...onCycleMode === undefined ? {} : { onCycleMode }}
      {...onSelectSession === undefined ? {} : { onSelectSession }}
      {...resolveMentions === undefined ? {} : { resolveMentions }}
    />
  )
}
