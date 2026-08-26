/**
 * The `<StatusBar>` component: a header bar showing the product name, current
 * agent status, and token accounting. Sits at the top of the app root, above
 * the transcript scrollbox. Mirrors opencode's session footer (cwd + model +
 * status + counts) but reads the local store's `status` signal and the
 * session's cumulative token usage.
 *
 * NOTE: uses a memo-conditional instead of `<Show>` — the OpenTUI Solid
 * reconciler emits a stray empty text node for `<Show>`'s falsy branch that
 * orphans under a non-text parent.
 *
 * @module @ruhooai/dsh-tui/view/components/status-bar
 */

import { type JSX } from '@opentui/solid'
import { createMemo } from 'solid-js'
import { CHROME, STATUS_COLORS } from '../theme.js'
import { workMode } from '../modes.js'
import type { MessageEntry, TuiStore } from '../store.js'

/** Props for {@link StatusBar}. */
export interface StatusBarProps {
  /** The store exposing `status`, `messages`, `mode`, and `model` for display. */
  store: TuiStore
}

/**
 * Render the status bar: left = product name + work mode + status indicator;
 * right = cumulative token usage across all assistant messages. The status dot
 * is green when idle, yellow when running. The work mode name (localized via
 * `t()`, so it follows the active locale) sits beside the product so Tab
 * cycling is visible immediately.
 * @param props - the status-bar props.
 * @returns the JSX element for the status bar.
 */
export function StatusBar(props: StatusBarProps): JSX.Element {
  const status = createMemo(() => props.store.state.status)
  const isRunning = createMemo(() => status() === 'running')
  const dotColor = createMemo(() => isRunning() ? STATUS_COLORS.pending : STATUS_COLORS.completed)
  const modeName = createMemo(() => workMode(props.store.state.mode)?.name() ?? props.store.state.mode)
  const totals = createMemo(() => {
    let inputTokens = 0
    let outputTokens = 0
    for (const message of props.store.state.messages) {
      const usage = (message as MessageEntry).usage
      if (usage !== undefined) {
        inputTokens += usage.inputTokens
        outputTokens += usage.outputTokens
      }
    }
    return { inputTokens, outputTokens }
  })

  return (
    <box
      border={['bottom']}
      borderStyle="single"
      borderColor={CHROME.border}
      paddingLeft={1}
      paddingRight={1}
      flexDirection="row"
    >
      <box flexDirection="row">
        <text fg={dotColor()}>● </text>
        <text fg={CHROME.text}><b>dsh</b></text>
        <text fg={CHROME.textMuted}> · {modeName()}</text>
        <text fg={CHROME.textMuted}>  {status()}</text>
      </box>
      <box flexGrow={1} />
      <text fg={CHROME.textMuted}>↑{totals().inputTokens} ↓{totals().outputTokens}</text>
    </box>
  )
}
