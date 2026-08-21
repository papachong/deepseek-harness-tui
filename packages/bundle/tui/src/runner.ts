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
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { registerApprovalAnswerer, registerUserQuestionProvider } from './answerers.ts'
import { dryRunCapture } from './capture.ts'
import { createTuiStore, type TuiStore } from './view/store.js'
import { createTuiRenderer, renderApp } from './view/renderer.js'
import type { JSX } from '@opentui/solid'

/* v8 ignore start -- composition over tested app-boot/agent/session and executable acceptance paths */
const NAME = 'dsh-tui'

/**
 * Boot the selected external configuration, drive a multi-turn REPL, and own
 * process exit.
 * @returns after the REPL loop exits (EOF/SIGINT) and the fiber is disposed.
 */
export async function runTui(): Promise<void> {
  installFailLoud(NAME)
  try {
    loadEnv(NAME)
  } catch (error: unknown) {
    // Bun 1.3.14 lacks process.loadEnvFile; the app-boot loadEnv calls it and
    // try/catches ENOENT but not the TypeError from a missing function. Bun
    // loads .env natively, so the call is redundant under Bun; swallow the
    // TypeError and let Bun's native .env populate process.env.
    if (!(error instanceof TypeError)) throw error
  }

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
  /** Resolved by {@link disposeAndExit} to unblock the render-loop await. */
  let exitLatch: (() => void) | undefined
  async function disposeAndExit(code: number): Promise<void> {
    if (exiting) return
    exiting = true
    // Restore the terminal: OpenTUI's renderer entered alt screen and hid the
    // cursor; write the leave-alt-screen + show-cursor escape sequences.
    process.stdout.write('\x1b[?1049l\x1b[?25h')
    // Unblock the render-loop await so the runner can tear down.
    exitLatch?.()
    try {
      await ctx.fiber.dispose()
    } finally {
      process.exit(code)
    }
  }
  /** Dispose + exit invoked from the onSubmit handler (exit/quit commands). */
  async function disposeAndExitWithRenderer(code: number): Promise<void> {
    await disposeAndExit(code)
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
  // NOTE: under the OpenTUI render path, the <Prompt> component owns task
  // input via onSubmit. The line dispatcher is NOT created here: readline's
  // `createInterface` with `terminal:true` calls `setRawMode` on stdin, which
  // races OpenTUI's `createCliRenderer()` raw-mode keymap (OpenTUI loses the
  // race and the keystrokes never reach the `<input>` — `onSubmit` never fires,
  // 0 events). The answerers use the store's `awaitAnswer`/`resolveAnswer`
  // surface, not `readLine()`, so the dispatcher is unneeded under the render
  // path. It stays available for a non-render fallback if one is added later.
  // `output: process.stdout` echo handling moves into the OpenTUI `<input>`
  // (its keymap echoes typed characters in raw mode).

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
  // OpenTUI <markdown streaming> does its own folding (per the design-confirm
  // key decision #1, SKIP BlockAssembler for the markdown path), so events are
  // pushed straight into the reactive store.
  const store = createTuiStore()
  const disposeEvent = ctx.on('session/event', (session, event) => {
    if (session !== agent.session) return
    store.push({ sessionId: session.id, event, view: undefined, type: 'session/event' })
  })
  const disposeStatus = ctx.on('agent/status', ({ agent: subject, status }) => {
    if (subject !== agent) return
    store.setStatus(status)
  })

  // Phase 1 additions over Phase 0: register the approval answerer and the
  // user-questions provider. Phase 0 rendered only and returned 'unavailable'
  // (fail-closed). Mirror api-proxy.ts:1338-1391 (in-process: no mux).
  // The services are optional: a composition without dsh-user-approval /
  // dsh-user-questions mounted simply skips the answerers (fail-closed stays).
  // OpenTUI raw-mode conflict resolution (design-confirm): the answerers push
  // a pending question into the store via awaitAnswer() and return its
  // promise; the <Prompt> component resolves the answer via resolveAnswer()
  // when the user submits a line in answer mode. The line dispatcher stays
  // registered for non-render fallback but the answerers use the store.
  const disposeApproval = ctx.get('approval') === undefined
    ? () => {}
    : registerApprovalAnswerer(ctx, { store })
  const disposeQuestions = ctx.get('userQuestions') === undefined
    ? () => {}
    : registerUserQuestionProvider(ctx, { store })

  let exitCode = 0
  try {
    // Boot the OpenTUI renderer (async: queries terminal DSR over stdin).
    // The <Prompt> component owns the task input via onSubmit → agent.followup +
    // whenIdle + flush. The readline REPL loop is replaced by the OpenTUI input.
    const renderer = await createTuiRenderer()
    // Dynamic import: tsdown/rolldown leaves this unresolved, and Bun.build
    // (which produces lib/view/app.js) supplies it at runtime. The App module is
    // JSX (tsdown cannot bundle Solid JSX), so it cannot be a static import.
    // The `as` cast sidesteps tsc's --jsx-not-set resolution of the .tsx source;
    // the module is type-checked separately by tsconfig.view.json.
    const { createAppRoot } = await import('./view/app.js') as {
      createAppRoot: (store: TuiStore, onSubmit: (text: string) => void) => () => JSX.Element
    }
    const onSubmit = (text: string): void => {
      const trimmed = text.trim()
      if (trimmed === '') return
      // Built-in REPL commands: exit/quit end the loop cleanly (exit 0) instead
      // of being sent to the agent as a task line.
      const cmd = trimmed.toLowerCase()
      if (cmd === 'exit' || cmd === 'quit' || cmd === '/exit' || cmd === '/quit') {
        void disposeAndExitWithRenderer(0)
        return
      }
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: trimmed }],
        source: { kind: 'user' },
      }))
      // Per-turn flush for crash-safety (Phase 0/headless flush once because
      // one-shot; a REPL benefits from per-turn persistence).
      void agent.whenIdle().then(() => {
        void sessions.flush(agent.session)
      })
    }
    await renderApp(createAppRoot(store, onSubmit), renderer)
    // renderApp() resolves after mounting + renderer.start(); it does NOT
    // block. The renderer's frame loop + stdin key dispatch run on Bun's
    // event loop, but the runner's control flow would fall through to the
    // finally block (disposeAndExit) immediately, killing the TUI before the
    // user can type. Block here until disposeAndExitWithRenderer is invoked
    // (from onSubmit exit/quit or SIGINT/SIGTERM) via a promise that the
    // exit path resolves.
    await new Promise<void>((resolve) => { exitLatch = resolve })
  } catch (error: unknown) {
    exitCode = 1
    process.stderr.write(`${NAME}: ${error instanceof Error ? error.message : String(error)}\n`)
  } finally {
    // SessionEnd capture hook (Phase 3, M2 partial): a dry-run intent only.
    // The real `sf memory capture` reuses ai-cli's redaction/queue/replay
    // out-of-tree; it is NOT invoked until the user confirms (solution note
    // risk #4: any capture must not bypass ai-cli idempotence).
    dryRunCapture(agent.session)
    // Restore the terminal: OpenTUI's renderer entered alt screen and hid the
    // cursor; write the leave-alt-screen + show-cursor escape sequences so a
    // non-disposing exit does not leave the terminal in raw mode.
    process.stdout.write('\x1b[?1049l\x1b[?25h')
    disposeEvent()
    disposeStatus()
    disposeApproval()
    disposeQuestions()
    await disposeAndExit(exitCode)
  }
}
