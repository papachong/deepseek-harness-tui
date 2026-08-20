/**
 * Session projections renderer: renders the `todos` and `plan` projections
 * (from `Session.surface` / `todo/write` events) to terminal sidebars.
 * Phase 2 ships a compact line-list; a scrollable panel is deferred.
 *
 * @module @deepseek-ai/dsh-tui/render/projections
 */

import type { TodoItem } from '@deepseek-ai/dsh-session'

/** ANSI SGR helpers. */
const SGR = (code: string): string => `\x1b[${code}m`
const RESET = SGR('0')
const BOLD = SGR('1')
const DIM = SGR('2')
const GREEN = SGR('32')
const YELLOW = SGR('33')
const CYAN = SGR('36')

/**
 * Render the todo list projection.
 * @param todos - the todo snapshot to render.
 * @returns the ANSI-styled todo list, or empty string when no todos.
 */
export function renderTodos(todos: readonly TodoItem[]): string {
  if (todos.length === 0) return ''
  const lines = [`${BOLD}[todos]${RESET}`]
  for (const todo of todos) {
    const mark = todo.status === 'completed' ? '[x]' : todo.status === 'in_progress' ? '[~]' : '[ ]'
    const color = todo.status === 'completed' ? GREEN : todo.status === 'in_progress' ? YELLOW : RESET
    lines.push(`${color}  ${mark} ${todo.content}${RESET}`)
  }
  return lines.join('\n')
}

/**
 * Render the plan projection (markdown).
 * @param plan - the plan markdown, or undefined when no plan is active.
 * @returns the ANSI-styled plan block, or empty string when absent.
 */
export function renderPlan(plan: string | undefined): string {
  if (plan === undefined || plan === '') return ''
  const lines = [`${BOLD}${CYAN}[plan]${RESET}`]
  for (const line of plan.split('\n')) {
    lines.push(`${DIM}  ${line}${RESET}`)
  }
  return lines.join('\n')
}
