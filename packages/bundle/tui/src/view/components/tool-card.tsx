/**
 * The `<ToolCard>` component: renders one {@link ToolEntry} in the transcript
 * with a titled header (cyan) and its result. The card-union switch wires the
 * `generic`/`terminal`/`diff`/`read`/`search`/`web` presentation intents, but
 * for v1 every arm falls through to the generic renderer: a title line plus
 * the raw result text. The host computes render intent via the tool registry's
 * `presentCall`/`presentResult` and carries it on the entry; this component
 * does NOT call presenters itself (the store has no tool registry).
 *
 * Error results render in red; pending results render a gray `running…`.
 *
 * NOTE: uses memo-conditionals instead of `<Show>` — the OpenTUI Solid
 * reconciler emits a stray empty text node for `<Show>`'s falsy branch that
 * orphans under a non-text parent (`<box>`).
 *
 * @module @deepseek-ai/dsh-tui/view/components/tool-card
 */

import { type JSX } from '@opentui/solid'
import { createMemo } from 'solid-js'
import type { ToolEntry } from '../store.js'

/** Props for {@link ToolCard}. */
export interface ToolCardProps {
  /** The tool entry to render. */
  tool: ToolEntry
}

/**
 * Render one tool call as a titled card. The header line is the tool name
 * prefixed with a marker; the body is the result (or a pending placeholder).
 * @param props - the tool-card props.
 * @returns the JSX element for the tool card.
 */
export function ToolCard(props: ToolCardProps): JSX.Element {
  const isPending = createMemo(() => props.tool.state === 'pending')
  const hasResult = createMemo(() =>
    props.tool.state === 'completed' && props.tool.resultText !== undefined,
  )
  const body = createMemo<JSX.Element>(() => {
    if (isPending()) return <text fg="gray">running…</text>
    if (hasResult()) {
      return renderGeneric(props.tool.resultText, props.tool.isError === true)
    }
    return undefined
  })
  return (
    <box paddingLeft={3} marginTop={1}>
      <text>
        <text fg="cyan">⏺ {props.tool.name}</text>
      </text>
      {body()}
    </box>
  )
}

/**
 * Render the generic result body: the raw result text, red when the tool
 * reported an error. v1 does not specialize terminal/diff/read/search/web —
 * the switch in the store's `resultView` path (when a host-computed view is
 * present) can later branch here without changing the call site.
 * @param resultText - the raw text to render (may be undefined).
 * @param isError - whether the tool reported an error (red text).
 * @returns the JSX element for the result body, or undefined when no text.
 */
function renderGeneric(resultText: string | undefined, isError: boolean): JSX.Element {
  const text = resultText ?? ''
  return isError ? <text fg="red">{text}</text> : <text>{text}</text>
}
