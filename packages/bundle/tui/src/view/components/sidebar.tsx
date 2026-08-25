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
import { For, createMemo, createSignal } from 'solid-js'
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
  /** Fired when the user selects a session row (Enter). */
  onSelectSession?: (id: string) => void
  /** True when the sidebar holds focus (app toggles via global keybind). */
  focused?: () => boolean
  /** Fired when the sidebar yields focus back to the prompt (Esc). */
  onBlur?: () => void
  /**
   * The app-level key handler for the sidebar's ↑/↓/Enter. The sidebar's own
   * onKeyDown never fires because the focused prompt textarea preventDefaults
   * its keys before they reach the sidebar container. The app's global
   * useKeyboard dispatches to this handler when the sidebar is focused.
   */
  keyHandlerRef?: { current: ((key: 'up' | 'down' | 'enter' | 'escape') => void) | undefined }
}

/**
 * Render the sidebar: a header (cwd/model) + session list. When the terminal
 * is narrow (≤120 cols) the sidebar is an absolute overlay with a translucent
 * background; when wide it sits inline as a fixed-width column. When focused,
 * the container is `focusable` and `↑`/`↓` move the selection, `Enter`
 * selects, `Esc` returns focus to the prompt.
 * @param props - the sidebar props.
 * @returns the JSX element for the sidebar, or undefined when there are no sessions.
 */
export function Sidebar(props: SidebarProps): JSX.Element {
  const dims = useTerminalDimensions()
  const inline = createMemo(() => (dims().width > INLINE_THRESHOLD))
  const list = createMemo(() => props.store.sessions())
  const [selected, setSelected] = createSignal(0)
  const isFocused = createMemo(() => props.focused?.() === true)

  const move = (delta: number): void => {
    const len = list().length
    if (len === 0) return
    setSelected((prev) => {
      const next = prev + delta
      if (next < 0) return 0
      if (next >= len) return len - 1
      return next
    })
  }

  const onKey = (key: { name: string }): void => {
    if (!isFocused()) return
    if (key.name === 'up') { move(-1); return }
    if (key.name === 'down') { move(1); return }
    if (key.name === 'return' || key.name === 'enter') {
      const item = list()[selected()]
      if (item !== undefined) props.onSelectSession?.(item.id)
      return
    }
    if (key.name === 'escape') { props.onBlur?.(); return }
  }

  // The sidebar's own onKeyDown never fires: the focused prompt textarea
  // preventDefaults its keys, and OpenTUI's key dispatch is capture-phase-first
  // for the focused element only (not parent boxes). The app's global
  // useKeyboard dispatches to `keyHandlerRef` when the sidebar is focused.
  // The sidebar registers its handler on mount.
  if (props.keyHandlerRef !== undefined) {
    props.keyHandlerRef.current = (key) => {
      if (key === 'up') move(-1)
      else if (key === 'down') move(1)
      else if (key === 'enter') {
        const item = list()[selected()]
        if (item !== undefined) props.onSelectSession?.(item.id)
      }
    }
  }

  // Attach the key handler to the sidebar's box directly. OpenTUI's
  // `useKeyboard` fires for every key event regardless of focus; the
  // `focusable` + `focused` props on the box make it the active key target
  // when the app toggles `sidebarFocused` to true.
  const container = createMemo<JSX.Element>(() => {
    const style = inline()
      ? { width: SIDEBAR_WIDTH, flexShrink: 0 }
      : { position: 'absolute' as const, right: 0, top: 0, bottom: 0, width: SIDEBAR_WIDTH, zIndex: 100 }
    return (
      <box
        border={['left']}
        borderStyle="single"
        borderColor={isFocused() ? CHROME.borderActive : CHROME.border}
        backgroundColor={CHROME.bgPanel}
        {...style}
        paddingLeft={1}
        paddingRight={1}
        flexDirection="column"
        focusable
        focused={isFocused()}
        focusedBorderColor={CHROME.borderActive}
        // The container's onKeyDown catches keys BEFORE they reach the focused
        // child (the textarea in the prompt). OpenTUI's key dispatch is
        // capture-phase-first for parent boxes, so the sidebar's ↑/↓/Enter
        // handlers fire even when the prompt textarea is the focused element.
        onKeyDown={onKey}
      >
        <box flexDirection="row">
          <text fg={CHROME.textMuted}>sessions</text>
          <box flexGrow={1} />
          <text fg={CHROME.textMuted}>{list().length}</text>
        </box>
        <For each={list()}>
          {(item, index) => {
            const active = item.id === props.currentSessionId
            const isSelected = createMemo(() => index() === selected() && isFocused())
            const dotColor = item.live ? STATUS_COLORS.completed : CHROME.textMuted
            return (
              <box flexDirection="row">
                <text fg={dotColor}>{isSelected() ? '▸' : active ? '▸' : ' '} </text>
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
