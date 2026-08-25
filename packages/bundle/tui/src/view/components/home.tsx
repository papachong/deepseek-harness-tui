/**
 * The `<Home>` component: the landing surface shown before the first
 * submission. Mirrors opencode's `routes/home.tsx` layout: the two-tone DSH
 * TUI wordmark sits above a max-width-constrained hero `<Prompt>`, centered
 * with `flexGrow` spacers, and a footer bar echoes the working directory and
 * the active mode + shortcut hints at the bottom edge.
 *
 * The work-mode description line (copied verbatim from the active preset's
 * `preset.yml`) sits under the wordmark so Tab cycling is legible before the
 * user has started a session. The first submission flips the store's `page`
 * to `chat` (in the runner's `onSubmit`), which swaps `<Home>` for the full
 * chat layout in `<App>`.
 *
 * The prompt box carries the opencode chrome: `backgroundColor` =
 * `bgElement`, a left `SplitBorder` vertical rule, and a meta row under the
 * textarea (mode name + model id). No sidebar, no status bar.
 *
 * @module @deepseek-ai/dsh-tui/view/components/home
 */

import { type JSX, useTerminalDimensions } from '@opentui/solid'
import { createMemo } from 'solid-js'
import { CHROME } from '../theme.js'
import { workMode } from '../modes.js'
import { t } from '../i18n.js'
import { Logo } from '../logo.js'
import type { TuiStore } from '../store.js'
import { Prompt } from './prompt.js'
import type { CommandEntry } from './command-palette.js'
import type { MentionEntry } from './mention-menu.js'

/** The default max width of the hero prompt (opencode's `prompt.max_width`). */
const DEFAULT_PROMPT_MAX_WIDTH = 75
/**
 * The fraction of the terminal width the prompt may occupy when it exceeds
 * the floor — opencode uses `Math.max(75, width * 0.7)` for the auto value.
 */
const PROMPT_WIDTH_FRACTION = 0.7

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
 * Render the home page: the DSH TUI wordmark and mode description centered
 * in the upper half, the hero `<Prompt>` (max-width-constrained, elevated
 * background) beneath it, and a footer bar with the working directory on the
 * left and mode + shortcut hints on the right. The prompt is `focused` so
 * the user can type immediately.
 * @param props - the home props.
 * @returns the JSX element for the home page.
 */
export function Home(props: HomeProps): JSX.Element {
  const modeDef = createMemo(() => workMode(props.store.state.mode))
  const dimensions = useTerminalDimensions()
  // opencode's prompt max_width: configured value, or auto = max(75, 70% of
  // the terminal width). A narrower column keeps the input visually centered
  // instead of stretching edge-to-edge on wide terminals.
  const promptMaxWidth = createMemo(() =>
    Math.max(DEFAULT_PROMPT_MAX_WIDTH, Math.floor(dimensions().width * PROMPT_WIDTH_FRACTION)),
  )
  const modelLabel = createMemo(() => {
    const m = props.store.model()
    return m.model === '' ? '' : m.model
  })
  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexGrow={1} alignItems="center" paddingLeft={2} paddingRight={2}>
        {/* Upper spacers push the wordmark to roughly the upper third. */}
        <box flexGrow={1} minHeight={0} />
        <box height={4} minHeight={0} flexShrink={1} />
        <box flexShrink={0}>
          <Logo />
        </box>
        <box height={1} minHeight={0} flexShrink={1} />
        {/* Active work-mode tagline and badge so Tab cycling is legible pre-session. */}
        <box flexShrink={0} flexDirection="row" gap={1} alignItems="center">
          <text fg={CHROME.borderActive} attributes={1}>[{modeDef()?.name() ?? 'standard'}]</text>
          <text fg={CHROME.textMuted}>{modeDef()?.description() ?? ''}</text>
        </box>
        <box height={1} minHeight={0} flexShrink={1} />
        {/* Hero prompt: full width of the centered column, capped at
            promptMaxWidth so it never stretches edge-to-edge. */}
        <box width="100%" maxWidth={promptMaxWidth()} zIndex={1000} paddingTop={1} flexShrink={0}>
          <Prompt
            store={props.store}
            onSubmit={props.onSubmit}
            hero
            {...props.onCycleMode === undefined ? {} : { onCycleMode: props.onCycleMode }}
            {...props.commands === undefined ? {} : { commands: props.commands }}
            {...props.resolveMentions === undefined ? {} : { resolveMentions: props.resolveMentions }}
          />
        </box>
        {/* Quick action shortcuts matching opencode's home tips bar. */}
        <box width="100%" maxWidth={promptMaxWidth()} alignItems="center" paddingTop={2} flexShrink={1}>
          <box flexDirection="row" gap={2} justifyContent="center">
            <box flexDirection="row" gap={1}>
              <text fg={CHROME.borderActive} bg={CHROME.bgElement}> Tab </text>
              <text fg={CHROME.textMuted}>mode</text>
            </box>
            <box flexDirection="row" gap={1}>
              <text fg={CHROME.borderActive} bg={CHROME.bgElement}> Ctrl+P </text>
              <text fg={CHROME.textMuted}>palette</text>
            </box>
            <box flexDirection="row" gap={1}>
              <text fg={CHROME.borderActive} bg={CHROME.bgElement}> Ctrl+S </text>
              <text fg={CHROME.textMuted}>sessions</text>
            </box>
            <box flexDirection="row" gap={1}>
              <text fg={CHROME.borderActive} bg={CHROME.bgElement}> / </text>
              <text fg={CHROME.textMuted}>commands</text>
            </box>
            <box flexDirection="row" gap={1}>
              <text fg={CHROME.borderActive} bg={CHROME.bgElement}> @ </text>
              <text fg={CHROME.textMuted}>mention</text>
            </box>
          </box>
        </box>
        <box flexGrow={1} minHeight={0} />
      </box>
      {/* Footer bar: cwd on the left, mode + model + shortcuts on the right,
          matching opencode's session footer split layout. */}
      <box width="100%" flexShrink={0} flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2} paddingBottom={1} paddingTop={1}>
        <text fg={CHROME.textMuted}>{process.cwd()}</text>
        <box flexDirection="row" gap={2}>
          <text fg={CHROME.textMuted}>{modeDef()?.name() ?? 'standard'}</text>
          {modelLabel() === '' ? undefined : <text fg={CHROME.textMuted}>{modelLabel()}</text>}
          <text fg={CHROME.textMuted}>{t('home.footer')}</text>
        </box>
      </box>
    </box>
  )
}
