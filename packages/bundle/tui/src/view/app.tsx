/**
 * The `<App>` root: the top-level component for the OpenTUI view layer. Reads
 * the reactive {@link TuiStore} signals and renders the transcript (messages +
 * tool cards interleaved per turn), the todo/plan projections when non-empty,
 * and the `<Prompt>` at the bottom.
 *
 * The transcript is a `<scrollbox stickyScroll stickyStart="bottom">` so the
 * view tracks the latest content as it streams. v1 renders messages then tools
 * per turn (a merged chronological list is deferred).
 *
 * @module @deepseek-ai/dsh-tui/view/app
 */

import { type JSX } from '@opentui/solid'
import { For, createMemo } from 'solid-js'
import type { TuiStore } from './store.js'
import { Message } from './components/message.js'
import { ToolCard } from './components/tool-card.js'
import { Plan, Todos } from './components/projections.js'
import { Prompt } from './components/prompt.js'

process.stderr.write('[app] MODULE LOADED\n')

/** Props for {@link App}. */
export interface AppProps {
  /** The reactive store the components read. */
  store: TuiStore
  /** Fired when the user submits a task line (no pending question). */
  onSubmit: (text: string) => void
}

/**
 * Render the app root: transcript scrollbox + projections + prompt. The
 * transcript interleaves messages and tool cards; for v1 each turn's messages
 * render before its tools (a merged chronological list is deferred).
 *
 * The todos/plan projections use memo-conditionals (not `<Show>`) because the
 * OpenTUI Solid reconciler emits a stray empty text node for `<Show>`'s falsy
 * branch that orphans under the non-text `<scrollbox>` parent.
 * @param props - the app props.
 * @returns the JSX element for the app root.
 */
export function App(props: AppProps): JSX.Element {
  const todosBlock = createMemo(() => <Todos todos={props.store.state.todos} />)
  return (
    <box>
      <scrollbox stickyScroll stickyStart="bottom">
        <For each={props.store.state.messages}>
          {message => <Message entry={message} />}
        </For>
        <For each={props.store.state.tools}>
          {tool => <ToolCard tool={tool} />}
        </For>
        {todosBlock()}
        <Plan active={props.store.state.planActive} />
      </scrollbox>
      <Prompt store={props.store} onSubmit={props.onSubmit} />
    </box>
  )
}

/**
 * Build the root factory the renderer mounts. The runner (a non-JSX, tsdown-
 * bundled module) cannot write JSX itself, so this factory closes over the
 * store and the submit handler and returns the `() => JSX.Element` the
 * `@opentui/solid` `render` expects. The runner imports this via a dynamic
 * `await import('./view/app.js')` so tsdown leaves the reference unresolved
 * and Bun.build (which produces `lib/view/app.js`) supplies it at runtime.
 * @param store - the reactive store the components read.
 * @param onSubmit - fired when the user submits a task line.
 * @returns a root factory returning the app JSX element.
 */
export function createAppRoot(store: TuiStore, onSubmit: (text: string) => void): () => JSX.Element {
  return () => <App store={store} onSubmit={onSubmit} />
}
