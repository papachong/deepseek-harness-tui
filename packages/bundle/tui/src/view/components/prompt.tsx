/**
 * The `<Prompt>` component: the OpenTUI REPL input that owns task submission and
 * pending-question routing. Replaces the readline REPL loop for the render path.
 *
 * OpenTUI's `createCliRenderer()` takes stdin into raw mode (DSR query + keymap),
 * so Node's readline cannot coexist. The design-confirm v1 resolution: the
 * approval/ask-user answerers push a pending question into the store via
 * `awaitAnswer()` and return its promise; `<Prompt>` switches to answer mode
 * when `pendingQuestion()` is set and routes `onSubmit` to resolve it. When no
 * question is pending, `onSubmit` drives the REPL task.
 *
 * NOTE: uses a memo-conditional instead of `<Show>` for the pending-question
 * banner — the OpenTUI Solid reconciler emits a stray empty text node for
 * `<Show>`'s falsy branch that orphans under a non-text parent.
 *
 * @module @deepseek-ai/dsh-tui/view/components/prompt
 */

import { type JSX } from '@opentui/solid'
import { createMemo, createSignal, type Accessor } from 'solid-js'
import type { InputRenderable } from '@opentui/core'
import type { TuiStore } from '../store.js'

/** Props for {@link Prompt}. */
export interface PromptProps {
  /** The store exposing `pendingQuestion()` for answer-mode routing. */
  store: TuiStore
  /** Fired with the submitted line when no pending question is active (REPL task). */
  onSubmit: (text: string) => void
}

/**
 * Render the prompt. When a pending question exists, the question text is
 * rendered above the input, the placeholder reads `answer> `, and the submitted
 * line resolves the pending answer; otherwise the placeholder reads `task> `
 * and the submitted line fires {@link PromptProps.onSubmit}.
 * @param props - the prompt props.
 * @returns the JSX element for the prompt input.
 */
export function Prompt(props: PromptProps): JSX.Element {
  const placeholder = createMemo(() =>
    props.store.pendingQuestion() !== undefined ? 'answer> ' : 'task> ',
  ) as Accessor<string>

  const handleSubmit = (value: string): void => {
    // Answer mode takes priority: if a question is pending, the submitted line
    // resolves it (approval/ask-user) and never reaches the REPL task path.
    if (props.store.resolveAnswer(value)) return
    props.onSubmit(value)
  }

  // Track the input renderable via ref so onSubmit (which fires with an empty
  // SubmitEvent) can read the current typed value. The `<input>` value prop is
  // one-way (it seeds the input); the ref is the source of truth on submit.
  const [inputEl, setInputEl] = createSignal<InputRenderable | undefined>(undefined)
  const [committedValue] = createSignal('')

  const banner = createMemo<JSX.Element>(() => {
    const question = props.store.pendingQuestion()
    return question === undefined ? undefined : <text fg="yellow">{question}</text>
  })

  return (
    <box>
      {banner()}
      <input
        ref={(el: InputRenderable) => { setInputEl(el) }}
        placeholder={placeholder()}
        onSubmit={() => {
          const value = inputEl()?.value ?? committedValue()
          handleSubmit(value)
        }}
      />
    </box>
  )
}
