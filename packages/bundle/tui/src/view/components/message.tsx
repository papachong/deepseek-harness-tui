/**
 * The `<Message>` component: renders one {@link MessageEntry} (user or
 * assistant) as a bordered block with a role-colored left border, prefix glyph,
 * streaming markdown body, optional reasoning block, and a usage footer.
 *
 * Mirrors opencode's UserMessage/AssistantMessage/ReasoningPart/TextPart layout
 * but against the local store (no opencode SDK coupling): the role discriminant
 * drives border color and prefix; reasoning renders as a dim collapsed block;
 * usage renders as a muted `↑in ↓out` footer; interrupted renders a red tag;
 * streaming shows a `▋` cursor instead of a static placeholder.
 *
 * NOTE: uses memo-conditionals instead of `<Show>` — the OpenTUI Solid
 * reconciler emits a stray empty text node for `<Show>`'s falsy branch that
 * orphans under a non-text parent (`<box>`/`<scrollbox>`).
 *
 * @module @deepseek-ai/dsh-tui/view/components/message
 */

import { type JSX } from '@opentui/solid'
import { createMemo } from 'solid-js'
import { ROLE_COLORS, ROLE_PREFIX, CHROME, SYNTAX_THEME, STATUS_COLORS } from '../theme.js'
import { Spinner } from './spinner.js'
import type { MessageEntry } from '../store.js'

/** Props for {@link Message}. */
export interface MessageProps {
  /** The message entry to render (user or assistant). */
  entry: MessageEntry
}

/**
 * Render one message as a bordered block. The outer `<box>` has a left border
 * colored by role; the body is streaming markdown (assistant) or plain text
 * (user). When the entry has reasoning, a dim block renders above the body.
 * A usage footer and interrupted tag render when present.
 * @param props - the message props.
 * @returns the JSX element for the message.
 */
export function Message(props: MessageProps): JSX.Element {
  const role = createMemo(() => props.entry.role)
  const borderColor = createMemo(() => ROLE_COLORS[role()])
  const prefix = createMemo(() => ROLE_PREFIX[role()])
  const showMarkdown = createMemo(() => props.entry.text !== '' || !props.entry.streaming)
  const showReasoning = createMemo(() => props.entry.reasoning !== undefined && props.entry.reasoning !== '')
  const showUsage = createMemo(() => props.entry.usage !== undefined)
  const showInterrupted = createMemo(() => props.entry.interrupted === true)

  const reasoningBlock = createMemo<JSX.Element>(() => {
    if (!showReasoning()) return undefined
    return (
      <box paddingLeft={1} marginTop={0} marginBottom={0}>
        <text fg={CHROME.textMuted}><i>💭 thought</i></text>
        <text fg={CHROME.textMuted}>{props.entry.reasoning}</text>
      </box>
    )
  })

  const body = createMemo<JSX.Element>(() => {
    if (!showMarkdown()) {
      return (
        <box>
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
          syntaxStyle={SYNTAX_THEME}
          conceal
        />
        {props.entry.streaming ? <text fg={borderColor()}>▋</text> : undefined}
      </box>
    )
  })

  const footer = createMemo<JSX.Element>(() => {
    if (!showUsage() && !showInterrupted()) return undefined
    const usage = props.entry.usage
    return (
      <box flexDirection="row">
        {showUsage() && usage ? <text fg={CHROME.textMuted}>  ↑{usage.inputTokens} ↓{usage.outputTokens}</text> : undefined}
        {usage?.cacheReadTokens ? <text fg={CHROME.textMuted}> ⤒{usage.cacheReadTokens}</text> : undefined}
        {showInterrupted() ? <text fg={STATUS_COLORS.error}>  [interrupted]</text> : undefined}
      </box>
    )
  })

  return (
    <box
      border={['left']}
      borderStyle="single"
      borderColor={borderColor()}
      paddingLeft={1}
      paddingRight={1}
      marginTop={1}
    >
      <text fg={borderColor()}><b>{prefix()} </b></text>
      {reasoningBlock()}
      {body()}
      {footer()}
    </box>
  )
}
