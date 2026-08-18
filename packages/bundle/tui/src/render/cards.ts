/**
 * Tool-card renderer: dispatches on the `presentation.ts` `card` discriminated
 * union (`ToolCallView` / `ToolResultView`) and renders each variant to an
 * ANSI-styled stdout block. This is the terminal analogue of the Web client's
 * React card components — a pure-data consumer that never calls
 * `presentCall`/`presentResult` itself (the host computes render intent; the
 * in-process TUI reads `tool/call`+`tool/result` events directly).
 *
 * @module @deepseek-ai/dsh-tui/render/cards
 */

import type {
  DiffCallView,
  DiffResultView,
  FileDiff,
  GenericCallView,
  GenericResultView,
  ReadResultView,
  SearchMatchesResultView,
  SearchPathsResultView,
  TerminalCallView,
  TerminalResultView,
  ToolCallView,
  ToolResultView,
  WebFetchResultView,
  WebSearchResultView,
} from '@deepseek-ai/dsh-tools/presentation'
import { parseAnsiLines } from './ansi.js'

/** ANSI SGR helpers. */
const SGR = (code: string): string => `\x1b[${code}m`
const RESET = SGR('0')
const BOLD = SGR('1')
const DIM = SGR('2')
const GREEN = SGR('32')
const RED = SGR('31')
const CYAN = SGR('36')
const MAGENTA = SGR('35')

/**
 * Render a tool-call card to a stdout block.
 * @param view - the pending call view (from `tool/call` event meta).
 */
export function renderToolCall(view: ToolCallView): string {
  switch (view.card) {
    case 'terminal':
      return renderTerminalCall(view)
    case 'diff':
      return renderDiffCall(view)
    case 'generic':
    default:
      return renderGenericCall(view)
  }
}

/**
 * Render a tool-result card to a stdout block.
 * @param view - the completed call view (from `tool/result` event meta).
 */
export function renderToolResult(view: ToolResultView): string {
  switch (view.card) {
    case 'terminal':
      return renderTerminalResult(view)
    case 'diff':
      return renderDiffResult(view)
    case 'search':
      return renderSearchResult(view)
    case 'read':
      return renderReadResult(view)
    case 'web':
      return renderWebResult(view)
    case 'generic':
    default:
      return renderGenericResult(view)
  }
}

// ---- Call cards ----

function renderGenericCall(view: GenericCallView): string {
  const kind = view.kind ?? 'other'
  return `${BOLD}[tool/call]${RESET} ${DIM}(${kind})${RESET} ${view.title}`
}

function renderTerminalCall(view: TerminalCallView): string {
  const cwd = view.cwd ?? ''
  const header = cwd === '' ? '' : `${DIM}${cwd}${RESET}\n`
  const desc = view.description === undefined ? '' : `${view.description}\n`
  return `${desc}${header}${BOLD}$ ${view.title}${RESET}`
}

function renderDiffCall(view: DiffCallView): string {
  const lines = [`${BOLD}[diff]${RESET} ${view.title}`]
  for (const diff of view.diffs) {
    lines.push(...renderFileDiff(diff))
  }
  return lines.join('\n')
}

// ---- Result cards ----

function renderGenericResult(view: GenericResultView): string {
  const title = view.title ?? '[tool/result]'
  return `${DIM}${title}${RESET}`
}

function renderTerminalResult(view: TerminalResultView): string {
  const status = view.exitCode === undefined
    ? view.signal === undefined ? '' : `${RED}[${view.signal}]${RESET}`
    : view.exitCode === 0 ? `${GREEN}[exit 0]${RESET}` : `${RED}[exit ${view.exitCode}]${RESET}`
  const output = view.output ?? ''
  if (output === '') return status
  // Parse ANSI in the output so captured colors render, and prefix each line.
  const lines = parseAnsiLines(output)
  const body = lines.map(line => line.map(span => span.text).join('')).join('\n')
  return `${status}\n${body}`
}

function renderDiffResult(view: DiffResultView): string {
  const lines = [`${BOLD}[diff result]${RESET} ${view.title ?? ''}`]
  for (const diff of view.diffs) {
    lines.push(...renderFileDiff(diff))
  }
  return lines.join('\n')
}

/** Render one FileDiff as a unified-diff-style block from oldText/newText. */
function renderFileDiff(diff: FileDiff): string[] {
  const lines: string[] = []
  lines.push(`${CYAN}--- ${diff.path}${RESET}`)
  const oldLines = diff.oldText === null ? [] : diff.oldText.split('\n')
  const newLines = diff.newText.split('\n')
  // Simple line-level diff: show removed then added. A full LCS diff is
  // deferred (Phase 2 ships the shape; the Web client's DiffHunk is the
  // eventual source of structured hunks, but the render intent carries
  // oldText/newText only).
  const max = Math.max(oldLines.length, newLines.length)
  for (let i = 0; i < max; i++) {
    const oldLine = oldLines[i]
    const newLine = newLines[i]
    if (oldLine !== undefined && newLine !== undefined && oldLine === newLine) {
      lines.push(`${RESET} ${oldLine}${RESET}`)
    } else {
      if (oldLine !== undefined) lines.push(`${RED}-${oldLine}${RESET}`)
      if (newLine !== undefined) lines.push(`${GREEN}+${newLine}${RESET}`)
    }
  }
  return lines
}

function renderSearchResult(view: SearchMatchesResultView | SearchPathsResultView): string {
  if (view.shape === 'matches') {
    const lines = [`${BOLD}[search]${RESET} ${view.title ?? ''} (${view.total} matches${view.truncated ? ', truncated' : ''})`]
    for (const file of view.files) {
      lines.push(`${MAGENTA}${file.path}${RESET}`)
      for (const match of file.matches) {
        lines.push(`  ${DIM}${match.lineNumber}:${RESET} ${match.line}`)
      }
    }
    return lines.join('\n')
  }
  const paths = view.paths
  const lines = [`${BOLD}[search]${RESET} ${view.title ?? ''} (${view.total} paths${view.truncated ? ', truncated' : ''})`]
  for (const p of paths) lines.push(`  ${p}`)
  return lines.join('\n')
}

function renderReadResult(view: ReadResultView): string {
  const lines = [`${BOLD}[read]${RESET} ${view.path}`]
  for (const line of view.lines) {
    lines.push(`${DIM}${String(line.number).padStart(4)}${RESET} ${line.text}`)
  }
  return lines.join('\n')
}

function renderWebResult(view: WebSearchResultView | WebFetchResultView): string {
  if (view.kind === 'search') {
    const lines = [`${BOLD}[web search]${RESET} ${view.title ?? ''}${view.truncated ? ' (truncated)' : ''}`]
    if (view.answer !== undefined) lines.push(view.answer)
    for (const source of view.sources) {
      lines.push(`${CYAN}${source.title ?? source.url}${RESET}`)
      lines.push(`  ${DIM}${source.url}${RESET}`)
      if (source.snippet !== undefined) lines.push(`  ${source.snippet}`)
    }
    return lines.join('\n')
  }
  return `${BOLD}[web fetch]${RESET} ${view.url} (${view.statusCode}${view.truncated ? ', truncated' : ''})`
}
