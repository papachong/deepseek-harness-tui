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
import { createMemo, createSignal, createEffect, type Accessor } from 'solid-js'
import type { TextareaRenderable, KeyEvent } from '@opentui/core'
import { CHROME, ROLE_COLORS, STATUS_COLORS } from '../theme.js'
import type { TuiStore } from '../store.js'
import { SlashMenu } from './slash-menu.js'
import { MentionMenu } from './mention-menu.js'
import type { CommandEntry } from './command-palette.js'
import type { MentionEntry } from './mention-menu.js'
/** Props for {@link Prompt}. */
export interface PromptProps {
  /** The store exposing `pendingQuestion()` for answer-mode routing. */
  store: TuiStore
  /** Fired with the submitted line when no pending question is active (REPL task). */
  onSubmit: (text: string) => void
  /** Fired when the user requests the command palette (Ctrl-P). */
  onOpenPalette?: () => void
  /** Fired when the user presses Tab to cycle the work mode (runner rebuilds). */
  onCycleMode?: () => void
  /** Hero layout (home page): no top border, centered by the parent `<Home>`. */
  hero?: boolean
  /** When true, the prompt re-acquires focus (app hands it back from sidebar). */
  shouldFocus?: Accessor<boolean>
  /** Command entries for the slash-autocomplete menu (`/compact` `/goal` …). */
  commands?: readonly CommandEntry[]
  /** Resolves @-mention candidates (files + sessions) for the prompt menu. */
  resolveMentions?: (query: string) => Promise<readonly MentionEntry[]>
}

/**
 * Render the prompt. When a pending question exists, the question text is
 * rendered above the input with a `Q:` prefix, the placeholder reads
 * `answer> `, and the submitted line resolves the pending answer; otherwise
 * the placeholder reads `task> ` (or `plan> ` in plan mode) and the submitted
 * line fires {@link PromptProps.onSubmit}. A colored `❯` prefix sits left of
 * the input; its color tracks the mode (cyan task, magenta plan, yellow answer).
 * The `hero` prop drops the top border for the centered home layout.
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
  // When the app hands focus back to the prompt (e.g. after sidebar nav),
  // call `.focus()` on the textarea. OpenTUI has no focusManager, so the app
  // owns the region toggle and signals it via `shouldFocus`.
  createEffect(() => {
    if (props.shouldFocus?.() === true) inputEl()?.focus()
  })
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

  // Slash-command autocomplete: when the live value starts with `/`, render the
  // `<SlashMenu>` above the input. The menu reads `liveValue` + `commands` to
  // filter; `↑`/`↓` move, `Enter` completes (replaces the prompt's content
  // with `/name `), `Esc` closes. The textarea forwards `↑`/`↓`/`Enter`/`Esc`
  // to the menu when it is open so focus never leaves the input.
  const slashOpen = createMemo(() => props.commands !== undefined && liveValue().trimStart().startsWith('/'))
  const completeSlash = (text: string): void => {
    const el = inputEl()
    if (el !== undefined) el.editBuffer.setText(text)
    setLiveValue(text)
  }
  const slashMenu = createMemo<JSX.Element>(() => {
    if (!slashOpen() || props.commands === undefined) return undefined
    return (
      <SlashMenu
        value={liveValue()}
        commands={props.commands}
        onComplete={completeSlash}
        onClose={() => { /* value no longer starts with `/` → menu hides */ }}
      />
    )
  })

  // @-mention autocomplete: when the live value contains an `@` token (per the
  // file-reference grammar's `activeAtToken`), resolve candidates via the
  // runner's `resolveMentions` (files from ctx.fileReferences + sessions from
  // the sidebar list). `↑`/`↓` move, `Enter` inserts the mention, `Esc` closes.
  // The query is the text after `@` (or empty for `@` alone).
  const [mentionEntries, setMentionEntries] = createSignal<readonly MentionEntry[]>([])
  const mentionQuery = createMemo(() => {
    const v = liveValue()
    const at = v.lastIndexOf('@')
    if (at === -1) return undefined
    const after = v.slice(at + 1)
    // Only treat as a mention token if the char before `@` is a boundary
    // (start, whitespace) — mirrors activeAtToken's email guard.
    if (at > 0 && !/\s/.test(v[at - 1] ?? '')) return undefined
    // Stop if the token contains a space (already completing a quoted path).
    if (/\s/.test(after) && !after.startsWith('"')) return undefined
    return after.replace(/^"/, '')
  })
  const mentionOpen = createMemo(() => mentionQuery() !== undefined && props.resolveMentions !== undefined)
  // Debounce-ish: re-resolve when the query settles. createEffect re-runs on
  // each query change; the runner's resolver is async and may abort stale
  // calls (fileReferences.list takes an AbortSignal).
  createEffect(() => {
    const q = mentionQuery()
    if (q === undefined || props.resolveMentions === undefined) { setMentionEntries([]); return }
    void props.resolveMentions(q).then(setMentionEntries)
  })
  const completeMention = (insert: string): void => {
    const el = inputEl()
    const v = liveValue()
    const at = v.lastIndexOf('@')
    if (el !== undefined && at !== -1) {
      el.editBuffer.setText(v.slice(0, at) + insert)
      setLiveValue(v.slice(0, at) + insert)
    }
  }
  const mentionMenu = createMemo<JSX.Element>(() => {
    if (!mentionOpen()) return undefined
    return (
      <MentionMenu
        query={mentionQuery() ?? ''}
        entries={mentionEntries()}
        onComplete={completeMention}
        onClose={() => setMentionEntries([])}
      />
    )
  })

  const menuOpen = createMemo(() => slashOpen() || mentionOpen())

  return (
    <box
      {...(props.hero === true
        ? {}
        : { border: ['top'] as const, borderStyle: 'single' as const, borderColor: CHROME.border, paddingTop: 0, paddingBottom: 0 })}
    >
      {banner()}
      {slashMenu()}
      {mentionMenu()}
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
            // Tab cycles the work mode (the runner rebuilds the agent); the
            // textarea would otherwise insert a literal Tab, so prevent it.
            if (key.name === 'tab' && props.onCycleMode !== undefined) {
              props.onCycleMode()
              key.preventDefault()
              return
            }
            // When a menu (slash or @-mention) is open, `↑`/`↓`/`Enter`/`Esc`
            // belong to it. The menus' onKeyDown handlers sit on the parent
            // `<box>`s; key events bubble from the focused textarea to them.
            // Forward only when a menu is visible so navigation/submit do not
            // also fire.
            if (menuOpen() && (key.name === 'up' || key.name === 'down' || key.name === 'return' || key.name === 'enter' || key.name === 'escape')) {
              if (key.name === 'escape' && slashOpen()) {
                const stripped = liveValue().replace(/^\s*\//, '')
                setLiveValue(stripped)
                if (inputEl() !== undefined) inputEl()?.editBuffer.setText(stripped)
              }
              key.preventDefault()
              return
            }
            if (key.name === 'up' || (key.ctrl && key.name === 'p')) {
              // Ctrl-P with no history → open the command palette instead.
              if (key.ctrl && key.name === 'p' && history().length === 0 && props.onOpenPalette !== undefined) {
                props.onOpenPalette()
                key.preventDefault()
                return
              }
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
