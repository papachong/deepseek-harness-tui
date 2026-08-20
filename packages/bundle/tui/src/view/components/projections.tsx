/**
 * The `<Todos>` and `<Plan>` projections: inline render of the todo list and
 * the plan-mode marker. A true sidebar layout is deferred (v1 renders these
 * inline in the transcript, below the message stream).
 *
 * `plan/mode` carries only `{ active: boolean }` (the SessionEventMap extension
 * is declared by dsh-plan-mode, not the base map), so `<Plan>` renders a
 * marker, not markdown. Plan markdown is not available from any single session
 * event in v1.
 *
 * NOTE: uses memo-conditionals instead of `<Show>` — the OpenTUI Solid
 * reconciler emits a stray empty text node for `<Show>`'s falsy branch that
 * orphans under a non-text parent.
 *
 * @module @deepseek-ai/dsh-tui/view/components/projections
 */

import { type JSX } from '@opentui/solid'
import { For, createMemo } from 'solid-js'
import type { TodoItem } from '@deepseek-ai/dsh-session'

/** Props for {@link Todos}. */
export interface TodosProps {
  /** The latest todo snapshot (whole-list replace). */
  todos: readonly TodoItem[]
}

/** Props for {@link Plan}. */
export interface PlanProps {
  /** True when plan mode is active (from the `plan/mode` event payload). */
  active: boolean
}

/** The status marks per todo state. */
const TODO_MARK: Record<string, string> = {
  completed: '✓',
  in_progress: '●',
  pending: '○',
}

/**
 * Render the todo list inline: each todo as one line with its status mark.
 * Empty (returns undefined) when the list is empty. Each todo is a single
 * `<text>` whose children are a colored `<text>` mark span plus the plain
 * content string — OpenTUI requires all text children to descend from a
 * `<text>`.
 * @param props - the todos props.
 * @returns the JSX element for the todos block, or undefined when empty.
 */
export function Todos(props: TodosProps): JSX.Element {
  const hasTodos = createMemo(() => props.todos.length > 0)
  return createMemo<JSX.Element>(() => {
    if (!hasTodos()) return undefined
    return (
      <box paddingLeft={3} marginTop={1}>
        <text fg="blue">todos</text>
        <For each={props.todos}>
          {(todo: TodoItem) => (
            <text>
              <text fg={colorForStatus(todo.status)}>{markForStatus(todo.status)} </text>
              {todo.content}
            </text>
          )}
        </For>
      </box>
    )
  })() as JSX.Element
}

/**
 * Render the plan-mode marker inline: a one-line indicator when plan mode is
 * active; undefined (nothing) when inactive.
 * @param props - the plan props.
 * @returns the JSX element for the plan block, or undefined when inactive.
 */
export function Plan(props: PlanProps): JSX.Element {
  return createMemo<JSX.Element>(() =>
    props.active
      ? (
        <box paddingLeft={3} marginTop={1}>
          <text fg="magenta">plan mode active</text>
        </box>
      )
      : undefined,
  )() as JSX.Element
}

/**
 * Pick the status mark for a todo status string.
 * @param status - the todo status (completed/in_progress/pending).
 * @returns the status mark glyph.
 */
function markForStatus(status: string): string {
  return TODO_MARK[status] ?? '○'
}

/**
 * Pick the foreground color for a todo status mark.
 * @param status - the todo status.
 * @returns the color name for the mark.
 */
function colorForStatus(status: string): string {
  switch (status) {
    case 'completed': return 'green'
    case 'in_progress': return 'yellow'
    case 'pending': return 'gray'
    default: return 'gray'
  }
}
