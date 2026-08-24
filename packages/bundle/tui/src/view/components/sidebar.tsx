/**
 * The `<Sidebar>` component: a session list + workspace state panel. Renders
 * inline (flex-row, fixed width) when the terminal is wide (>120 cols), or as
 * an absolute-positioned overlay when narrow. Mirrors opencode's session
 * sidebar: session title rows (live + cold), current session highlighted.
 *
 * The session list comes from the store's `sessions()` signal, populated by
 * the runner's `refreshSessions()` (which merges `sessions.list()` live +
 * `sessionPersistence.list()` cold, folding titles via `foldSessionTitle`).
 *
 * NOTE: uses memo-conditionals instead of `<Show>` — the OpenTUI Solid
 * reconciler emits a stray empty text node for `<Show>`'s falsy branch that
 * orphans under a non-text parent.
 *
 * @module @deepseek-ai/dsh-tui/view/components/sidebar
 */

import { type JSX } from '@opentui/solid'
import { For, createMemo } from 'solid-js'
import { useTerminalDimensions } from '@opentui/solid'
import { CHROME, ROLE_COLORS, STATUS_COLORS } from '../theme.js'
import type { TuiStore } from '../store.js'

/** The sidebar width in columns when inline. */
const SIDEBAR_WIDTH = 30
/** The column threshold above which the sidebar renders inline. */
const INLINE_THRESHOLD = 120

/** Props for {@link Sidebar}. */
export interface SidebarProps {
  /** The store exposing `sessions()` for the list + `model()` for the header. */
  store: TuiStore
  /** The current session id (to highlight the active row). */
  currentSessionId: string
}

/**
 * Render the sidebar: a header (cwd/model) + session list. When the terminal
 * is narrow (≤120 cols) the sidebar is an absolute overlay with a translucent
 * background; when wide it sits inline as a fixed-width column.
 * @param props - the sidebar props.
 * @returns the JSX element for the sidebar, or undefined when there are no sessions.
 */
export function Sidebar(props: SidebarProps): JSX.Element {
  const dims = useTerminalDimensions()
  const inline = createMemo(() => (dims().width > INLINE_THRESHOLD))
  const list = createMemo(() => props.store.sessions())

  const container = createMemo<JSX.Element>(() => {
    const style = inline()
      ? { width: SIDEBAR_WIDTH, flexShrink: 0 }
      : { position: 'absolute' as const, right: 0, top: 0, bottom: 0, width: SIDEBAR_WIDTH, zIndex: 100 }
    return (
      <box
        border={['left']}
        borderStyle="single"
        borderColor={CHROME.border}
        backgroundColor={CHROME.bgPanel}
        {...style}
        paddingLeft={1}
        paddingRight={1}
        flexDirection="column"
      >
        <box flexDirection="row">
          <text fg={CHROME.textMuted}>sessions</text>
          <box flexGrow={1} />
          <text fg={CHROME.textMuted}>{list().length}</text>
        </box>
        <For each={list()}>
          {(item) => {
            const active = item.id === props.currentSessionId
            const dotColor = item.live ? STATUS_COLORS.completed : CHROME.textMuted
            return (
              <box flexDirection="row">
                <text fg={dotColor}>{active ? '▸' : ' '} </text>
                <text fg={active ? ROLE_COLORS.assistant : CHROME.text}>{item.title || item.id}</text>
              </box>
            )
          }}
        </For>
      </box>
    )
  })

  return container()
}
