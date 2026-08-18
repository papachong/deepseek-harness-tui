/**
 * In-process answerers for the TUI: an `approval/request` waterfall listener
 * and a `UserQuestionService` provider. Both render to stdout and read from
 * stdin, settling promises directly (no mux, no rpcId — the in-process
 * simplification of the Web BFF's `api-proxy.ts:1338-1391`).
 *
 * @module @deepseek-ai/dsh-tui/answerers
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type { AskUserQuestionAnswer, AskUserQuestionItem, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import { UserQuestionError } from '@deepseek-ai/dsh-user-questions'
import { type Interface as ReadlineInterface } from 'node:readline'

/** A shared stdin interface the REPL and answerers take turns driving. */
export interface StdinAccess {
  /** The readline interface owned by the runner; the answerer reuses it. */
  rl: ReadlineInterface
}

/**
 * Register the approval answerer. Reads a `y`/`n` (or `yes`/`no`) line from
 * stdin, returns `'allowed-once'` / `'rejected'`, or `'cancelled'` on EOF.
 * Calls `next()` only is not needed: the handler resolves the outcome itself
 * and returns it to claim the request (per the waterfall contract, returning
 * a value rather than delegating to `next()` claims the decision).
 * @param ctx - the root context carrying `ctx.approval`.
 * @param stdin - the shared readline interface.
 * @returns a disposer removing the listener.
 */
export function registerApprovalAnswerer(ctx: Context, stdin: StdinAccess): () => void {
  return ctx.on('approval/request', async (req: ApprovalRequest, _next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome> => {
    // Abort already fired before dispatch: settle synchronously (mirror
    // api-proxy.ts:1396).
    if (req.signal?.aborted === true) return 'cancelled'
    const label = req.callId === undefined ? req.toolName : `${req.toolName} (${req.callId})`
    process.stdout.write(`\n[approval] ${label}: ${req.reason ?? 'allow this action?'} [y/n] `)
    const answer = await readLine(stdin.rl)
    if (answer === null) return 'cancelled'
    const trimmed = answer.trim().toLowerCase()
    if (trimmed === 'y' || trimmed === 'yes') return 'allowed-once'
    return 'rejected'
  })
}

/**
 * Register the user-questions provider. Renders each question to stdout and
 * reads the selection. Single-select picks by index or label; a question with
 * no options reads free text. `plan-review` intent renders the plan and
 * treats the approve option specially.
 * @param ctx - the root context carrying `ctx.userQuestions`.
 * @param stdin - the shared readline interface.
 * @returns a disposer removing the provider.
 */
export function registerUserQuestionProvider(ctx: Context, stdin: StdinAccess): () => void {
  const dispose = ctx.userQuestions.registerProvider({
    async ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> {
      const sessionId = request.agent?.id
      if (sessionId === undefined) {
        return Promise.reject(new UserQuestionError(
          'tui user-questions requires an agent-owned session', 'ASK_MISSING_AGENT'))
      }
      const answers = await Promise.all(request.questions.map(q => answerOne(stdin.rl, q)))
      return { answers }
    },
  })
  return () => void dispose()
}

/** Read one line; return `null` on EOF (the readline 'close'). */
function readLine(rl: ReadlineInterface): Promise<string | null> {
  return new Promise((resolve) => {
    const onLine = (l: string): void => { rl.off('close', onClose); resolve(l) }
    const onClose = (): void => { rl.off('line', onLine); resolve(null) }
    rl.once('line', onLine)
    rl.once('close', onClose)
  })
}

/** Answer one question: render it, read the selection, return the answer item. */
async function answerOne(rl: ReadlineInterface, q: AskUserQuestionItem): Promise<{ id: string; selected: string[]; custom?: string }> {
  process.stdout.write(`\n[question] ${q.question}\n`)
  if (q.detail !== undefined) process.stdout.write(`${q.detail}\n`)
  if (q.options === undefined || q.options.length === 0) {
    process.stdout.write('> ')
    const text = await readLine(rl)
    return { id: q.id, selected: [], custom: text ?? '' }
  }
  q.options.forEach((opt, i) => {
    const desc = opt.description === undefined ? '' : ` — ${opt.description}`
    process.stdout.write(`  ${i + 1}. ${opt.label}${desc}\n`)
  })
  process.stdout.write(`Select ${q.multiSelect === true ? 'one or more (comma-separated)' : 'one'}> `)
  const text = await readLine(rl)
  if (text === null) return { id: q.id, selected: [] }
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
