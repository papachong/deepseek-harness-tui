/**
 * The `<Message>` component: renders one {@link MessageEntry} (user or
 * assistant) in opencode's transcript style. A user message is a padded panel
 * with a left `┃` rule colored by role and the panel background; an assistant
 * message is a bare indented markdown block with a `▣ · tokens · duration`
 * meta line once the step completes. Streaming shows a `▋` cursor; reasoning
 * renders as a dim collapsible header above the body.
 *
 * Mirrors opencode's `UserMessage` / `AssistantMessage` / `TextPart` layout
 * (routes/session/index.tsx:1365, 1470, 1687) against the local store: the
 * role discriminant picks the panel vs. bare-block layout; no prefix glyph
 * header line is rendered (the border color carries the role cue).
 *
 * NOTE: uses memo-conditionals instead of `<Show>` — the OpenTUI Solid
 * reconciler emits a stray empty text node for `<Show>`'s falsy branch that
 * orphans under a non-text parent (`<box>`/`<scrollbox>`).
 *
 * @module @ruhooai/dsh-tui/view/components/message
 */

import { type JSX } from '@opentui/solid'
import { createMemo, createSignal } from 'solid-js'
import { ROLE_COLORS, CHROME, buildSyntaxStyle } from '../theme.js'
import { Spinner } from './spinner.js'
import type { MessageEntry } from '../store.js'

/**
 * The left-border character for user-message panels (opencode's
 * `SplitBorder.customBorderChars`: only the vertical is a visible `┃`; the
 * corners and horizontals are empty so no box frame closes around the block).
 */
const SPLIT_BORDER_CHARS = {
  topLeft: '', bottomLeft: '', topRight: '', bottomRight: '',
  horizontal: ' ', bottomT: '', topT: '', cross: '', leftT: '', rightT: '',
  vertical: '┃',
}

/**
 * Module-level cached {@link SyntaxStyle}. Built once from the active theme's
 * syntax map; a theme swap would rebuild it. The native handle is an FFI
 * resource, so recreating it per render would leak and stall.
 */
const SYNTAX_STYLE = buildSyntaxStyle()

/** Props for {@link Message}. */
export interface MessageProps {
  /** The message entry to render (user or assistant). */
  entry: MessageEntry
}

/**
 * Render one message. The layout dispatches on the role: a user message is a
 * padded panel with a left `┃` rule (opencode's `UserMessage`, background =
 * `bgPanel`); an assistant message is a bare indented markdown block (opencode's
 * `TextPart`, `paddingLeft={3}`, no border) with a `▣ mode · model · duration`
 * meta line when the step completes. Reasoning renders as a dim collapsible
 * header above the body; a usage footer and interrupted tag render when present.
 * @param props - the message props.
 * @returns the JSX element for the message.
 */
export function Message(props: MessageProps): JSX.Element {
  const isUser = props.entry.role === 'user'
  const borderColor = ROLE_COLORS[props.entry.role]
  const showMarkdown = createMemo(() => props.entry.text !== '' || !props.entry.streaming)
  const showReasoning = createMemo(() => props.entry.reasoning !== undefined && props.entry.reasoning !== '')
  const showUsage = createMemo(() => props.entry.usage !== undefined)
  const showInterrupted = createMemo(() => props.entry.interrupted === true)
  // Reasoning collapse: default collapsed (one-line header); expandable to show
  // the full thought chain. A signal per message instance; OpenTUI has no click
  // on <text>, so the toggle is driven by a key the runner could later wire to
  // a keymap (e.g. Tab on the focused reasoning header). For now the header
  // shows the toggle glyph and the state stays collapsed until expanded.
  const [reasoningExpanded] = createSignal(false)
  // Step duration: finishedAt - startedAt (epoch ms). Undefined while
  // streaming or before both timestamps land.
  const durationMs = createMemo(() => {
    const start = props.entry.startedAt
    const end = props.entry.finishedAt
    return start !== undefined && end !== undefined ? end - start : undefined
  })

  const reasoningBlock = createMemo<JSX.Element>(() => {
    if (!showReasoning()) return undefined
    const glyph = reasoningExpanded() ? '▼' : '▶'
    return (
      <box marginBottom={1}>
        <box flexDirection="row">
          <text fg={CHROME.textMuted}><i>{glyph} thought</i></text>
          {props.entry.streaming ? <Spinner fg={CHROME.textMuted} /> : undefined}
        </box>
        {reasoningExpanded()
          ? <text fg={CHROME.textMuted}>{props.entry.reasoning}</text>
          : undefined}
      </box>
    )
  })

  const body = createMemo<JSX.Element>(() => {
    if (!showMarkdown()) {
      return (
        <box flexDirection="row">
          <Spinner fg={CHROME.textMuted} />
          <text fg={CHROME.textMuted}> thinking…</text>
        </box>
      )
    }
    return (
      <box>
        <markdown
          streaming={props.entry.streaming}
          internalBlockMode="top-level"
          content={props.entry.text}
          tableOptions={{ style: 'grid' }}
          syntaxStyle={SYNTAX_STYLE}
          conceal
        />
        {props.entry.streaming ? <text fg={borderColor}>▋</text> : undefined}
      </box>
    )
  })

  // Assistant meta line (opencode AssistantMessage:1549-1573): `▣ · tokens ·
  // duration` rendered after the last part once the step completes or is
  // interrupted. Each segment is its own <text> sibling: a <span> expression
  // child inside <text> crashes the OpenTUI reconciler ("TextNodeRenderable
  // only accepts strings…") because the spread `style` prop resolves to an
  // object child.
  const meta = createMemo<JSX.Element>(() => {
    if (props.entry.streaming && !showInterrupted()) return undefined
    if (!showUsage() && !showInterrupted() && durationMs() === undefined) return undefined
    const usage = props.entry.usage
    return (
      <box marginTop={1} flexDirection="row">
        <text fg={showInterrupted() ? CHROME.textMuted : borderColor}>▣ </text>
        {showUsage() && usage ? <text fg={CHROME.textMuted}>↑{usage.inputTokens} ↓{usage.outputTokens}</text> : undefined}
        {usage?.cacheReadTokens ? <text fg={CHROME.textMuted}> · ⤒{usage.cacheReadTokens}</text> : undefined}
        {durationMs() !== undefined ? <text fg={CHROME.textMuted}> · {formatDuration(durationMs() ?? 0)}</text> : undefined}
        {showInterrupted() ? <text fg={CHROME.textMuted}> · interrupted</text> : undefined}
      </box>
    )
  })

  // User message: padded panel with a left `┃` rule and the panel background
  // (opencode's UserMessage:1397-1420). No prefix glyph; the border color
  // carries the role cue.
  if (isUser) {
    return (
      <box
        border={['left']}
        borderColor={borderColor}
        customBorderChars={SPLIT_BORDER_CHARS}
        marginTop={1}
      >
        <box
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          backgroundColor={CHROME.bgPanel}
          flexShrink={0}
        >
          <text fg={CHROME.text}>{props.entry.text}</text>
        </box>
      </box>
    )
  }

  // Assistant message: bare indented markdown (opencode's TextPart:1692:
  // paddingLeft={3}, no border) with the meta line when the step completes.
  return (
    <box paddingLeft={3} marginTop={1} flexShrink={0}>
      {reasoningBlock()}
      {body()}
      {meta()}
    </box>
  )
}

/**
 * Format a millisecond duration as a compact human string (e.g. `1.2s`,
 * `450ms`, `12s`). Used in the message footer next to the token counts.
 * @param ms - the duration in milliseconds.
 * @returns the formatted duration string.
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m${Math.floor(seconds % 60)}s`
}
