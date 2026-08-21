/**
 * The `<ToolCard>` component: renders one {@link ToolEntry} with a status icon
 * (animated spinner while pending, `✓` on success, `✗` on error), a parameter
 * preview, and a result body. The body dispatches on the host-computed
 * `callView`/`resultView` (filled by the runner's `viewFor` →
 * `presentCall`/`presentResult`): `terminal`/`diff`/`read`/`search`/`web` get
 * specialized rendering; when no view is present, the generic arm renders the
 * raw result text with diff-style `+`/`-` coloring.
 *
 * Mirrors opencode's InlineTool/BlockTool: a compact titled header with
 * spinner/status glyph plus a padded body. The host computes render intent via
 * the tool registry's `presentCall`/`presentResult`; this component does NOT
 * call presenters itself (it reads the precomputed `callView`/`resultView`
 * the store carries on the entry).
 *
 * NOTE: uses memo-conditionals instead of `<Show>` — the OpenTUI Solid
 * reconciler emits a stray empty text node for `<Show>`'s falsy branch that
 * orphans under a non-text parent (`<box>`).
 *
 * @module @deepseek-ai/dsh-tui/view/components/tool-card
 */

import { type JSX } from '@opentui/solid'
import { createMemo, createSignal, For } from 'solid-js'
import type {
  DiffResultView,
  ReadResultView,
  SearchMatchesResultView,
  SearchPathsResultView,
  TerminalResultView,
  WebFetchResultView,
  WebSearchResultView,
} from '@deepseek-ai/dsh-tools/presentation'
import { STATUS_COLORS, STATUS_GLYPH, CHROME } from '../theme.js'
import { Spinner } from './spinner.js'
import type { ToolEntry } from '../store.js'

/** Maximum lines of generic result text to render inline before truncating. */
const MAX_RESULT_LINES = 8

/** Props for {@link ToolCard}. */
export interface ToolCardProps {
  /** The tool entry to render. */
  tool: ToolEntry
}

/**
 * Render one tool call as a titled card. The header line carries the status
 * glyph (spinner/✓/✗) + tool name + a dim arguments preview. The body
 * dispatches on `resultView.card` when the host attached a render intent;
 * otherwise the generic arm renders the raw result text.
 * @param props - the tool-card props.
 * @returns the JSX element for the tool card.
 */
export function ToolCard(props: ToolCardProps): JSX.Element {
  const isPending = createMemo(() => props.tool.state === 'pending')
  const isError = createMemo(() => props.tool.isError === true)
  const hasResult = createMemo(() =>
    props.tool.state === 'completed' && props.tool.resultText !== undefined,
  )
  // Collapsed state for long results; click-like toggle via a signal the
  // header owns (OpenTUI has no click on <text>, so this stays a render-time
  // truncation toggle controlled by MAX_RESULT_LINES).
  const [expanded, setExpanded] = createSignal(false)
  const glyphColor = createMemo(() =>
    isPending() ? STATUS_COLORS.completed : isError() ? STATUS_COLORS.error : STATUS_COLORS.completed,
  )

  const header = createMemo<JSX.Element>(() => (
    <box flexDirection="row">
      {isPending()
        ? <Spinner fg={STATUS_COLORS.pending} />
        : <text fg={glyphColor()}><b>{STATUS_GLYPH[isError() ? 'error' : 'completed']}</b></text>}
      <text fg={CHROME.text}><b> {props.tool.name}</b></text>
      {props.tool.arguments ? <text fg={CHROME.textMuted}> {previewArgs(props.tool.arguments)}</text> : undefined}
    </box>
  ))

  const body = createMemo<JSX.Element>(() => {
    if (isPending()) return <text fg={CHROME.textMuted}>running…</text>
    if (!hasResult()) return undefined
    // Dispatch on the host-computed resultView when present.
    const view = props.tool.resultView
    if (view !== undefined) {
      switch (view.card) {
        case 'terminal': return renderTerminalResult(view)
        case 'diff': return renderDiffResult(view)
        case 'search': return renderSearchResult(view)
        case 'read': return renderReadResult(view)
        case 'web': return renderWebResult(view)
        case 'generic':
        default: return renderGenericResult(view.title, props.tool.resultText ?? '', isError(), expanded(), setExpanded)
      }
    }
    // No view: generic raw text with diff-style coloring.
    return renderGenericResult(undefined, props.tool.resultText ?? '', isError(), expanded(), setExpanded)
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
 * Render a generic result: truncated raw text, red on error, with a
 * `+`/`-` diff-style line coloring. Long results collapse to
 * {@link MAX_RESULT_LINES} lines with a "… N more" toggle hint.
 * @param title - optional title from the view.
 * @param resultText - the raw text to render.
 * @param isError - whether the tool reported an error.
 * @param expanded - whether the collapse toggle is expanded.
 * @param setExpanded - toggle function for the collapse hint.
 * @returns the JSX element for the generic result body.
 */
function renderGenericResult(
  title: string | undefined,
  resultText: string,
  isError: boolean,
  expanded: boolean,
  _setExpanded: (v: boolean) => void,
): JSX.Element {
  const lines = resultText.split('\n')
  const limit = expanded ? lines.length : MAX_RESULT_LINES
  const truncated = lines.length > MAX_RESULT_LINES && !expanded
  const shown = truncated ? lines.slice(0, limit) : lines
  return (
    <box>
      {title !== undefined ? <text fg={CHROME.textMuted}>{title}</text> : undefined}
      <For each={shown}>
        {(line: string) => <text fg={isError ? STATUS_COLORS.error : diffLineColor(line)}>{line}</text>}
      </For>
      {lines.length > MAX_RESULT_LINES
        ? (
          <text fg={CHROME.textMuted}>
            {truncated ? `… +${lines.length - MAX_RESULT_LINES} more [toggle]` : '▼ collapse [toggle]'}
          </text>
        )
        : undefined}
    </box>
  )
}

/**
 * Render a terminal result: exit/signal status badge + the captured output.
 * @param view - the terminal result view.
 * @returns the JSX element for the terminal result body.
 */
function renderTerminalResult(view: TerminalResultView): JSX.Element {
  const exitColor = view.exitCode === undefined
    ? STATUS_COLORS.error
    : view.exitCode === 0 ? STATUS_COLORS.completed : STATUS_COLORS.error
  const status = view.exitCode === undefined
    ? view.signal === undefined ? '' : `[${view.signal}]`
    : `[exit ${view.exitCode}]`
  const output = view.output ?? ''
  const lines = output === '' ? [] : output.split('\n').slice(0, MAX_RESULT_LINES)
  return (
    <box>
      <text fg={exitColor}><b>{status}</b></text>
      <For each={lines}>{(line: string) => <text fg={CHROME.text}>{line}</text>}</For>
    </box>
  )
}

/**
 * Render a diff result: each FileDiff as `+`/`-` colored lines with a path
 * header. A simple line-level diff (removed then added) — a full LCS is
 * deferred (the view carries oldText/newText only).
 * @param view - the diff result view.
 * @returns the JSX element for the diff result body.
 */
function renderDiffResult(view: DiffResultView): JSX.Element {
  return (
    <box>
      {view.title !== undefined ? <text fg={CHROME.textMuted}>{view.title}</text> : undefined}
      <For each={view.diffs}>
        {(diff) => {
          const oldLines = diff.oldText === null ? [] : diff.oldText.split('\n')
          const newLines = diff.newText.split('\n')
          const max = Math.max(oldLines.length, newLines.length)
          const rows: JSX.Element[] = []
          rows.push(<text fg="#22d3ee">--- {diff.path}</text>)
          for (let i = 0; i < max; i++) {
            const oldLine = oldLines[i]
            const newLine = newLines[i]
            if (oldLine !== undefined && newLine !== undefined && oldLine === newLine) {
              rows.push(<text fg={CHROME.text}> {oldLine}</text>)
            } else {
              if (oldLine !== undefined) rows.push(<text fg={STATUS_COLORS.error}>-{oldLine}</text>)
              if (newLine !== undefined) rows.push(<text fg={STATUS_COLORS.completed}>+{newLine}</text>)
            }
          }
          return <box>{rows}</box>
        }}
      </For>
    </box>
  )
}

/**
 * Render a search result: matches (file → line hits) or paths list, with a
 * total/truncated summary.
 * @param view - the search result view (matches or paths shape).
 * @returns the JSX element for the search result body.
 */
function renderSearchResult(view: SearchMatchesResultView | SearchPathsResultView): JSX.Element {
  if (view.shape === 'matches') {
    return (
      <box>
        <text fg={CHROME.textMuted}>{view.title ?? 'search'} ({view.total} matches{view.truncated ? ', truncated' : ''})</text>
        <For each={view.files}>
          {file => (
            <box>
              <text fg="#c678dd">{file.path}</text>
              <For each={file.matches}>
                {match => (
                  <box flexDirection="row">
                    <text fg={CHROME.textMuted}>  {match.lineNumber}: </text>
                    <text fg={CHROME.text}>{match.line}</text>
                  </box>
                )}
              </For>
            </box>
          )}
        </For>
      </box>
    )
  }
  return (
    <box>
      <text fg={CHROME.textMuted}>{view.title ?? 'search'} ({view.total} paths{view.truncated ? ', truncated' : ''})</text>
      <For each={view.paths}>{(p: string) => <text fg={CHROME.text}>  {p}</text>}</For>
    </box>
  )
}

/**
 * Render a read result: the file path header + numbered lines.
 * @param view - the read result view.
 * @returns the JSX element for the read result body.
 */
function renderReadResult(view: ReadResultView): JSX.Element {
  return (
    <box>
      <text fg="#22d3ee"><b>{view.path}</b></text>
      <For each={view.lines}>
        {line => (
          <box flexDirection="row">
            <text fg={CHROME.textMuted}>{String(line.number).padStart(4)} </text>
            <text fg={CHROME.text}>{line.text}</text>
          </box>
        )}
      </For>
    </box>
  )
}

/**
 * Render a web result: search (sources + answer) or fetch (url + status).
 * @param view - the web result view (search or fetch kind).
 * @returns the JSX element for the web result body.
 */
function renderWebResult(view: WebSearchResultView | WebFetchResultView): JSX.Element {
  if (view.kind === 'search') {
    return (
      <box>
        <text fg={CHROME.textMuted}>{view.title ?? 'web search'}{view.truncated ? ' (truncated)' : ''}</text>
        {view.answer !== undefined ? <text fg={CHROME.text}>{view.answer}</text> : undefined}
        <For each={view.sources}>
          {source => (
            <box>
              <text fg="#22d3ee">{source.title ?? source.url}</text>
              <text fg={CHROME.textMuted}>  {source.url}</text>
              {source.snippet !== undefined ? <text fg={CHROME.textMuted}>  {source.snippet}</text> : undefined}
            </box>
          )}
        </For>
      </box>
    )
  }
  return (
    <box>
      <text fg={CHROME.textMuted}>web fetch</text>
      <text fg="#22d3ee">{view.url}</text>
      <text fg={CHROME.textMuted}>  ({view.statusCode}{view.truncated ? ', truncated' : ''})</text>
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
