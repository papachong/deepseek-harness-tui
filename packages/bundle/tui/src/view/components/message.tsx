/**
 * The `<Message>` component: renders one assistant {@link MessageEntry} as a
 * streaming markdown block, mirroring opencode's TextPart. Uses OpenTUI's
 * `<markdown streaming>` so the renderer folds streaming chunks itself — the
 * store accumulates the text, and this component hands it to the markdown
 * renderable with `streaming={entry.streaming}` so the trailing block stays
 * unstable until `assistant/message` flips the flag off.
 *
 * An empty-but-streaming message shows a one-dots spinner placeholder so the
 * user sees activity before the first delta lands.
 *
 * NOTE: this component uses a memo-conditional instead of `<Show>` because the
 * OpenTUI Solid reconciler emits a stray empty text node for `<Show>`'s falsy
 * branch, which orphans under a non-text parent (`<box>`/`<scrollbox>`) and
 * raises "Orphan text error". Returning `undefined` from a memo avoids the
 * stray node.
 *
 * @module @deepseek-ai/dsh-tui/view/components/message
 */

import { SyntaxStyle } from '@opentui/core'
import { type JSX } from '@opentui/solid'
import { createMemo } from 'solid-js'
import type { MessageEntry } from '../store.js'

/**
 * Module-level cached {@link SyntaxStyle}. Created once per process (not per
 * render) — `SyntaxStyle.create()` allocates a native handle, so recreating it
 * on every chunk would leak and stall the FFI.
 */
const SYNTAX_STYLE = SyntaxStyle.create()

/** Props for {@link Message}. */
export interface MessageProps {
  /** The assistant message entry to render. */
  entry: MessageEntry
}

/**
 * Render one assistant message as a streaming markdown block. The outer `<box>`
 * pads the message from the transcript edge (left) and from the prior block
 * (top). When the entry has no text yet but is still streaming, a spinner
 * placeholder (`…`) is shown instead of an empty markdown block (an empty
 * `<markdown>` would render nothing and the user would see no activity).
 * @param props - the message props.
 * @returns the JSX element for the message.
 */
export function Message(props: MessageProps): JSX.Element {
  const showMarkdown = createMemo(() => props.entry.text !== '' || !props.entry.streaming)
  const body = createMemo<JSX.Element>(() =>
    showMarkdown()
      ? (
        <markdown
          streaming={props.entry.streaming}
          internalBlockMode="top-level"
          content={props.entry.text}
          tableOptions={{ style: 'grid' }}
          syntaxStyle={SYNTAX_STYLE}
          conceal
        />
      )
      : <text fg="gray">…</text>,
  )
  return (
    <box paddingLeft={3} marginTop={1}>
      {body()}
    </box>
  )
}
