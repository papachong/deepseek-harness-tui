/**
 * The `<Prompt>` component: the OpenTUI REPL input that owns task submission
 * and pending-question routing. Replaces the readline REPL loop for the render
 * path.
 *
 * OpenTUI's `createCliRenderer()` takes stdin into raw mode (DSR query + keymap),
 * so Node's readline cannot coexist. The design-confirm v1 resolution: the
 * approval/ask-user answerers push a pending question into the store via
 * `awaitAnswer()` and return its promise; `<Prompt>` switches to answer mode
 * when `pendingQuestion()` is set and routes `onSubmit` to resolve it. When no
 * question is pending, `onSubmit` drives the REPL task.
 *
 * Visual: a top-bordered box with a colored `❯` prefix (cyan in task mode,
 * magenta in plan mode) and a dim placeholder. The pending-question banner
 * renders above the input with a `Q:` prefix.
 *
 * NOTE: uses a memo-conditional instead of `<Show>` for the banner — the
 * OpenTUI Solid reconciler emits a stray empty text node for `<Show>`'s falsy
 * branch that orphans under a non-text parent.
 *
 * @module @deepseek-ai/dsh-tui/view/components/prompt
 */

import { type JSX } from '@opentui/solid'
import { createMemo, createSignal, type Accessor } from 'solid-js'
import type { TextareaRenderable, KeyEvent } from '@opentui/core'
import { CHROME, ROLE_COLORS, STATUS_COLORS } from '../theme.js'
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
 * rendered above the input with a `Q:` prefix, the placeholder reads
 * `answer> `, and the submitted line resolves the pending answer; otherwise
 * the placeholder reads `task> ` (or `plan> ` in plan mode) and the submitted
 * line fires {@link PromptProps.onSubmit}. A colored `❯` prefix sits left of
 * the input; its color tracks the mode (cyan task, magenta plan, yellow answer).
 * @param props - the prompt props.
 * @returns the JSX element for the prompt input.
 */
export function Prompt(props: PromptProps): JSX.Element {
  const isAnswer = createMemo(() => props.store.pendingQuestion() !== undefined)
  const isPlan = createMemo(() => props.store.state.planActive)
  const prefixColor = createMemo(() =>
    isAnswer() ? STATUS_COLORS.pending : isPlan() ? '#c678dd' : ROLE_COLORS.user,
  )
  const placeholder = createMemo(() =>
    isAnswer() ? 'answer> ' : isPlan() ? 'plan> ' : 'task> ',
  ) as Accessor<string>

  const handleSubmit = (value: string): void => {
    if (props.store.resolveAnswer(value)) return
    recordHistory(value)
    props.onSubmit(value)
  }

  const [inputEl, setInputEl] = createSignal<TextareaRenderable | undefined>(undefined)
  // Track the live content via onContentChange so submit can read the current
  // value without reaching into the textarea's internal edit buffer.
  const [liveValue, setLiveValue] = createSignal('')
  // Session-scoped input history: ↑/↓ navigates previously submitted lines.
  // Stored in a signal array local to this Prompt instance (one per process,
  // matching the single-session TUI). `cursor` is the index into history while
  // navigating; `null` means "at the live input" (not navigating).
  const [history, setHistory] = createSignal<string[]>([])
  let historyCursor: number | null = null
  let draftBeforeNav = ''

  const navigateHistory = (direction: 'up' | 'down'): void => {
    const el = inputEl()
    if (el === undefined) return
    const items = history()
    if (items.length === 0) return
    if (direction === 'up') {
      if (historyCursor === null) {
        historyCursor = items.length - 1
        draftBeforeNav = liveValue()
      } else if (historyCursor > 0) {
        historyCursor -= 1
      } else {
        return
      }
      el.editBuffer.setText(items[historyCursor] ?? '')
      setLiveValue(items[historyCursor] ?? '')
    } else {
      if (historyCursor === null) return
      if (historyCursor >= items.length - 1) {
        historyCursor = null
        el.editBuffer.setText(draftBeforeNav)
        setLiveValue(draftBeforeNav)
      } else {
        historyCursor += 1
        el.editBuffer.setText(items[historyCursor] ?? '')
        setLiveValue(items[historyCursor] ?? '')
      }
    }
  }

  const recordHistory = (line: string): void => {
    const trimmed = line.trim()
    if (trimmed === '') return
    setHistory(prev => trimmed === prev[prev.length - 1] ? prev : [...prev, trimmed])
    historyCursor = null
    draftBeforeNav = ''
  }

  const banner = createMemo<JSX.Element>(() => {
    const question = props.store.pendingQuestion()
    return question === undefined
      ? undefined
      : (
        <box paddingLeft={1} flexDirection="row">
          <text fg={STATUS_COLORS.pending}><b>Q </b></text>
          <text fg={CHROME.text}>{question}</text>
        </box>
      )
  })

  return (
    <box border={['top']} borderStyle="single" borderColor={CHROME.border} paddingTop={0} paddingBottom={0}>
      {banner()}
      <box paddingLeft={1} flexDirection="row">
        <text fg={prefixColor()}><b>❯ </b></text>
        <textarea
          ref={(el: TextareaRenderable) => { setInputEl(el) }}
          focused
          minHeight={1}
          maxHeight={6}
          placeholder={placeholder()}
          onContentChange={() => { const v = inputEl()?.editBuffer.getText() ?? ''; setLiveValue(v); historyCursor = null }}
          onKeyDown={(key: KeyEvent) => {
            if (key.name === 'up' || (key.ctrl && key.name === 'p')) {
              navigateHistory('up')
              key.preventDefault()
            } else if (key.name === 'down' || (key.ctrl && key.name === 'n')) {
              navigateHistory('down')
              key.preventDefault()
            }
          }}
          onSubmit={() => {
            const value = liveValue()
            handleSubmit(value)
          }}
        />
      </box>
    </box>
  )
}
