/**
 * The `<Home>` component: the landing surface shown before the first
 * submission. A centered `DSH TUI` banner sits above a hero `<Prompt>` so the
 * input is both horizontally and vertically centered — mirroring the opencode
 * TUI's home layout (and the Web UI's empty-session hero, per the archived note
 * `2026-07-24-new-session-clears-to-empty-state.md`). No sidebar, no status bar:
 * the home page is a single focused surface. The first submission flips the
 * store's `page` to `chat` (in the runner's `onSubmit`), which swaps `<Home>`
 * for the full chat layout in `<App>`.
 *
 * The work-mode description line (copied verbatim from the active preset's
 * `preset.yml`) sits under the banner so Tab cycling is legible before the user
 * has started a session.
 *
 * @module @deepseek-ai/dsh-tui/view/components/home
 */

import { type JSX } from '@opentui/solid'
import { createMemo } from 'solid-js'
import { CHROME, ROLE_COLORS } from '../theme.js'
import { workMode } from '../modes.js'
import type { TuiStore } from '../store.js'
import { Prompt } from './prompt.js'
import type { CommandEntry } from './command-palette.js'
import type { MentionEntry } from './mention-menu.js'

/** Props for {@link Home}. */
export interface HomeProps {
  /** The reactive store the banner + prompt read. */
  store: TuiStore
  /** Fired when the user submits a task line (the runner flips page → chat). */
  onSubmit: (text: string) => void
  /** Fired when the user presses Tab to cycle the work mode. */
  onCycleMode?: () => void
  /** Command entries for the slash-autocomplete menu. */
  commands?: readonly CommandEntry[]
  /** Resolves @-mention candidates (files + sessions). */
  resolveMentions?: (query: string) => Promise<readonly MentionEntry[]>
}

/**
 * Render the home page: a vertically + horizontally centered `DSH TUI` banner
 * with the active work-mode description beneath it, and the hero `<Prompt>`
 * below that. The prompt is `focused` so the user can type immediately.
 * @param props - the home props.
 * @returns the JSX element for the home page.
 */
export function Home(props: HomeProps): JSX.Element {
  const modeDef = createMemo(() => workMode(props.store.mode()))
  return (
    <box flexDirection="column" flexGrow={1} alignItems="center" justifyContent="center">
      <text fg={ROLE_COLORS.assistant}><b>DSH TUI</b></text>
      <text fg={CHROME.textMuted}> {modeDef()?.name ?? ''} — {modeDef()?.description ?? ''} </text>
      <box height={1} />
      <Prompt
        store={props.store}
        onSubmit={props.onSubmit}
        hero
        {...props.onCycleMode === undefined ? {} : { onCycleMode: props.onCycleMode }}
        {...props.commands === undefined ? {} : { commands: props.commands }}
        {...props.resolveMentions === undefined ? {} : { resolveMentions: props.resolveMentions }}
      />
    </box>
  )
}
