/**
 * Phase 1 product TUI runner: a multi-turn REPL over an in-process Agent.
 * Mirrors the Phase 0 prototype (packages/examples/tui-demo/src/runner.ts,
 * single-turn) and extends the followup → whenIdle pair into a REPL loop.
 * Standalone bin: owns disposeAndExit (no `ctx.appExit`, unlike headless).
 *
 * @module @deepseek-ai/dsh-tui/runner
 */

import { existsSync } from 'node:fs'
import { boot, installFailLoud, loadEnv, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { registerApprovalAnswerer, registerUserQuestionProvider } from './answerers.ts'
import { dryRunCapture } from './capture.ts'
import { createLineInput } from './input.ts'

/* v8 ignore start -- composition over tested app-boot/agent/session and executable acceptance paths */
const NAME = 'dsh-tui'

/**
 * Boot the selected external configuration, drive a multi-turn REPL, and own
 * process exit.
 * @returns after the REPL loop exits (EOF/SIGINT) and the fiber is disposed.
 */
export async function runTui(): Promise<void> {
  installFailLoud(NAME)
  loadEnv(NAME)

  // Env wins over argv; empty values are absent (mirror tui-demo runner.ts:33-37).
  // DSH_SNAPSHOT=replay triggers resolveConfigPath to swap cordis.yml →
  // cordis.snapshot.yml in the same directory (app-boot/src/index.ts:61-69).
  const fromEnv = process.env['DSH_CORDIS_CONFIG']
  const fromArgv = process.argv[2]
  const requested = fromEnv !== undefined && fromEnv !== ''
    ? fromEnv
    : fromArgv !== undefined && fromArgv !== '' ? fromArgv : undefined
  const configPath = requested === undefined
    ? undefined
    : resolveConfigPath(requested, process.env['DSH_SNAPSHOT'])
  if (configPath === undefined || !existsSync(configPath)) {
    process.stderr.write(
      `usage: ${NAME} <path/to/cordis.yml> [--resume <sessionId>] (or set DSH_CORDIS_CONFIG=<path>; set DSH_SNAPSHOT=replay for keyless)\n`,
    )
    process.exit(1)
  }

  // --resume <sessionId>: load a persisted cold session and rebuild the agent
  // on it (mirror api-proxy.ts:1626 `ctx.agents.resume({ resumeSessionId })`).
  // Absent → fresh session (Phase 1 behavior).
  const resumeFlag = process.argv.indexOf('--resume')
  const resumeArg = resumeFlag !== -1 ? process.argv[resumeFlag + 1] : undefined
  const resumeSessionId = resumeArg !== undefined && resumeArg !== ''
    ? SessionId(resumeArg)
    : undefined

  // Pause stdin BEFORE boot so a piped writer's data (and its EOF close) is
  // buffered in the stdin internal buffer and not consumed until the readline
  // interface attaches AFTER boot. createInterface auto-resumes the stream,
  // so creating it before boot would race the pipe close during the async
  // boot() (Phase 0 bug a, tui-demo runner.ts:48-63 — there fixed by reading
  // one line via a Promise before boot). For a multi-turn REPL we instead
  // pause stdin now and create the readline interface after boot settles.
  // BUT: pause() on a real TTY breaks input echo (readline's terminal:true
  // setRawMode does not restore the ECHO flag on a stdin that was paused
  // before the interface attached). A real TTY does not EOF-race the way a
  // pipe does, so only pause for non-TTY (piped) input.
  if (!process.stdin.isTTY) {
    process.stdin.pause()
  }

  // boot() settles the whole Loader tree (app-boot/src/index.ts:757-802).
  const ctx = await boot(NAME, configPath, undefined, undefined, undefined)

  // Standalone exit: no dsh launcher => no ctx.appExit (unlike headless
  // index.ts:144-146 which reads ctx.get('appExit')). Own it like Phase 0.
  let exiting = false
  async function disposeAndExit(code: number): Promise<void> {
    if (exiting) return
    exiting = true
    try {
      await ctx.fiber.dispose()
    } finally {
      process.exit(code)
    }
  }
  process.on('SIGTERM', () => { void disposeAndExit(0) })
  process.on('SIGINT', () => { void disposeAndExit(130) })

  // Await loader siblings so scoped tools and adapters are fully composed
  // (headless/src/index.ts:99).
  await ctx.get('loader')?.await()

  // Now create the line dispatcher (single owner of readline). stdin was
  // paused before boot so its buffered piped data survives boot; readline
  // resumes the stream on creation and lines are queued in the dispatcher
  // until drained. Never close inside a line handler (Phase 0 bug b).
  // Line-mode for Phase 1; raw-mode keypress is Phase 2.
  const input = createLineInput({
    input: process.stdin,
    // output is REQUIRED for echo: with output omitted, Node's readline
    // leaves this.output undefined and _writeToOutput silently drops every
    // echo/refresh write (internal/readline/interface.js kWriteToOutput).
    // terminal:true then sets raw mode (-echo) at the driver level, so the
    // user's keystrokes are consumed but never displayed. process.stdout is
    // the terminal surface (mirror runner.ts:166 usage).
    output: process.stdout,
    terminal: !process.stdin.isTTY ? false : true,
  })

  // Read core services through ctx.get, not the property proxy
  // (headless/src/index.ts:100-104).
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  const sessions = ctx.get('sessions')
  if (agents === undefined || defaultModel === undefined || sessions === undefined) {
    throw new Error(`${NAME}: config must mount agent-spine + agent-default-model + sessions`)
  }

  const selection = defaultModel.currentSelection()

  // Create or resume one agent. --resume loads a persisted cold session and
  // rebuilds the agent on it (mirror api-proxy.ts:1626); absent → fresh session.
  const setup = (agentCtx: Context) => {
    const selected: ModelSelectionRef = { current: selection, assembled: undefined }
    installModelSelection(agentCtx, selected)
  }
  const { agent } = resumeSessionId === undefined
    ? await agents.create({
      sessionId: SessionId(`tui-${process.pid}`),
      meta: { cwd: process.cwd() },
      agentOptions: { provider: selection.provider, model: selection.model },
      setup,
    })
    : await agents.resume({
      resumeSessionId,
      agentOptions: { provider: selection.provider, model: selection.model },
      setup,
    })

  // Subscribe BEFORE the loop so no event is missed (tui-demo runner.ts:114-125).
  // session/event: (Session, SessionEvent) => void (session/src/index.ts:76).
  // The session filter stays valid across turns: the Session object is stable,
  // only turn numbers increment.
  const assemblers = new Map<string, BlockAssembler>()
  const disposeEvent = ctx.on('session/event', (session, event) => {
    if (session !== agent.session) return
    renderEvent(event, assemblers)
  })
  const disposeStatus = ctx.on('agent/status', ({ agent: subject, status }) => {
    if (subject !== agent) return
    process.stdout.write(`[agent:${status}]\n`)
  })

  // Phase 1 additions over Phase 0: register the approval answerer and the
  // user-questions provider. Phase 0 rendered only and returned 'unavailable'
  // (fail-closed). Mirror api-proxy.ts:1338-1391 (in-process: no mux).
  // The services are optional: a composition without dsh-user-approval /
  // dsh-user-questions mounted simply skips the answerers (fail-closed stays).
  const disposeApproval = ctx.get('approval') === undefined
    ? () => {}
    : registerApprovalAnswerer(ctx, { input })
  const disposeQuestions = ctx.get('userQuestions') === undefined
    ? () => {}
    : registerUserQuestionProvider(ctx, { input })

  let exitCode = 0
  try {
    process.stdout.write('task> ')
    // REPL LOOP: read task line → followup (one new turn) → whenIdle (turn
    // done) → flush → next line. The dispatcher routes lines during a turn to
    // a pending approval/ask-user reader instead of the task queue, so answer
    // lines are never replayed to the agent as fake tasks (single-owner
    // routing — optimization note 2026-08-19 §3). null on EOF/Ctrl-D → exit 0.
    for (;;) {
      const line = await input.nextTaskLine()
      if (line === null) break
      const text = line.trim()
      if (text === '') {
        process.stdout.write('task> ')
        continue
      }
      // Built-in REPL commands (line-mode Phase 1): exit/quit end the loop
      // cleanly (exit 0) instead of being sent to the agent as a task line.
      const cmd = text.toLowerCase()
      if (cmd === 'exit' || cmd === 'quit' || cmd === '/exit' || cmd === '/quit') {
        process.stdout.write('bye\n')
        break
      }
      agent.followup(createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
      }))
      await agent.whenIdle()
      // Per-turn flush for crash-safety (Phase 0/headless flush once because
      // one-shot; a REPL benefits from per-turn persistence).
      await sessions.flush(agent.session)
      process.stdout.write('task> ')
    }
  } catch (error: unknown) {
    exitCode = 1
    process.stderr.write(`${NAME}: ${error instanceof Error ? error.message : String(error)}\n`)
  } finally {
    // SessionEnd capture hook (Phase 3, M2 partial): a dry-run intent only.
    // The real `sf memory capture` reuses ai-cli's redaction/queue/replay
    // out-of-tree; it is NOT invoked until the user confirms (solution note
    // risk #4: any capture must not bypass ai-cli idempotence).
    dryRunCapture(agent.session)
    disposeEvent()
    disposeStatus()
    disposeApproval()
    disposeQuestions()
    input.close()
    await disposeAndExit(exitCode)
  }
}

// ---- Minimal terminal renderer (raw process.stdout.write streaming) ----

function stepKey(turn: number, step: number): string {
  return `${turn}:${step}`
}

function getAssembler(assemblers: Map<string, BlockAssembler>, turn: number, step: number): BlockAssembler {
  const key = stepKey(turn, step)
  let asm = assemblers.get(key)
  if (asm === undefined) {
    asm = new BlockAssembler()
    assemblers.set(key, asm)
  }
  return asm
}

/**
 * Render one session event to stdout.
 * @param event - the appended session event.
 * @param assemblers - per-step BlockAssembler map for chunk folding.
 */
function renderEvent(event: SessionEvent, assemblers: Map<string, BlockAssembler>): void {
  switch (event.type) {
    case 'assistant/chunk': {
      const { turn, step, chunk } = event.data
      const asm = getAssembler(assemblers, turn, step)
      asm.push(chunk)
      if (chunk.type === 'text-delta') {
        process.stdout.write(chunk.text)
      }
      break
    }
    case 'tool/call': {
      const { name, arguments: raw } = event.data
      let pretty: string
      try {
        pretty = JSON.stringify(JSON.parse(raw))
      } catch {
        pretty = raw
      }
      process.stdout.write(`\n[tool/call] ${name}(${pretty})\n`)
      break
    }
    case 'tool/result': {
      const [result] = event.data.message.content
      const text = result.content
        .map(block => block.type === 'text' ? block.text : '')
        .join('')
      const tag = result.isError === true ? 'ERR' : 'ok'
      process.stdout.write(`[tool/result] [${tag}] ${text}\n`)
      break
    }
    case 'assistant/message': {
      const { turn, step, usage } = event.data
      assemblers.delete(stepKey(turn, step))
      const last = event.data.message.content.at(-1)
      if (last !== undefined && last.type === 'text' && !last.text.endsWith('\n')) {
        process.stdout.write('\n')
      }
      if (usage !== undefined) {
        process.stdout.write(`[tokens: in=${usage.inputTokens} out=${usage.outputTokens}]\n`)
      }
      break
    }
    case 'turn/end': {
      process.stdout.write(`\n[turn/end] ${event.data.reason.kind}\n`)
      break
    }
    default:
      break
  }
}
