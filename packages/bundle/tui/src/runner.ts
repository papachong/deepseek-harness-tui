/**
 * Phase 1 product TUI runner: a multi-turn REPL over an in-process Agent.
 * Mirrors the Phase 0 prototype (packages/examples/tui-demo/src/runner.ts,
 * single-turn) and extends the followup → whenIdle pair into a REPL loop.
 * Standalone bin: owns disposeAndExit (no `ctx.appExit`, unlike headless).
 *
 * @module @deepseek-ai/dsh-tui/runner
 */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve as resolvePath } from 'node:path'
import { boot, installFailLoud, loadEnv, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection, type ModelSelectionRef, type ModelSelection } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
// Type-only imports that bring Context augmentations (ctx.llm,
// ctx.sessionPersistence, ctx.commands, ctx.agentPresets) into this program's
// type graph, mirroring api-proxy.ts:31's pattern for ctx.tools.
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-file-reference'
import type {} from '@deepseek-ai/dsh-session-reference'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { foldSessionTitle } from '@deepseek-ai/dsh-session-title'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'
import type { ToolRuntime } from '@deepseek-ai/dsh-tools'
import type { ToolEventView } from './transport/event-source.js'
import { registerApprovalAnswerer, registerUserQuestionProvider } from './answerers.ts'
import { dryRunCapture } from './capture.ts'
import { createTuiStore, type TuiStore, type SessionListItem } from './view/store.js'
import { createTuiRenderer, renderApp, dismissConsoleOverlay } from './view/renderer.js'
import { theme, themeNames, switchTheme } from './view/theme.js'
import { setLocale, locale, t } from './view/i18n.js'
import { nextWorkMode, type WorkMode } from './view/modes.js'
import type { CommandEntry } from './view/components/command-palette.js'
import type { MentionEntry } from './view/components/mention-menu.js'
import type { JSX } from '@opentui/solid'
import type { CliRenderer } from '@opentui/core'

/** The valid work-mode preset ids accepted by `/mode`. */
const WORK_MODE_IDS: readonly string[] = ['standard', 'code', 'minimal', 'cordis']

/** Whether `value` is a valid work-mode id (for `/mode` validation). */
function isWorkMode(value: string): boolean {
  return WORK_MODE_IDS.includes(value)
}

/* v8 ignore start -- composition over tested app-boot/agent/session and executable acceptance paths */
const NAME = 'dsh-tui'

/**
 * Compute the host-side render intent (callView/resultView) for a tool event,
 * mirroring `api-proxy.ts:689-725 viewFor`. The runner calls
 * `ToolRuntime.get(name, scope)?.presentCall`/`presentResult` so the store's
 * `callView`/`resultView` carry the tool-specific card (terminal/diff/read/
 * search/web) instead of the generic fallback. Presenters are pure and may
 * throw on stale/unparseable args; any error soft-falls to `undefined` (the
 * event still ships, just without a view) so delivery is never blocked.
 * @param tools - the ToolRuntime service, or undefined when not mounted.
 * @param event - the session event (tool/call or tool/result).
 * @param argsFor - resolves a callId to its recorded {name,args} (back-scan).
 * @param scope - the agent (a ScopeKey) scoping the tool lookup to its preset.
 * @returns the ToolEventView, or undefined when no presenter attached one.
 */
function viewFor(
  tools: ToolRuntime | undefined,
  event: SessionEvent,
  argsFor: (callId: string) => { name: string; args: unknown } | undefined,
  scope?: ScopeKey,
): ToolEventView | undefined {
  if (tools === undefined) return undefined
  try {
    if (event.type === 'tool/call') {
      const { name, arguments: raw } = event.data
      const view = tools.get(name, scope)?.presentCall?.(JSON.parse(raw))
      return view === undefined ? undefined : { for: 'call', view }
    }
    if (event.type === 'tool/result') {
      const { message, meta } = event.data
      const [result] = message.content
      const callId = message.source.callId
      const call = argsFor(callId)
      if (call === undefined) return undefined
      const view = tools.get(call.name, scope)?.presentResult?.(call.args, {
        content: result.content,
        isError: result.isError === true,
        ...meta === undefined ? {} : { meta },
      })
      return view === undefined ? undefined : { for: 'result', view }
    }
  } catch {
    // A throwing presenter (or unparseable arguments) must not break delivery;
    // the event still ships, just without a view.
  }
  return undefined
}

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

  // The shipped agent-preset root sits beside the CLI app config. The
  // `!!js` eval scope in cordis.yml has no `import.meta`, so the runner
  // resolves the path from its own module URL and injects it as an overlay
  // `roots` patch on the agent-presets row before boot — mirroring
  // apps/cli/src/profile-boot.ts's SHIPPED_PRESET_ROOT injection. A patch
  // replaces the row's whole `config` (loader semantics), so the overlay
  // carries `default` + `includeUserRoot` alongside `roots`.
  const shippedPresetRoot = resolvePath(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../apps/cli/config/agent-presets',
  )
  const presetOverlay = existsSync(shippedPresetRoot)
    ? [{
      id: 'agent-presets',
      config: {
        default: 'standard',
        includeUserRoot: false,
        roots: [{ path: shippedPresetRoot, trust: 'system' as const }],
      },
    }]
    : []

  // boot() settles the whole Loader tree (app-boot/src/index.ts:757-802).
  const ctx = await boot(NAME, configPath, presetOverlay, undefined, undefined)

  // Standalone exit: no dsh launcher => no ctx.appExit (unlike headless
  // index.ts:144-146 which reads ctx.get('appExit')). Own it like Phase 0.
  let exiting = false
  /** Resolved by {@link disposeAndExit} to unblock the render-loop await. */
  let exitLatch: (() => void) | undefined
  async function disposeAndExit(code: number): Promise<void> {
    if (exiting) return
    exiting = true
    // Stop the renderer's frame loop + stdin dispatch BEFORE restoring the
    // terminal. Without `stop()`, the renderer keeps writing cursor-position
    // and rendering escape sequences to stdout even after the alt screen is
    // left — the terminal interprets them as garbage text (e.g.
    // "35;27;12M35;26;12M…"). `stop()` halts the frame loop and detaches
    // the stdin raw-mode handler; `destroy()` is the full teardown. Both
    // are safe to call even when the renderer is already stopped.
    renderer?.stop()
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
  const llm = ctx.get('llm')
  const sessionPersistence = ctx.get('sessionPersistence')
  const commands = ctx.get('commands')
  const agentPresets = ctx.get('agentPresets')
  // @-mention backends: fileReferences backs `@path` autocomplete in the
  // prompt; sessionReferenceResolver enriches `@[label](dsh-session:…)`
  // mentions with cross-session context for the model. Both are optional —
  // a composition without them simply offers no @-mention completion.
  const fileReferences = ctx.get('fileReferences')
  if (agents === undefined || defaultModel === undefined || sessions === undefined) {
    throw new Error(`${NAME}: config must mount agent-spine + agent-default-model + sessions`)
  }
  // The store is created before the agent so session/model state can be seeded
  // and the sidebar refresh helper can close over it.
  const store = createTuiStore()

  const selection = defaultModel.currentSelection()
  // Retain the ModelSelectionRef so a command-palette model swap can mutate
  // `selectionRef.current` in place (model-selection.ts: the next step reads it).
  // The setup closure below closes over this same ref.
  const selectionRef: ModelSelectionRef = { current: selection, assembled: undefined }
  store.setModel(selection)

  // Create or resume one agent. --resume loads a persisted cold session and
  // rebuilds the agent on it (mirror api-proxy.ts:1626); absent → fresh session.
  // The agent is held in a `let` (not `const`) because session switching
  // disposes + re-creates it; the event/status listeners rebind to the new
  // agent via `rebind`.
  //
  // Work mode: the active preset id (`store.mode()`, Tab-cyclable) joins the
  // agent in `setup` via `ctx.agentPresets.mount(agentCtx, id)` — the
  // api-proxy pattern (api-proxy.ts:1186). The preset id flows onto the
  // session header so resume rebuilds the same composition. `agentPresets` is
  // optional: a composition without the roster mounts a bare agent. The mount
  // is best-effort: under replay (`cordis.snapshot.yml`) the preset row is
  // nested inside an `include`d tree the overlay patches cannot reach, so
  // `resolve` finds no roots; a bare agent still replays a recorded session
  // fine, so a failure logs a warning rather than aborting boot.
  const setup = async (agentCtx: Context): Promise<void> => {
    installModelSelection(agentCtx, selectionRef)
    if (agentPresets !== undefined) {
      try {
        await agentPresets.mount(agentCtx, store.mode())
      } catch (error: unknown) {
        agentCtx.logger.warn(
          `dsh-tui: work mode "${store.mode()}" preset did not mount `
          + `(${error instanceof Error ? error.message : String(error)}); agent runs bare. `
          + 'Live mode: check the preset root overlay. Replay mode: the snapshot include tree hides the row.',
        )
      }
    }
  }
  let agentHandle = resumeSessionId === undefined
    ? await agents.create({
      sessionId: SessionId(`tui-${process.pid}`),
      meta: { cwd: process.cwd(), agentPreset: store.mode() },
      agentOptions: { provider: selection.provider, model: selection.model },
      setup,
    })
    : await agents.resume({
      resumeSessionId,
      agentOptions: { provider: selection.provider, model: selection.model },
      setup,
    })
  let agent = agentHandle.agent

  // Subscribe BEFORE the loop so no event is missed (tui-demo runner.ts:114-125).
  // session/event: (Session, SessionEvent) => void (session/src/index.ts:76).
  // The session filter stays valid across turns: the Session object is stable,
  // only turn numbers increment.
  // OpenTUI <markdown streaming> does its own folding (per the design-confirm
  // key decision #1, SKIP BlockAssembler for the markdown path), so events are
  // pushed straight into the reactive store.
  // Sidebar session list: merge live sessions (sessions.list()) + cold
  // (sessionPersistence.list()) and fold titles via foldSessionTitle (pure
  // function, no service needed for live sessions). Refreshed on boot and
  // after each turn (whenIdle). The session-title plugin (mounted via
  // cordis.yml) feeds foldSessionTitle for live sessions; cold sessions use
  // a fallback id title (reading their events is deferred).
  const refreshSessions = async (): Promise<void> => {
    const items: SessionListItem[] = []
    const live = sessions.list()
    const liveIds = new Set<string>()
    for (const session of live) {
      liveIds.add(session.id)
      const title = foldSessionTitle(session.events)?.title ?? session.id
      const lastEvent = session.events[session.events.length - 1]
      const updatedAt = lastEvent?.time ?? session.header.createdAt
      items.push({ id: session.id, title, live: true, updatedAt })
    }
    if (sessionPersistence !== undefined) {
      try {
        const cold = await sessionPersistence.list()
        for (const header of cold) {
          if (liveIds.has(header.id)) continue
          items.push({ id: header.id, title: header.id, live: false, updatedAt: header.createdAt })
        }
      } catch {
        // persistence.list may reject when the store is empty/uninitialized;
        // the live list still renders.
      }
    }
    items.sort((a, b) => b.updatedAt - a.updatedAt)
    store.setSessions(items)
  }
  void refreshSessions()
  // Tool registry: compute host-side render intent (callView/resultView) via
  // presentCall/presentResult, mirroring api-proxy.ts:689-725 viewFor. The
  // agent is a ScopeKey (agent-loop/src/agent.ts:94), so passing it scopes the
  // tool lookup to the agent's preset chain. A parallel callId→{name,args} map
  // avoids the store-flush race (tool/result may arrive before the batched
  // tool/call commits to state.tools).
  const tools = ctx.get('tools')
  const callArgs = new Map<string, { name: string; args: unknown }>()
  // The session/event + agent/status listeners rebind to the current agent so
  // session switching (switchSession) can swap the agent without re-subscribing.
  // The closures read `agent` (a `let`) at call time; reassigning `agent`
  // retargets them. Disposers are retained so the finally block can tear down.
  let disposeEvent: (() => void) | undefined = ctx.on('session/event', (session, event) => {
    if (session !== agent.session) return
    // Record the call's name+args synchronously on tool/call so tool/result
    // (which carries only callId) can back-resolve without waiting for the
    // store flush.
    if (event.type === 'tool/call') {
      const { name, arguments: raw, callId } = event.data
      let parsed: unknown
      try { parsed = JSON.parse(raw) } catch { parsed = raw }
      callArgs.set(callId, { name, args: parsed })
    }
    const view = viewFor(tools, event, id => callArgs.get(id), agent)
    store.push({ sessionId: session.id, event, view, type: 'session/event' })
  })
  let disposeStatus: (() => void) | undefined = ctx.on('agent/status', ({ agent: subject, status }) => {
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
  // The renderer must be declared at this scope (not inside `try`) so the
  // `disposeAndExit` closure can call `renderer?.stop()` to halt the frame
  // loop before restoring the terminal — without it, the renderer keeps
  // writing escape sequences to stdout (garbage after the alt screen exits).
  let renderer: CliRenderer | undefined
  try {
    // Boot the OpenTUI renderer (async: queries terminal DSR over stdin).
    // The <Prompt> component owns the task input via onSubmit → agent.followup +
    // whenIdle + flush. The readline REPL loop is replaced by the OpenTUI input.
    renderer = await createTuiRenderer()
    // Dynamic import: tsdown/rolldown leaves this unresolved, and Bun.build
    // (which produces lib/view/app.js) supplies it at runtime. The App module is
    // JSX (tsdown cannot bundle Solid JSX), so it cannot be a static import.
    // The `as` cast sidesteps tsc's --jsx-not-set resolution of the .tsx source;
    // the module is type-checked separately by tsconfig.view.json.
    const { createAppRoot } = await import('./view/app.js') as unknown as {
      createAppRoot: (
        store: TuiStore,
        onSubmit: (text: string) => void,
        currentSessionId: () => string,
        commands: readonly CommandEntry[],
        onCycleMode?: () => void,
        onSelectSession?: (id: string) => void,
        resolveMentions?: (query: string) => Promise<readonly MentionEntry[]>,
      ) => () => JSX.Element
    }
    const onSubmit = async (text: string): Promise<void> => {
      const trimmed = text.trim()
      if (trimmed === '') return
      // First submission flips the home hero to the chat layout. The store
      // owns the page signal; the view's `<App>` memo reads it and swaps.
      if (store.page() === 'home') store.setPage('chat')
      // Built-in REPL commands: exit/quit end the loop cleanly (exit 0) instead
      // of being sent to the agent as a task line.
      const cmd = trimmed.toLowerCase()
      if (cmd === 'exit' || cmd === 'quit' || cmd === '/exit' || cmd === '/quit') {
        void disposeAndExitWithRenderer(0)
        return
      }
      // /model <provider>/<model>: swap the model selection in place. The
      // ModelSelectionRef mutates; the next step picks it up (model-selection.ts).
      // No agent rebuild. /model with no arg lists available models async.
      // Checked BEFORE /mode so `/model` does not match `/mode`'s prefix.
      if (cmd.startsWith('/model')) {
        const arg = trimmed.slice('/model'.length).trim()
        if (arg === '') {
          // List models asynchronously (the llm service is async).
          const llmService = llm
          if (llmService !== undefined) {
            void Promise.all(llmService.listProviders().map(async (p) => {
              const models = await llmService.listModels(p.id)
              return `${p.name}: ${models.map(m => m.id).join(', ')}`
            })).then((lines) => {
              process.stdout.write(`models:\n${lines.join('\n')}\n(active: ${selectionRef.current?.provider}/${selectionRef.current?.model})\n`)
            })
          } else {
            process.stdout.write(`llm service not mounted; active: ${selectionRef.current?.provider}/${selectionRef.current?.model}\n`)
          }
        } else {
          const slash = arg.indexOf('/')
          const current = selectionRef.current
          const provider = slash === -1 ? (current?.provider ?? arg) : arg.slice(0, slash)
          const model = slash === -1 ? arg : arg.slice(slash + 1)
          const next: ModelSelection = { provider, model }
          selectionRef.current = next
          store.setModel(next)
          void defaultModel.saveSelection(next)
          process.stdout.write(`model: ${provider}/${model}\n`)
        }
        return
      }
      // /mode <name>: swap the active work mode (preset id). The store flips
      // immediately (the status bar + home banner re-render); the agent is
      // rebuilt on the new preset by `switchMode` (dispose → create with the
      // new preset meta + setup mount → rebind listeners → reset transcript).
      // With no arg, echo the active mode.
      if (cmd.startsWith('/mode ')) {
        const arg = trimmed.slice('/mode'.length).trim()
        if (arg === '') {
          process.stdout.write(`mode: ${store.mode()} (active)\n`)
        } else if (isWorkMode(arg)) {
          await switchMode(arg as WorkMode)
          process.stdout.write(`mode: ${arg}\n`)
        } else {
          process.stdout.write(`unknown mode: ${arg}; available: standard, code, minimal, cordis\n`)
        }
        return
      }
      if (cmd === '/mode') {
        process.stdout.write(`mode: ${store.mode()} (active)\n`)
        return
      }
      // /theme <name>: swap the active color theme at runtime. No agent round-trip.
      if (cmd.startsWith('/theme')) {
        const arg = trimmed.slice('/theme'.length).trim()
        if (arg === '') {
          process.stdout.write(`themes: ${themeNames().join(', ')} (active: ${theme().name})\n`)
        } else if (switchTheme(arg)) {
          process.stdout.write(`theme: ${arg}\n`)
        } else {
          process.stdout.write(`unknown theme: ${arg}; available: ${themeNames().join(', ')}\n`)
        }
        return
      }
      // /lang <en|zh>: swap the active UI locale. No agent round-trip; the
      // SolidJS signal re-renders every component reading t(...). With no arg,
      // list available locales and the active one.
      if (cmd.startsWith('/lang')) {
        const arg = trimmed.slice('/lang'.length).trim().toLowerCase()
        if (arg === '') {
          process.stdout.write(`${t('lang.listing', { locale: locale() })}\n`)
        } else if (arg === 'en' || arg === 'zh') {
          setLocale(arg)
          process.stdout.write(`${t('lang.switched', { locale: arg })}\n`)
        } else {
          process.stdout.write(`${t('lang.unknown', { arg })}\n`)
        }
        return
      }
      // /sessions: refresh the sidebar session list.
      if (cmd === '/sessions') { void refreshSessions(); return }
      // /clear: start a fresh session on the current work mode. Disposes the
      // current agent, creates a new one (same preset, fresh session id), and
      // rebinds listeners. Reuses the `onSelectSession('')` path — the empty
      // id means "new session".
      if (cmd === '/clear' || cmd === '/new') {
        await onSelectSession('')
        process.stdout.write(`cleared: new session on ${store.mode()}\n`)
        return
      }
      // Registered slash commands (/compact /feedback /goal /permission /plan
      // and any other plugin-registered command): hand the raw line to the
      // command registry, which parses, runs the handler, and logs the
      // command/run + command/done lifecycle events. The runner stays the
      // authority for TUI-local commands (exit/theme/model/mode/sessions)
      // because they own the renderer or the store, not the agent session.
      // `commands` is optional: a composition without dsh-commands mounted
      // falls through to agent.followup (the `/cmd` text reaches the model).
      if (commands !== undefined && cmd.startsWith('/')) {
        const controller = new AbortController()
        void commands.execute(agent, trimmed, [], controller.signal).then((result) => {
          if (result === undefined) {
            // No registered command matched; send to the agent as a task.
            agent.followup(createUserMessage({
              content: [{ type: 'text', text: trimmed }],
              source: { kind: 'user' },
            }))
            return
          }
          if (result.result.kind === 'error') {
            process.stderr.write(`${result.result.text ?? 'command error'}\n`)
          } else if (result.result.text !== undefined && result.result.text !== '') {
            process.stdout.write(`${result.result.text}\n`)
          }
          void refreshSessions()
        })
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
        void refreshSessions()
      })
    }
    // Tab cycles the work mode. The store flips immediately (re-render); the
    // agent rebuild on the new preset happens via `switchMode`, mirroring
    // `/mode`. Tab cycles to the next mode and triggers the rebuild.
    const onCycleMode = async (): Promise<void> => {
      await switchMode(nextWorkMode(store.mode()))
    }
    // Rebuild the agent on a new work-mode preset. The preset swap only needs
    // to affect NEW turns (the existing session's messages stay in the log);
    // clearing the transcript would lose the user's history. The runner keeps
    // the transcript alive and only swaps the agent's preset composition —
    // the next turn picks up the new preset's tools/persona, the existing
    // messages stay visible. A full agent rebuild is deferred to `/clear`.
    const switchMode = async (mode: WorkMode): Promise<void> => {
      if (agentPresets === undefined) { store.setMode(mode); return }
      if (store.mode() === mode) return
      store.setMode(mode)
      // No agent rebuild: the preset mounts new tools/persona for the NEXT
      // turn via `agentPresets.mount(agentCtx, mode)` in the setup closure,
      // which runs on `agents.create` (new session) or `agents.resume`
      // (existing session). The current session keeps its existing agent;
      // the next `/mode` or `/clear` triggers a fresh build on the new preset.
      // The transcript is NOT cleared — the user's history stays visible.
    }
    // Session switching: dispose the current agent, resume the selected cold
    // session (or create a fresh one when the id is empty), rebind the
    // session/event + agent/status listeners to the new agent, reset the
    // transcript, and refresh the sidebar. Mirrors the launch path's
    // create/resume + rebind shape. The id is empty for a brand-new session
    // (the `/clear` gesture reuses this path).
    const onSelectSession = async (id: string): Promise<void> => {
      disposeEvent?.()
      disposeStatus?.()
      await agentHandle.dispose()
      try {
        const resumeOpts = {
          agentOptions: {
            provider: selectionRef.current?.provider ?? selection.provider,
            model: selectionRef.current?.model ?? selection.model,
          },
          setup,
        }
        agentHandle = id === ''
          ? await agents.create({
            sessionId: SessionId(`tui-${process.pid}-${Date.now()}`),
            meta: { cwd: process.cwd(), agentPreset: store.mode() },
            ...resumeOpts,
          })
          : await agents.resume({
            resumeSessionId: SessionId(id),
            ...resumeOpts,
          })
        agent = agentHandle.agent
        store.reset()
        disposeEvent = ctx.on('session/event', (session, event) => {
          if (session !== agent.session) return
          if (event.type === 'tool/call') {
            const { name, arguments: raw, callId } = event.data
            let parsed: unknown
            try { parsed = JSON.parse(raw) } catch { parsed = raw }
            callArgs.set(callId, { name, args: parsed })
          }
          const view = viewFor(tools, event, cid => callArgs.get(cid), agent)
          store.push({ sessionId: session.id, event, view, type: 'session/event' })
        })
        disposeStatus = ctx.on('agent/status', ({ agent: subject, status }) => {
          if (subject !== agent) return
          store.setStatus(status)
        })
        void refreshSessions()
      } catch (error: unknown) {
        process.stderr.write(`${NAME}: session switch failed: ${error instanceof Error ? error.message : String(error)}\n`)
      }
    }
    // Build the command palette. The TUI-local entries (model/theme/mode/
    // sessions) own the renderer or store; the rest come from the command
    // registry (`ctx.commands.list(agent)` → /compact /feedback /goal
    // /permission /plan) so every registered command is palette-reachable.
    // The registry is optional: a composition without dsh-commands mounted
    // shows only the TUI-local entries.
    // Build the command palette. The TUI-local entries own the renderer or
    // store and use `/`-prefixed labels so the slash menu's completion
    // produces a runnable command line (onSubmit's `/model`/`/theme`/`/mode`
    // branches match the label directly). The rest come from the command
    // registry (`ctx.commands.list(agent)` → /compact /feedback /goal
    // /permission /plan) so every registered command is palette-reachable.
    // The registry is optional: a composition without dsh-commands mounted
    // shows only the TUI-local entries.
    const localCommands: CommandEntry[] = [
      { label: '/model', description: 'change provider/model', run: () => { process.stdout.write('use /model <provider>/<model>\n') } },
      { label: '/theme', description: 'change color palette', run: () => { process.stdout.write(`themes: ${themeNames().join(', ')}\n`) } },
      { label: 'Switch language', description: 'en / zh UI locale', run: () => { process.stdout.write('use /lang <en|zh>\n') } },
      { label: '/mode', description: 'standard/PTC/minimal/cordis', run: () => { store.setMode(nextWorkMode(store.mode())) } },
      { label: '/sessions', description: 'reload sidebar list', run: () => { void refreshSessions() } },
      { label: '/clear', description: 'new session on current mode', run: () => { void onSelectSession('') } },
    ]
    const registryCommands: CommandEntry[] = commands === undefined ? [] : commands.list(agent).map(d => ({
      label: `/${d.name}`,
      description: d.description,
      run: () => {
        const controller = new AbortController()
        void commands.execute(agent, `/${d.name}`, [], controller.signal).then((result) => {
          if (result === undefined) return
          if (result.result.kind === 'error') {
            process.stderr.write(`${result.result.text ?? 'command error'}\n`)
          } else if (result.result.text !== undefined && result.result.text !== '') {
            process.stdout.write(`${result.result.text}\n`)
          }
          void refreshSessions()
        })
      },
    }))
    const paletteEntries = [...localCommands, ...registryCommands]
    // The @-mention completion source: `@path` calls fileReferences.list(agent,
    // query, signal) (packages/context/file-reference-local), `@[label]`
    // (session) reads store.sessions(). The runner exposes a single async
    // resolver the prompt's @-menu calls; @-mentions in the submitted text are
    // enriched by the file-reference/session-reference pre-step listeners
    // automatically (no runner post-processing).
    const resolveMentions = async (query: string): Promise<readonly MentionEntry[]> => {
      const items: MentionEntry[] = []
      // File candidates (when the host capability is mounted).
      if (fileReferences !== undefined) {
        const controller = new AbortController()
        try {
          const files = await fileReferences.list(agent, query, controller.signal)
          for (const f of files) items.push({ kind: 'file', label: f.path, insert: `@${f.path}` })
        } catch { /* aborted or query rejected */ }
      }
      // Session candidates (from the sidebar list). Match by id/title prefix.
      const q = query.toLowerCase()
      for (const s of store.sessions()) {
        if (q === '' || s.id.toLowerCase().includes(q) || s.title.toLowerCase().includes(q)) {
          items.push({ kind: 'session', label: s.title || s.id, insert: `@[${s.title || s.id}](dsh-session:${s.id})` })
        }
      }
      return items.length > 10 ? items.slice(0, 10) : items
    }
    await renderApp(
      createAppRoot(
        store,
        onSubmit,
        () => agent.session.id,
        paletteEntries,
        onCycleMode,
        (id: string) => { void onSelectSession(id) },
        resolveMentions,
      ),
      renderer,
    )
    // Defensive: the terminal-console overlay may have auto-opened during boot
    // (a transient render error before `openConsoleOnError: false` took effect,
    // or a plugin error). The overlay attaches its own stdin handler and would
    // swallow every key event, so hide it once after mount. `hide()` is a no-op
    // when the console is not visible.
    dismissConsoleOverlay(renderer)
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
    // Stop the renderer BEFORE restoring the terminal. The renderer's frame
    // loop writes cursor-position and rendering escape sequences to stdout;
    // without stopping it first, the terminal receives garbage text after
    // the alt screen exits (e.g. "35;27;12M35;26;12M…").
    renderer?.stop()
    // Restore the terminal: leave alt screen, show cursor.
    process.stdout.write('\x1b[?1049l\x1b[?25h')
    disposeEvent()
    disposeStatus()
    disposeApproval()
    disposeQuestions()
    await disposeAndExit(exitCode)
  }
}
