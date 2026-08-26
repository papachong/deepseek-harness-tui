/**
 * The `<CommandPalette>` component: an absolute-positioned overlay dialog for
 * running commands (switch model, switch session, toggle theme). Mirrors
 * opencode's command palette: a `<select>` list with a translucent backdrop.
 *
 * Opened by the prompt (a keybind or `/` prefix sets `open`); Esc closes.
 * Selecting an entry runs its `run()` callback and closes.
 *
 * NOTE: uses memo-conditionals instead of `<Show>` — the OpenTUI Solid
 * reconciler emits a stray empty text node for `<Show>`'s falsy branch.
 *
 * @module @ruhooai/dsh-tui/view/components/command-palette
 */

import { type JSX } from '@opentui/solid'
import { createMemo, createSignal, For } from 'solid-js'
import type { KeyEvent } from '@opentui/core'
import { CHROME, ROLE_COLORS } from '../theme.js'
import { t } from '../i18n.js'

/** One command-palette entry. */
export interface CommandEntry {
  /** Display label. */
  label: string
  /** Short description. */
  description: string
  /** Invoked when selected. */
  run: () => void
}

/** Props for {@link CommandPalette}. */
export interface CommandPaletteProps {
  /** True when the palette is visible (absolute overlay). */
  open: boolean
  /** Closes the palette (Esc / select / blur). */
  onClose: () => void
  /** The commands to list. */
  commands: readonly CommandEntry[]
}

/**
 * Render the command palette: a translucent backdrop + a `<select>` list of
 * commands. When closed, renders nothing (undefined).
 * @param props - the palette props.
 * @returns the JSX element, or undefined when closed.
 */
export function CommandPalette(props: CommandPaletteProps): JSX.Element {
  const [selected] = createSignal(0)

  const onKey = (key: KeyEvent): void => {
    if (key.name === 'escape') { props.onClose(); return }
    if (key.name === 'return' || key.name === 'enter') {
      const entry = props.commands[selected()] ?? props.commands[0]
      if (entry !== undefined) { entry.run(); props.onClose() }
    }
  }

  const palette = createMemo<JSX.Element>(() => {
    if (!props.open) return undefined
    return (
      <box position="absolute" top={2} left={2} right={2} zIndex={3000} backgroundColor={CHROME.bgPanel} border borderColor={CHROME.borderActive} borderStyle="rounded" paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1} onKeyDown={onKey}>
        <text fg={ROLE_COLORS.assistant}><b>{t('palette.title')}</b></text>
        <For each={props.commands}>
          {(cmd, index) => {
            const isActive = createMemo(() => index() === selected())
            return (
              <box flexDirection="row">
                <text fg={isActive() ? ROLE_COLORS.assistant : CHROME.text}><b>{isActive() ? '▸' : ' '} {cmd.label}</b></text>
                <text fg={CHROME.textMuted}> — {cmd.description}</text>
              </box>
            )
          }}
        </For>
      </box>
    )
  })

  return palette()
}
