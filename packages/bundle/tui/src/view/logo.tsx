/**
 * The DSH TUI wordmark. The original design used block-element ASCII art
 * (`█▀▀▄` etc.) to spell DSH TUI across two halves, but the box-drawing
 * glyphs render as mojibake under terminal fonts without full Unicode block
 * coverage. The replacement is plain text: the left half renders muted, the
 * right half renders in the primary text color with bold — the same two-tone
 * split as the original, without the glyph dependency.
 *
 * @module @deepseek-ai/dsh-tui/view/logo
 */

import { type JSX } from '@opentui/solid'
import { CHROME } from './theme.js'

/**
 * The DSH TUI wordmark. The original design used block-element ASCII art
 * (`█▀▀▄` etc.) to spell DSH TUI across two halves, but the box-drawing
 * glyphs render as mojibake under terminal fonts without full Unicode block
 * coverage. The replacement is plain text: the left half renders muted, the
 * right half renders in the primary text color with bold — the same two-tone
 * split as the original, without the glyph dependency.
 */
export const DSH_LOGO: { readonly left: readonly string[]; readonly right: readonly string[] } = {
  left: ['DSH'],
  right: ['TUI'],
}

/** Props for {@link Logo}. */
export interface LogoProps {
  /** Foreground color for the left half (default: muted). */
  readonly leftColor?: string
  /** Foreground color for the right half (default: primary text). */
  readonly rightColor?: string
}

/**
 * Render the two-tone DSH TUI wordmark: a single row, left half in the muted
 * color, right half in the primary text color with bold, separated by a
 * space. The shadow-tint glyph renderer (`renderLine`) is retained for a
 * future block-art revival; the plain-text mark carries no shadow cells.
 * @param props - the logo colors.
 * @returns the JSX element for the wordmark.
 */
export function Logo(props: LogoProps): JSX.Element {
  const leftFg = (): string => props.leftColor ?? CHROME.textMuted
  const rightFg = (): string => props.rightColor ?? CHROME.text
  return (
    <box flexDirection="row">
      <text fg={leftFg()} selectable={false}>{DSH_LOGO.left[0]}</text>
      <text selectable={false}>{' '}</text>
      <text fg={rightFg()} attributes={1} selectable={false}>{DSH_LOGO.right[0]}</text>
    </box>
  )
}
