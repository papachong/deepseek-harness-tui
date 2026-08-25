/**
 * The DSH TUI wordmark in opencode's shadow-block style (`component/logo.tsx`
 * + `logo.ts`). Each half is a 4-row block-art string; `_` renders a tinted
 * background space (the shadow cell), `^`/`~`/`,` render half-block glyphs
 * (`▀`/`▄`) so two text rows read as one 8-pixel-tall letter, and any other
 * character renders as the foreground glyph. The left half renders muted,
 * the right half bold — the two-tone split from the opencode home screen.
 *
 * DSH (left):  D  █▀▀▄  S  █▀▀▀  H  █  █
 *              D  █__█  S  █___  H  █__█
 *              D  ▀▀▀▀  S  ▀▀▀▀  H  ▀  ▀
 * TUI (right): T  ▀▀█▀▀  U  █  █  I  █
 *              T    █    U  █  █  I  █
 *              T    █    U  █__█  I  █
 *              T    ▀    U  ▀▀▀▀  I  ▀
 *
 * @module @deepseek-ai/dsh-tui/view/logo
 */

import { type JSX } from '@opentui/solid'
import { For } from 'solid-js'
import { CHROME, tint } from './theme.js'

/**
 * The DSH TUI wordmark. `left` and `right` pair row-for-row (left[i] renders
 * next to right[i] with a 1-column gap). Markup legend: `_` = background-
 * shade space, `^` = foreground upper half block (▀), `~`/`,` = shadow half
 * blocks. The leading row of spaces on `right` aligns the T under the DSH
 * baseline so the two halves read as one word.
 */
export const DSH_LOGO: { readonly left: readonly string[]; readonly right: readonly string[] } = {
  left: [
    '                   ',
    '█▀▀▄ █▀▀▀ █  █',
    '█__█ █___ █__█',
    '▀▀▀▀ ▀▀▀▀ ▀  ▀',
  ],
  right: [
    '             ▄     ',
    '▀▀█▀▀ █  █ █',
    '  █   █  █ █',
    '  ▀   ▀▀▀▀ ▀',
  ],
}

/**
 * Render one art line, expanding the mark glyphs (`_`/`^`/`~`/`,`) into
 * half-block `<text>` spans tinted toward the background, mirroring
 * opencode's `renderLine` (component/logo.tsx:9-47).
 * @param line - the raw art line.
 * @param fg - the foreground color for the visible glyph cells.
 * @param shadow - the color the shadow glyphs tint toward.
 * @param bold - whether the foreground glyphs render bold.
 * @returns the JSX spans for the line.
 */
function renderLine(line: string, fg: string, shadow: string, bold: boolean): JSX.Element[] {
  const out: JSX.Element[] = []
  for (const char of Array.from(line)) {
    if (char === '_') {
      // Shadow cell: a space painted with the tinted background.
      out.push(bold
        ? <text fg={fg} bg={shadow} attributes={1} selectable={false}>{' '}</text>
        : <text fg={fg} bg={shadow} selectable={false}>{' '}</text>)
      continue
    }
    if (char === '^') {
      out.push(bold
        ? <text fg={fg} bg={shadow} attributes={1} selectable={false}>{'▀'}</text>
        : <text fg={fg} bg={shadow} selectable={false}>{'▀'}</text>)
      continue
    }
    if (char === '~') {
      out.push(bold
        ? <text fg={shadow} attributes={1} selectable={false}>{'▀'}</text>
        : <text fg={shadow} selectable={false}>{'▀'}</text>)
      continue
    }
    if (char === ',') {
      out.push(bold
        ? <text fg={shadow} attributes={1} selectable={false}>{'▄'}</text>
        : <text fg={shadow} selectable={false}>{'▄'}</text>)
      continue
    }
    out.push(bold
      ? <text fg={fg} attributes={1} selectable={false}>{char}</text>
      : <text fg={fg} selectable={false}>{char}</text>)
  }
  return out
}

/** Props for {@link Logo}. */
export interface LogoProps {
  /** Foreground color for the left half (default: muted). */
  readonly leftColor?: string
  /** Foreground color for the right half (default: primary text). */
  readonly rightColor?: string
}

/**
 * Render the two-tone DSH TUI wordmark: each row renders the left half in
 * the muted color and the right half in the primary text color with a
 * 1-column gap, matching opencode's `<Logo>` (component/logo.tsx:49-61).
 * The shadow cells tint 25% toward the background so the mark reads as
 * raised against the terminal background.
 * @param props - the logo colors.
 * @returns the JSX element for the wordmark.
 */
export function Logo(props: LogoProps): JSX.Element {
  const leftFg = (): string => props.leftColor ?? CHROME.textMuted
  const rightFg = (): string => props.rightColor ?? CHROME.text
  // Shadow = 25% tint of the foreground toward the background (opencode's
  // tint(theme.background, fg, 0.25)).
  const leftShadow = (): string => tint(CHROME.bgPanel, leftFg(), 0.25)
  const rightShadow = (): string => tint(CHROME.bgPanel, rightFg(), 0.25)
  return (
    <box>
      <For each={DSH_LOGO.left}>
        {(line, index) => (
          <box flexDirection="row" gap={1}>
            <box flexDirection="row">{renderLine(line, leftFg(), leftShadow(), false)}</box>
            <box flexDirection="row">{renderLine(DSH_LOGO.right[index()] ?? '', rightFg(), rightShadow(), true)}</box>
          </box>
        )}
      </For>
    </box>
  )
}
