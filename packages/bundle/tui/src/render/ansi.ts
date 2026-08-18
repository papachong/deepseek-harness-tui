/**
 * ANSI parser for the terminal renderer: a terminal-native port of
 * `packages/client/ui-primitives/src/ansi.ts` that resolves SGR runs into
 * plain terminal-styled spans (foreground/background SGR codes + decorations)
 * instead of React `CSSProperties`. Consumed by the TUI render layer when a
 * tool result carries ANSI (e.g. bash output).
 *
 * @module @deepseek-ai/dsh-tui/render/ansi
 */

import Anser from 'anser'

/** One terminal-styled text run. */
export interface TerminalAnsiSpan {
  /** The run's plain text, free of escape sequences and newlines. */
  text: string
  /** Resolved SGR style, or `undefined` when the run needs no styling. */
  style: TerminalSgrStyle | undefined
}

/** The SGR attributes a run may carry. */
export interface TerminalSgrStyle {
  /** Foreground as an SGR 38;2 `r;g;b` triple, or a basic-color name. */
  fg?: string
  /** Background as an SGR 48;2 `r;g;b` triple, or a basic-color name. */
  bg?: string
  /** Bold (SGR 1). */
  bold?: boolean
  /** Italic (SGR 3). */
  italic?: boolean
  /** Underline (SGR 4). */
  underline?: boolean
  /** Strikethrough (SGR 9). */
  strikethrough?: boolean
  /** Dim/faint (SGR 2). */
  dim?: boolean
}

/** The spans of one output line, in order. */
export type TerminalAnsiLine = readonly TerminalAnsiSpan[]

/**
 * The 8/16 basic ANSI colors mapped to their canonical names. A terminal
 * renderer maps these to its theme's color slots; truecolor/256 values pass
 * through as raw `r;g;b` triples.
 */
const BASIC_COLOR_NAME: Record<string, string> = {
  '0,0,0': 'black',
  '187,0,0': 'red',
  '0,187,0': 'green',
  '187,187,0': 'yellow',
  '0,0,187': 'blue',
  '187,0,187': 'magenta',
  '0,187,187': 'cyan',
  '255,255,255': 'white',
  '85,85,85': 'bright-black',
  '255,85,85': 'bright-red',
  '85,255,85': 'bright-green',
  '255,255,85': 'bright-yellow',
  '85,85,255': 'bright-blue',
  '255,85,255': 'bright-magenta',
  '85,255,255': 'bright-cyan',
}

/** SGR decorations anser reports, mapped to TerminalSgrStyle flags. */
const DECORATION_FLAG: Record<string, keyof Omit<TerminalSgrStyle, 'fg' | 'bg'>> = {
  bold: 'bold',
  dim: 'dim',
  italic: 'italic',
  underline: 'underline',
  'strikethrough': 'strikethrough',
}

/**
 * Resolve one anser chunk into a terminal SGR style.
 * @param chunk - the anser-parsed run.
 * @returns the SGR style, or undefined when the run carries none.
 */
function resolveStyle(chunk: { fg: string | null; bg: string | null; decorations: string[] }): TerminalSgrStyle | undefined {
  const style: TerminalSgrStyle = {}
  const fgRgb = chunk.fg === null ? undefined : chunk.fg.replace(/\s+/g, '')
  if (fgRgb !== undefined) {
    style.fg = BASIC_COLOR_NAME[fgRgb] ?? fgRgb.replace(/,/g, ';')
  }
  const bgRgb = chunk.bg === null ? undefined : chunk.bg.replace(/\s+/g, '')
  if (bgRgb !== undefined) {
    style.bg = BASIC_COLOR_NAME[bgRgb] ?? bgRgb.replace(/,/g, ';')
  }
  for (const decoration of chunk.decorations) {
    const flag = DECORATION_FLAG[decoration]
    if (flag !== undefined) style[flag] = true
  }
  return Object.keys(style).length === 0 ? undefined : style
}

/**
 * Strip non-SGR ANSI sequences (OSC, cursor movement, other C0 controls) so
 * they never reach the renderer as literal characters. Mirrors the
 * ui-primitives sanitize step.
 */
function sanitize(text: string): string {
  return text.replace(/\x1b\][^\x07]*\x07/g, '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, m => m)
}

/**
 * Parse command output into terminal-styled spans grouped by line.
 * @param text - raw output text, which may contain ANSI escape sequences.
 * @returns one entry per output line (always at least one, possibly empty).
 */
export function parseAnsiLines(text: string): TerminalAnsiLine[] {
  let current: TerminalAnsiSpan[] = []
  const lines: TerminalAnsiSpan[][] = [current]
  for (const chunk of Anser.ansiToJson(sanitize(text), { json: true, remove_empty: true })) {
    const style = resolveStyle(chunk)
    for (const [index, part] of chunk.content.split('\n').entries()) {
      if (index > 0) {
        current = []
        lines.push(current)
      }
      if (part !== '') current.push({ text: part, style })
    }
  }
  return lines
}
