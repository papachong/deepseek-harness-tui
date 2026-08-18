/**
 * Phase 0 TUI prototype: boot an external cordis config, subscribe to
 * session/event + agent/status, read one stdin line, drive one agent turn,
 * render streaming text + tool lines to stdout, await whenIdle, exit.
 * Keyless via llm-replay (cordis.snapshot.yml + DSH_SNAPSHOT_FILE fixture).
 *
 * @module @deepseek-ai/dsh-tui-demo/runner
 */

import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { boot, installFailLoud, loadEnv, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'

/* v8 ignore start -- composition over tested app-boot/agent/session and executable acceptance paths */
const NAME = 'dsh-tui-demo'

/**
 * Boot the selected external configuration, drive one agent turn, and own process exit.
 * @returns after the turn completes and the fiber is disposed.
 */
export async function runTuiDemo(): Promise<void> {
  installFailLoud(NAME)
  loadEnv(NAME)

  // Env wins over argv; empty values are absent (mirror jsonrpc-demo runner.ts:25-30).
  // DSH_SNAPSHOT=replay triggers resolveConfigPath to swap cordis.yml -> cordis.snapshot.yml
  // in the same directory (app-boot/src/index.ts:61-69).
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
      `usage: ${NAME} <path/to/cordis.yml> (or set DSH_CORDIS_CONFIG=<path>; set DSH_SNAPSHOT=replay for keyless)\n`,
    )
    process.exit(1)
  }

  // Read one line from stdin BEFORE booting. When stdin is a pipe (echo ... | node),
  // the writer exits and closes the pipe write end immediately; attaching readline
  // only after boot()/whenIdle() would race the pipe close and miss buffered data.
  // stdin is paused until the readline interface consumes it, so data stays buffered.
  process.stdout.write('task> ')
  const rl = createInterface({ input: process.stdin, terminal: false })
  const line: string = await new Promise<string>((resolve) => {
    // Do NOT close inside the line handler: the close event fires synchronously
    // next tick and its `resolve('')` wins over the line's `resolve(l)`, so a
    // piped single line is lost (resolve called twice keeps the first value,
    // but the line resolves first then close overwrites via the same promise —
    // instead defer close so the line value is the settled result).
    rl.once('line', (l: string) => resolve(l))
    rl.once('close', () => resolve(''))
  })
  rl.close()
  if (line.trim() === '') {
    process.stderr.write(`${NAME}: no input received\n`)
    process.exit(1)
  }

  // boot() settles the whole Loader tree (app-boot/src/index.ts:757-802).
  const ctx = await boot(NAME, configPath, undefined, undefined, undefined)

  // Standalone exit: no dsh launcher => no ctx.appExit; own it like jsonrpc-demo.
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

  // Read core services through ctx.get, not the property proxy
  // (headless/src/index.ts:100-104).
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  const sessions = ctx.get('sessions')
  if (agents === undefined || defaultModel === undefined || sessions === undefined) {
    throw new Error(`${NAME}: config must mount agent-spine + agent-default-model + sessions`)
  }

  const selection = defaultModel.currentSelection()

  // Create one agent (headless/src/index.ts:111-119). provider/model must
  // match a route the llm-replay catalog claims in cordis.snapshot.yml.
  const { agent } = await agents.create({
    sessionId: SessionId(`tui-${process.pid}`),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: (agentCtx: Context) => {
      const selected: ModelSelectionRef = { current: selection, assembled: undefined }
      installModelSelection(agentCtx, selected)
    },
  })

  // Subscribe BEFORE followup so no event is missed.
  // session/event: (Session, SessionEvent) => void (session/src/index.ts:76).
  // agent/status: ({ agent, status }) => void (agent/runtime-types.ts:178).
  const assemblers = new Map<string, BlockAssembler>()
  const disposeEvent = ctx.on('session/event', (session, event) => {
    if (session !== agent.session) return
    renderEvent(event, assemblers)
  })
  const disposeStatus = ctx.on('agent/status', ({ agent: subject, status }) => {
    if (subject !== agent) return
    process.stdout.write(`[agent:${status}]\n`)
  })

  let exitCode = 0
  try {
    // Drive one followup turn (headless/src/index.ts:122-126).
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: line }],
      source: { kind: 'user' },
    }))
    await agent.whenIdle()
    await sessions.flush(agent.session)
  } catch (error: unknown) {
    exitCode = 1
    process.stderr.write(`${NAME}: ${error instanceof Error ? error.message : String(error)}\n`)
  } finally {
    disposeEvent()
    disposeStatus()
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
      // data: { turn, step, chunk: StreamChunk } (session/types.ts:266).
      const { turn, step, chunk } = event.data
      const asm = getAssembler(assemblers, turn, step)
      asm.push(chunk)
      // Stream text deltas to stdout immediately for live UX.
      if (chunk.type === 'text-delta') {
        process.stdout.write(chunk.text)
      }
      break
    }
    case 'tool/call': {
      // data: { turn, step, callId, name, arguments: string } (types.ts:279).
      // arguments is the raw JSON string the model produced.
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
      // data: { turn, step, message: ToolResultMessage } (types.ts:291).
      // message.content is [ToolResultBlock]; that block's .content is ContentBlock[].
      const [result] = event.data.message.content
      const text = result.content
        .map(block => block.type === 'text' ? block.text : '')
        .join('')
      const tag = result.isError === true ? 'ERR' : 'ok'
      process.stdout.write(`[tool/result] [${tag}] ${text}\n`)
      break
    }
    case 'assistant/message': {
      // data: { turn, step, message: AssistantMessage, usage? } (types.ts:273).
      const { turn, step, message, usage } = event.data
      assemblers.delete(stepKey(turn, step))
      // Ensure trailing newline after streamed text.
      const last = message.content.at(-1)
      if (last !== undefined && last.type === 'text' && !last.text.endsWith('\n')) {
        process.stdout.write('\n')
      }
      if (usage !== undefined) {
        process.stdout.write(`[tokens: in=${usage.inputTokens} out=${usage.outputTokens}]\n`)
      }
      break
    }
    case 'turn/end': {
      // data: { turn, reason: TurnEndReason } (types.ts:252).
      process.stdout.write(`\n[turn/end] ${event.data.reason.kind}\n`)
      break
    }
    default:
      // turn/start, step/*, user/message, request/*, session/end-seed,
      // todo/write: not rendered in Phase 0.
      break
  }
}
/* v8 ignore stop */
