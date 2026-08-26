/**
 * In-process answerers for the TUI: an `approval/request` waterfall listener
 * and a `UserQuestionService` provider. Both render the question as a
 * transcript message via the store and await the answer through the store's
 * `awaitAnswer()` promise (the `<Prompt>` component resolves it).
 *
 * This is the v1 answer to the OpenTUI raw-mode vs readline conflict
 * (design-confirm): OpenTUI's `createCliRenderer()` takes stdin into raw mode
 * (DSR query + keymap), so Node's readline line events stop firing and echo
 * breaks. The answerers cannot read from `stdin.input.readLine()` once the
 * renderer owns raw mode. Instead, they push a pending question into the store
 * (rendered as a transcript message) and return the `awaitAnswer()` promise;
 * `<Prompt>` switches to answer mode and routes the submitted line via
 * `resolveAnswer()`.
 *
 * @module @ruhooai/dsh-tui/answerers
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type { AskUserQuestionAnswer, AskUserQuestionItem, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import { UserQuestionError } from '@deepseek-ai/dsh-user-questions'
import type { TuiStore } from './view/store.js'

/** The store-backed answer surface shared by the REPL prompt and the answerers. */
export interface StoreAnswerAccess {
  /**
   * The reactive store. Answerers push a pending question into it via
   * `awaitAnswer()` and return the promise; the `<Prompt>` component resolves
   * it via `resolveAnswer()` when the user submits a line in answer mode.
   */
  store: TuiStore
}

/**
 * Register the approval answerer. Pushes the approval question into the store
 * via `awaitAnswer()` and awaits the answer (the `<Prompt>` resolves it). Reads
 * a `y`/`n` (or `yes`/`no`) answer, returns `'allowed-once'` / `'rejected'`,
 * or `'cancelled'` when the store cannot resolve (the store returns an empty
 * string on disposal — treated as a cancellation).
 * @param ctx - the root context carrying `ctx.approval`.
 * @param access - the store-backed answer surface.
 * @returns a disposer removing the listener.
 */
export function registerApprovalAnswerer(ctx: Context, access: StoreAnswerAccess): () => void {
  return ctx.on('approval/request', async (req: ApprovalRequest, _next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome> => {
    // Abort already fired before dispatch: settle synchronously (mirror
    // api-proxy.ts:1396).
    if (req.signal?.aborted === true) return 'cancelled'
    const label = req.callId === undefined ? req.toolName : `${req.toolName} (${req.callId})`
    const question = `[approval] ${label}: ${req.reason ?? 'allow this action?'} [y/n]`
    const answer = await access.store.awaitAnswer(question)
    const trimmed = answer.trim().toLowerCase()
    if (trimmed === 'y' || trimmed === 'yes') return 'allowed-once'
    return 'rejected'
  })
}

/**
 * Register the user-questions provider. Renders each question into the store
 * via `awaitAnswer()` and reads the selection through the `<Prompt>`.
 * Single-select picks by index or label; a question with no options reads free
 * text. `plan-review` intent renders the plan and treats the approve option
 * specially.
 * @param ctx - the root context carrying `ctx.userQuestions`.
 * @param access - the store-backed answer surface.
 * @returns a disposer removing the provider.
 */
export function registerUserQuestionProvider(ctx: Context, access: StoreAnswerAccess): () => void {
  const dispose = ctx.userQuestions.registerProvider({
    async ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> {
      const sessionId = request.agent?.id
      if (sessionId === undefined) {
        return Promise.reject(new UserQuestionError(
          'tui user-questions requires an agent-owned session', 'ASK_MISSING_AGENT'))
      }
      const answers = await Promise.all(request.questions.map(q => answerOne(access.store, q)))
      return { answers }
    },
  })
  return () => {
    dispose()
  }
}

/**
 * Answer one question: render it into the store, await the answer through the
 * `<Prompt>`, return the answer item.
 * @param store - the reactive store exposing `awaitAnswer()`.
 * @param q - the question to answer.
 * @returns the answer item carrying the selected labels (and any custom text).
 */
async function answerOne(store: TuiStore, q: AskUserQuestionItem): Promise<{ id: string; selected: string[]; custom?: string }> {
  const lines: string[] = [`[question] ${q.question}`]
  if (q.detail !== undefined) lines.push(q.detail)
  if (q.options === undefined || q.options.length === 0) {
    const text = await store.awaitAnswer(`${lines.join('\n')}\n> `)
    return { id: q.id, selected: [], custom: text }
  }
  q.options.forEach((opt, i) => {
    const desc = opt.description === undefined ? '' : ` — ${opt.description}`
    lines.push(`  ${i + 1}. ${opt.label}${desc}`)
  })
  const hint = q.multiSelect === true ? 'one or more (comma-separated)' : 'one'
  const text = await store.awaitAnswer(`${lines.join('\n')}\nSelect ${hint}> `)
  const picks = text.split(',').map(s => s.trim()).filter(s => s !== '')
  const selected: string[] = []
  let custom: string | undefined
  for (const pick of picks) {
    const idx = Number(pick)
    if (Number.isInteger(idx) && idx >= 1 && idx <= q.options.length) {
      const opt = q.options[idx - 1]
      if (opt !== undefined) selected.push(opt.label)
    } else {
      const match = q.options.find(o => o.label.toLowerCase() === pick.toLowerCase())
      if (match !== undefined) selected.push(match.label)
      else custom = pick
    }
  }
  return { id: q.id, selected, ...(custom !== undefined ? { custom } : {}) }
}
