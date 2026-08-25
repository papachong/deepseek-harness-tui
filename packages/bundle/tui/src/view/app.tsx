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
import { Sidebar } from './components/sidebar.js'
import { CommandPalette } from './components/command-palette.js'
import { Home } from './components/home.js'
import { workMode } from './modes.js'
import { t } from './i18n.js'
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
  // Sidebar visibility + focus: opencode keeps the session sidebar hidden by
  // default and opens it on demand (`<leader>b`); dsh-tui uses Ctrl-S as the
  // single toggle. `sidebarOpen` controls rendering (hidden by default);
  // `sidebarFocused` tracks which region holds the keyboard. When the sidebar
  // opens it takes focus; Esc (handled in the sidebar) or a second Ctrl-S
  // closes it and hands focus back to the prompt.
  const [sidebarOpen, setSidebarOpen] = createSignal(false)
  const [sidebarFocused, setSidebarFocused] = createSignal(false)
  const shouldFocusPrompt = createMemo(() => !sidebarFocused())
  const toggleSidebar = (): void => {
    const next = !sidebarOpen()
    setSidebarOpen(next)
    setSidebarFocused(next)
  }
  useKeyboard((key) => {
    if (key.ctrl && key.name === 's') {
      toggleSidebar()
    }
  })
  // The sidebar's key handler is a mutable ref the Sidebar component
  // populates on mount. The app dispatches to it from the global
  // useKeyboard so arrow keys / Enter / Esc work even when the prompt
  // textarea (which preventDefaults its keys) still holds focus.
  const sidebarKeyHandler = { current: undefined as ((key: 'up' | 'down' | 'enter' | 'escape') => void) | undefined }
  useKeyboard((key) => {
    if (!sidebarFocused()) return
    if (key.name === 'up') { sidebarKeyHandler.current?.('up'); return }
    if (key.name === 'down') { sidebarKeyHandler.current?.('down'); return }
    if (key.name === 'return' || key.name === 'enter') { sidebarKeyHandler.current?.('enter'); return }
    if (key.name === 'escape') {
      setSidebarOpen(false)
      setSidebarFocused(false)
      return
    }
  })
  const page = createMemo(() => props.store.state.page)
  const sessionId = createMemo(() =>
    typeof props.currentSessionId === 'function' ? props.currentSessionId() : props.currentSessionId,
  )
  const modeName = createMemo(() => workMode(props.store.state.mode)?.name() ?? props.store.state.mode)
  const modelLabel = createMemo(() => {
    const m = props.store.model()
    return m.model === '' ? '' : m.model
  })
  const status = createMemo(() => props.store.state.status)
  // Home page: centered wordmark + hero prompt. The first submission flips the
  // store page to 'chat' in the runner's onSubmit, which swaps this branch out.
  // Rendered as a memo read inside the returned JSX (NOT an early return) so
  // Solid tracks the `page()` dependency and swaps layouts reactively.
  // Home page: centered wordmark + hero prompt. The first submission flips the
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
    // Chat layout (opencode session route): the transcript fills the frame
    // with horizontal padding; the prompt pins to the bottom; the footer bar
    // shows cwd + mode + status. The sidebar is hidden by default and opens
    // as an overlay via Ctrl-S (matching opencode's `<leader>b` toggle).
    // The prompt's own `flexDirection` is row so it grows horizontally with
    // the transcript column; the footer is `flexShrink: 0` so it never wraps.
    return (
      <box flexDirection="column" height="100%">
        <box flexDirection="row" flexGrow={1} minHeight={0}>
          <box flexGrow={1} minHeight={0} paddingBottom={1} paddingLeft={2} paddingRight={2}>
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
          {sidebarOpen()
            ? (
              <Sidebar
                store={props.store}
                currentSessionId={sessionId()}
                focused={sidebarFocused}
                onBlur={() => { setSidebarOpen(false); setSidebarFocused(false) }}
                keyHandlerRef={sidebarKeyHandler}
                {...props.onSelectSession === undefined ? {} : { onSelectSession: props.onSelectSession }}
              />
            )
            : undefined}
        </box>
        <Prompt
          store={props.store}
          onSubmit={props.onSubmit}
          onOpenPalette={() => setPaletteOpen(true)}
          shouldFocus={shouldFocusPrompt}
          commands={props.commands}
          {...props.onCycleMode === undefined ? {} : { onCycleMode: props.onCycleMode }}
          {...props.resolveMentions === undefined ? {} : { resolveMentions: props.resolveMentions }}
        />
        {/* Footer bar (opencode session footer): cwd left, status + mode +
            shortcuts right. `flexShrink: 0` on every cell so the row never
            collapses under a narrow terminal. */}
        <box width="100%" flexShrink={0} flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2}>
          <text fg={CHROME.textMuted} flexShrink={0}>{process.cwd()}</text>
          <box flexDirection="row" gap={2} flexShrink={0}>
            <text fg={CHROME.textMuted} flexShrink={0}>{status()}</text>
            <text fg={CHROME.textMuted} flexShrink={0}>{modeName()}</text>
            {modelLabel() === '' ? undefined : <text fg={CHROME.textMuted} flexShrink={0}>{modelLabel()}</text>}
            <text fg={CHROME.textMuted} flexShrink={0}>{t('chat.footer')}</text>
          </box>
        </box>
        <CommandPalette
          open={paletteOpen()}
          onClose={() => setPaletteOpen(false)}
          commands={props.commands}
        />
      </box>
    )
  })
  // App's returned JSX must swap with the layout branch reactively. A bare
  // `return layout()` reads the memo once at mount — outside a tracking scope
  // the read is one-shot, so the home branch would stick forever. Returning
  // `layout()` inside a JSX fragment makes the Solid JSX runtime insert the
  // memo's value as a reactive expression child, which re-renders on `page()`.
  return <>{layout()}</>
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
