/**
 * The `<ToolCard>` component: renders one {@link ToolEntry} with a status icon
 * (animated spinner while pending, `✓` on success, `✗` on error), a parameter
 * preview, and a result body. The body dispatches on render intent when the
 * host computed a `resultView` (diff → `+`/`-` coloring); v1 falls through to
 * generic raw text for all other intents (terminal/read/search/web).
 *
 * Mirrors opencode's InlineTool/BlockTool: a compact titled header with
 * spinner/status glyph plus a padded body. The host computes render intent via
 * the tool registry's `presentCall`/`presentResult`; this component does NOT
 * call presenters itself (the store has no tool registry, so `callView`/
 * `resultView` are absent in v1 and the generic arm handles everything).
 *
 * NOTE: uses memo-conditionals instead of `<Show>` — the OpenTUI Solid
 * reconciler emits a stray empty text node for `<Show>`'s falsy branch that
 * orphans under a non-text parent (`<box>`).
 *
 * @module @deepseek-ai/dsh-tui/view/components/tool-card
 */

import { type JSX } from '@opentui/solid'
import { createMemo } from 'solid-js'
import { STATUS_COLORS, STATUS_GLYPH, CHROME } from '../theme.js'
import { Spinner } from './spinner.js'
import type { ToolEntry } from '../store.js'

/** Maximum lines of result text to render inline before truncating. */
const MAX_RESULT_LINES = 8

/** Props for {@link ToolCard}. */
export interface ToolCardProps {
  /** The tool entry to render. */
  tool: ToolEntry
}

/**
 * Render one tool call as a titled card. The header line carries the status
 * glyph (spinner/✓/✗) + tool name + a dim arguments preview. The body is the
 * result text (or a pending placeholder), colored red on error. Long results
 * truncate to {@link MAX_RESULT_LINES} lines.
 * @param props - the tool-card props.
 * @returns the JSX element for the tool card.
 */
export function ToolCard(props: ToolCardProps): JSX.Element {
  const isPending = createMemo(() => props.tool.state === 'pending')
  const isError = createMemo(() => props.tool.isError === true)
  const hasResult = createMemo(() =>
    props.tool.state === 'completed' && props.tool.resultText !== undefined,
  )
  const glyphColor = createMemo(() =>
    isPending() ? STATUS_COLORS.completed : isError() ? STATUS_COLORS.error : STATUS_COLORS.completed,
  )

  const header = createMemo<JSX.Element>(() => (
    <text>
      {isPending() ? <Spinner fg={STATUS_COLORS.pending} /> : <text fg={glyphColor()}><b>{STATUS_GLYPH[isError() ? 'error' : 'completed']}</b></text>}
      <text fg={CHROME.text}><b> {props.tool.name}</b></text>
      {props.tool.arguments ? <text fg={CHROME.textMuted}> {previewArgs(props.tool.arguments)}</text> : undefined}
    </text>
  ))

  const body = createMemo<JSX.Element>(() => {
    if (isPending()) return <text fg={CHROME.textMuted}>running…</text>
    if (hasResult()) {
      return renderResult(props.tool.resultText ?? '', isError())
    }
    return undefined
  })

  return (
    <box
      border={['left']}
      borderStyle="single"
      borderColor={isError() ? STATUS_COLORS.error : CHROME.border}
      paddingLeft={1}
      paddingRight={1}
      marginTop={1}
    >
      {header()}
      {body()}
    </box>
  )
}

/**
 * Render the result body. v1 does not specialize terminal/diff/read/search/web
 * — all results render as truncated text, red when the tool reported an error.
 * When a host-computed `resultView` carries a `diff` intent, the `+`/`-` lines
 * color green/red; this branch can later widen without changing the call site.
 * @param resultText - the raw text to render.
 * @param isError - whether the tool reported an error (red text).
 * @returns the JSX element for the result body, or undefined when no text.
 */
function renderResult(resultText: string, isError: boolean): JSX.Element {
  const lines = resultText.split('\n')
  const truncated = lines.length > MAX_RESULT_LINES
  const shown = truncated ? lines.slice(0, MAX_RESULT_LINES) : lines
  return (
    <box>
      {shown.map(line => (
        <text fg={isError ? STATUS_COLORS.error : diffLineColor(line)}>{line}</text>
      ))}
      {truncated ? <text fg={CHROME.textMuted}>… +{lines.length - MAX_RESULT_LINES} more lines</text> : undefined}
    </box>
  )
}

/**
 * Color a line for diff-style output: `+` green, `-` red, hunk headers cyan.
 * Non-diff lines render in the default text color.
 * @param line - one result line.
 * @returns the color (hex) for the line.
 */
function diffLineColor(line: string): string {
  if (line.startsWith('+')) return STATUS_COLORS.completed
  if (line.startsWith('-')) return STATUS_COLORS.error
  if (line.startsWith('@@')) return '#22d3ee'
  return CHROME.text
}

/**
 * Build a one-line arguments preview for the header, e.g. `Read({path:"…"})`.
 * Parses the raw JSON arguments and shortens long string values.
 * @param argsJson - the raw arguments JSON string.
 * @returns a compact preview string.
 */
function previewArgs(argsJson: string): string {
  if (argsJson === '') return ''
  try {
    const parsed = JSON.parse(argsJson) as Record<string, unknown>
    const entries = Object.entries(parsed).slice(0, 2)
    const parts = entries.map(([key, value]) => {
      const str = typeof value === 'string' ? shortenPath(value) : JSON.stringify(value)
      return `${key}:${str}`
    })
    const suffix = Object.keys(parsed).length > 2 ? ', …' : ''
    return `(${parts.join(', ')}${suffix})`
  } catch {
    return `(${shortenPath(argsJson)})`
  }
}

/**
 * Shorten a long string (typically a file path) for inline display.
 * @param value - the string to shorten.
 * @returns a quoted, ellipsized string.
 */
function shortenPath(value: string): string {
  const max = 40
  const shortened = value.length > max
    ? `…${value.slice(value.length - max + 1)}`
    : value
  return `"${shortened}"`
}
