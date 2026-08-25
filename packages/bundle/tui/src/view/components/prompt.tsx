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
import { createMemo, createSignal, createEffect, onCleanup, type Accessor } from 'solid-js'
import type { TextareaRenderable, KeyEvent } from '@opentui/core'
import { CHROME, STATUS_COLORS } from '../theme.js'
import { workMode } from '../modes.js'
import type { TuiStore } from '../store.js'
import { SlashMenu, slashToken } from './slash-menu.js'
import { MentionMenu } from './mention-menu.js'
import type { CommandEntry } from './command-palette.js'
import type { MentionEntry } from './mention-menu.js'

/**
 * The left-border character for the prompt box. Mirrors opencode's
 * `SplitBorder.customBorderChars.vertical` (`┃`) so the prompt reads as a
 * raised panel against the terminal background.
 */
const PROMPT_BORDER_CHARS = {
  topLeft: '', bottomLeft: '', topRight: '', bottomRight: '',
  horizontal: ' ', bottomT: '', topT: '', cross: '', leftT: '', rightT: '',
  vertical: '┃',
}
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
 * line fires {@link PromptProps.onSubmit}. The chrome matches opencode's
 * prompt (component/prompt/index.tsx:1350-1485): a left `┃` border rule and
 * an elevated `bgElement` panel, identical on the home hero and the chat
 * page so the input reads as one persistent component across the page swap.
 * The `hero` prop is retained for call-site readability; the visual chrome
 * no longer differs by surface.
 * @param props - the prompt props.
 * @returns the JSX element for the prompt input.
 */
export function Prompt(props: PromptProps): JSX.Element {
  const isAnswer = createMemo(() => props.store.pendingQuestion() !== undefined)
  const isPlan = createMemo(() => props.store.state.planActive)
  const borderColor = createMemo(() =>
    isAnswer() ? STATUS_COLORS.pending : isPlan() ? '#c678dd' : CHROME.border,
  )
  const placeholder = createMemo(() =>
    isAnswer() ? 'answer> ' : isPlan() ? 'plan> ' : 'task> ',
  ) as Accessor<string>
  // Meta row (opencode prompt:1451-1465): the active work-mode name and the
  // model id render under the textarea so the hero and chat prompts both
  // surface the composition state without a separate status bar.
  const modeName = createMemo(() => workMode(props.store.mode())?.name ?? props.store.mode())
  const modelLabel = createMemo(() => {
    const m = props.store.model()
    return m.model === '' ? '' : m.model
  })

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
  // Slash menu is open when the value starts with `/` AND the token after it
  // has no space (i.e. the user is still typing the command name). Once the
  // command is completed (ends with ` `), the menu closes so Enter submits.
  const slashOpen = createMemo(() => {
    if (props.commands === undefined) return false
    const v = liveValue().trimStart()
    if (!v.startsWith('/')) return false
    // Still typing the command name if there's no space after the slash token.
    return !/\s/.test(v.slice(1))
  })
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
        selectedIndex={menuIndex()}
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
  const [mentionActive, setMentionActive] = createSignal(false)
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
  // Resolve @-mention candidates when the query changes. The resolver is async
  // (fileReferences.list builds a workspace index on first call); set a flag
  // so the menu renders a "…" placeholder while pending, then swaps to the
  // entries. The flag also keeps the menu mounted across re-resolves.
  createEffect(() => {
    const q = mentionQuery()
    if (q === undefined || props.resolveMentions === undefined) { setMentionEntries([]); setMentionActive(false); return }
    setMentionActive(true)
    let cancelled = false
    void props.resolveMentions(q).then((entries) => {
      if (!cancelled) { setMentionEntries(entries); setMentionActive(false) }
    }).catch(() => { if (!cancelled) setMentionActive(false) })
    onCleanup(() => { cancelled = true })
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
    // While resolving (first call indexes the workspace), show a placeholder
    // so the menu is visibly mounted rather than blank.
    if (mentionActive() && mentionEntries().length === 0) {
      return (
        <MentionMenu
          query={mentionQuery() ?? ''}
          entries={[{ kind: 'file', label: '…', insert: '' }]}
          selectedIndex={0}
          onComplete={() => {}}
          onClose={() => setMentionEntries([])}
        />
      )
    }
    return (
      <MentionMenu
        query={mentionQuery() ?? ''}
        entries={mentionEntries()}
        selectedIndex={menuIndex()}
        onComplete={completeMention}
        onClose={() => setMentionEntries([])}
      />
    )
  })

  const menuOpen = createMemo(() => slashOpen() || mentionOpen())
  // The menus render in sibling <box> elements whose onKeyDown cannot receive
  // key events from the focused textarea (OpenTUI does not bubble
  // preventDefault'd keys to parents). So the prompt owns the menu navigation
  // state and forwards ↑/↓/Enter/Esc here, dispatching to the active menu's
  // complete callback.
  const [menuIndex, setMenuIndex] = createSignal(0)
  const menuItems = createMemo<readonly { label: string; insert: string }[]>(() => {
    if (slashOpen() && props.commands !== undefined) {
      const t = slashToken(liveValue())
      const all = props.commands
      const matches = t === '' ? all : all.filter(c => c.label.toLowerCase().includes(t))
      return (matches.length > 8 ? matches.slice(0, 8) : matches).map(c => ({ label: c.label, insert: `${c.label} ` }))
    }
    return mentionEntries()
  })
  const menuMove = (delta: number): void => {
    const len = menuItems().length
    if (len === 0) return
    setMenuIndex((prev) => {
      const next = prev + delta
      if (next < 0) return 0
      if (next >= len) return len - 1
      return next
    })
  }
  // Keep menuIndex in bounds when the filtered list changes.
  createEffect(() => {
    const len = menuItems().length
    setMenuIndex(prev => prev >= len ? Math.max(0, len - 1) : prev)
  })
  const menuComplete = (): void => {
    const items = menuItems()
    const entry = items[menuIndex()]
    if (entry === undefined) return
    if (slashOpen()) {
      completeSlash(entry.insert)
    } else {
      completeMention(entry.insert)
    }
    setMenuIndex(0)
  }

  return (
    <box width="100%">
      {banner()}
      {slashMenu()}
      {mentionMenu()}
      {/*
        opencode chrome: a left SplitBorder rule + elevated backgroundElement
        panel. In non-hero (chat) mode the border and background are identical
        to the home hero so the prompt reads as one persistent component.
        The chat page previously relied on a top border here; the redesign
        moves the visual separation into the box background + left rule.
      */}
      <box
        width="100%"
        border={['left']}
        borderColor={borderColor()}
        customBorderChars={PROMPT_BORDER_CHARS}
      >
        <box
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          flexShrink={0}
          backgroundColor={CHROME.bgElement}
          flexGrow={1}
          width="100%"
        >
          <box flexDirection="row">
            <textarea
              ref={(el: TextareaRenderable) => { setInputEl(el) }}
              focused
              width="100%"
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
                // When a menu is open, it owns ↑/↓/Enter/Esc. The menus' onKeyDown
                // is on parent <box> elements, but OpenTUI delivers key events to
                // the focused textarea first; if the textarea's onKeyDown calls
                // preventDefault, the event does NOT bubble to the parent. So the
                // menu must complete/submit HERE (not rely on bubbling), and then
                // preventDefault to stop the native newline/submit.
                if (menuOpen() && (key.name === 'up' || key.name === 'down' || key.name === 'return' || key.name === 'enter' || key.name === 'kpenter' || key.name === 'escape')) {
                  key.preventDefault()
                  if (key.name === 'up') { menuMove(-1); return }
                  if (key.name === 'down') { menuMove(1); return }
                  if (key.name === 'escape') {
                    if (slashOpen()) {
                      const stripped = liveValue().replace(/^\s*\//, '')
                      setLiveValue(stripped)
                      if (inputEl() !== undefined) inputEl()?.editBuffer.setText(stripped)
                    }
                    setMentionEntries([])
                    return
                  }
                  // Enter: complete the selected menu item.
                  menuComplete()
                  return
                }
                // Bare Enter (no modifiers) submits the input. OpenTUI's
                // TextareaRenderable binds bare `return` to `newline` (not
                // `submit`), so without this interception Enter inserts a newline.
                // opencode overrides this via @opentui/keymap's managed textarea
                // layer; dsh-tui does not use that layer, so intercept here:
                // bare Enter → handleSubmit + preventDefault. Shift/Ctrl/Alt+Enter
                // inserts a newline.
                if ((key.name === 'return' || key.name === 'enter' || key.name === 'kpenter')
                  && !key.shift && !key.ctrl && !key.meta) {
                  handleSubmit(liveValue())
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
                // Fallback: the native TextareaRenderable fires onSubmit on
                // meta+return / linefeed. The bare-Enter path in onKeyDown
                // handles the common case; this covers the modifier-bound submit
                // the textarea still owns.
                const value = liveValue()
                handleSubmit(value)
              }}
            />
          </box>
          {/* Meta row: mode + model, mirroring opencode's prompt footer. */}
          <box flexDirection="row" flexShrink={0} paddingTop={1} gap={1}>
            <text fg={CHROME.textMuted}>{modeName()}</text>
            {modelLabel() === '' ? undefined : (
              <box flexDirection="row" gap={1}>
                <text fg={CHROME.textMuted}>·</text>
                <text fg={CHROME.textMuted}>{modelLabel()}</text>
              </box>
            )}
          </box>
        </box>
      </box>
    </box>
  )
}
