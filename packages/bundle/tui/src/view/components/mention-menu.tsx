/**
 * The `<MentionMenu>` component: an inline autocomplete menu that surfaces
 * when the prompt's live value contains an `@` token. Lists file candidates
 * (from `ctx.fileReferences.list`, packages/context/file-reference-local) and
 * session candidates (from the store's `sessions()` list), filtered by the
 * text after `@`. `↑`/`↓` move the selection, `Enter` inserts the mention
 * (`@path` for files, `@[label](dsh-session:…)` for sessions), `Esc` closes.
 *
 * The mention is inserted into the prompt's raw text; the file-reference and
 * session-reference pre-step listeners enrich the submitted message with
 * context for the model automatically — no runner post-processing.
 *
 * NOTE: uses memo-conditionals instead of `<Show>` — the OpenTUI Solid
 * reconciler emits a stray empty text node for `<Show>`'s falsy branch.
 *
 * @module @deepseek-ai/dsh-tui/view/components/mention-menu
 */

import { type JSX } from '@opentui/solid'
import { For, createMemo, createSignal } from 'solid-js'
import type { KeyEvent } from '@opentui/core'
import { CHROME, ROLE_COLORS } from '../theme.js'

/** The max entries shown at once. */
const MAX_VISIBLE = 8

/** One @-mention completion candidate. */
export interface MentionEntry {
  /** `file` (`@path`) or `session` (`@[label](dsh-session:…)`). */
  kind: 'file' | 'session'
  /** Display label (path or session title). */
  label: string
  /** The full insertion text replacing the `@…` token. */
  insert: string
}

/** Props for {@link MentionMenu}. */
export interface MentionMenuProps {
  /** The active `@` query (text after `@`, or empty for `@` alone). */
  query: string
  /** The resolved candidates (files + sessions). */
  entries: readonly MentionEntry[]
  /** Replaces the prompt's `@…` token with the selected `insert`. */
  onComplete: (insert: string) => void
  /** Closes the menu (Esc or blur). */
  onClose: () => void
}

/**
 * Render the @-mention menu. When `entries` is empty, renders nothing. The
 * list sits above the prompt; `↑`/`↓` move the selection, `Enter` completes,
 * `Esc` closes.
 * @param props - the menu props.
 * @returns the JSX element, or undefined when no candidates.
 */
export function MentionMenu(props: MentionMenuProps): JSX.Element {
  const [selected, setSelected] = createSignal(0)
  const visible = createMemo(() => props.entries.length > 0)
  const list = createMemo(() => props.entries.length > MAX_VISIBLE ? props.entries.slice(0, MAX_VISIBLE) : props.entries)

  const move = (delta: number): void => {
    const len = list().length
    if (len === 0) return
    setSelected((prev) => {
      const next = prev + delta
      if (next < 0) return 0
      if (next >= len) return len - 1
      return next
    })
  }

  const onKey = (key: KeyEvent): void => {
    if (!visible()) return
    if (key.name === 'up') { move(-1); key.preventDefault(); return }
    if (key.name === 'down') { move(1); key.preventDefault(); return }
    if (key.name === 'escape') { props.onClose(); return }
    if (key.name === 'return' || key.name === 'enter') {
      const entry = list()[selected()]
      if (entry !== undefined) {
        props.onComplete(entry.insert)
        key.preventDefault()
      }
    }
  }

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
        onKeyDown={onKey}
      >
        <For each={list()}>
          {(entry, index) => {
            const isActive = createMemo(() => index() === selected())
            const glyph = entry.kind === 'file' ? '📄' : '💬'
            const color = entry.kind === 'file' ? ROLE_COLORS.user : ROLE_COLORS.assistant
            return (
              <box flexDirection="row">
                <text fg={isActive() ? color : CHROME.text}>
                  <b>{isActive() ? '▸ ' : '  '}{glyph} {entry.label}</b>
                </text>
              </box>
            )
          }}
        </For>
      </box>
    )
  })

  return menu()
}
