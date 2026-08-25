/**
 * The `<SlashMenu>` component: an inline autocomplete menu that surfaces when
 * the prompt's live value starts with `/`. Lists the TUI-local commands plus
 * every plugin-registered command (`ctx.commands.list(agent)` →
 * `/compact` `/feedback` `/goal` `/plan` …), filtered by the token the user
 * has typed after the slash. `↑`/`↓` move the selection, `Enter` completes the
 * command (replaces the prompt's first token with `/name `), `Esc` closes.
 *
 * The menu renders inline above the prompt (not an absolute overlay) so the
 * input keeps focus; it mirrors the opencode slash-command surface.
 *
 * NOTE: uses memo-conditionals instead of `<Show>` — the OpenTUI Solid
 * reconciler emits a stray empty text node for `<Show>`'s falsy branch.
 *
 * @module @deepseek-ai/dsh-tui/view/components/slash-menu
 */

import { type JSX } from '@opentui/solid'
import { For, createMemo } from 'solid-js'
import { CHROME, ROLE_COLORS } from '../theme.js'
import type { CommandEntry } from './command-palette.js'

/** The max entries shown at once; the rest scroll. */
const MAX_VISIBLE = 8

/** Props for {@link SlashMenu}. */
export interface SlashMenuProps {
  /** The current prompt value (starts with `/`). */
  value: string
  /** The command entries to filter (local + registry). */
  commands: readonly CommandEntry[]
  /** The selected index (owned by the prompt, passed down). */
  selectedIndex?: number
  /** Replaces the prompt's content with the completed `/<name> `. */
  onComplete: (text: string) => void
  /** Closes the menu (Esc or blur). */
  onClose: () => void
}

/**
 * Extract the slash token (the text from the leading `/` to the first space)
 * from the live value, so the menu can filter commands by prefix.
 * @param value - the live prompt value.
 * @returns the lowercased token after `/` (or empty when just `/`).
 */
export function slashToken(value: string): string {
  const slash = value.indexOf('/')
  if (slash === -1) return ''
  const rest = value.slice(slash + 1)
  const space = rest.indexOf(' ')
  return (space === -1 ? rest : rest.slice(0, space)).toLowerCase()
}

/**
 * Render the slash-command menu. When `value` does not start with `/` (or no
 * commands match), renders nothing. The filtered list sits above the prompt;
 * `↑`/`↓` move the selection, `Enter` completes, `Esc` closes.
 * @param props - the menu props.
 * @returns the JSX element, or undefined when no menu should show.
 */
export function SlashMenu(props: SlashMenuProps): JSX.Element {
  const token = createMemo(() => slashToken(props.value))
  const filtered = createMemo<readonly CommandEntry[]>(() => {
    const t = token()
    const all = props.commands
    if (t === '') return all.length > MAX_VISIBLE ? all.slice(0, MAX_VISIBLE) : all
    const matches = all.filter(c => c.label.toLowerCase().includes(t))
    return matches.length > MAX_VISIBLE ? matches.slice(0, MAX_VISIBLE) : matches
  })
  const visible = createMemo(() => filtered().length > 0 && props.value.trimStart().startsWith('/'))
  const selected = createMemo(() => props.selectedIndex ?? 0)

  const menu = createMemo<JSX.Element>(() => {
    if (!visible()) return undefined
    return (
      <box
        border={['bottom']}
        borderStyle="single"
        borderColor={CHROME.border}
        paddingLeft={1}
        paddingRight={1}
        flexDirection="column"
        width="100%"
        flexShrink={0}
      >
        <For each={filtered()}>
          {(cmd, index) => {
            const isActive = createMemo(() => index() === selected())
            return (
              <box flexDirection="row" width="100%" flexShrink={0}>
                <text fg={isActive() ? ROLE_COLORS.assistant : CHROME.text} flexShrink={0}>
                  <b>{isActive() ? '▸ ' : '  '}{cmd.label}</b>
                </text>
                <text fg={CHROME.textMuted} flexShrink={1}> — {cmd.description}</text>
              </box>
            )
          }}
        </For>
      </box>
    )
  })

  return menu()
}
