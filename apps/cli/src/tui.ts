/**
 * `dsh` default surface — the interactive TUI coding agent. Boots the shipped
 * shared base and TUI overlay, followed by either `--config` or the personal overlay
 * from the Harness home (`~/.dsh`): its `.env` fills environment gaps (precedence:
 * ambient environment, then the invoking directory's `.env`, then the personal one)
 * and its `config.yaml` patches the booted tree. The workspace is the invoking
 * directory: the session cwd, relative paths, and workspace instructions resolve
 * from it, so `dsh` acts on whatever project it is launched in. Session storage
 * is the exception — it lives under the Harness home so `/resume` reaches every
 * workspace, and an in-place resume enters the selected session's own directory.
 * `dsh meta` is the one exception — it makes this harness
 * checkout the workspace. `dsh upgrade` is a fresh session whose
 * first turn auto-invokes a bundled skill. After boot, the agent's system
 * prompt is told the path to this harness checkout so it can find its own
 * source.
 * @module @deepseek-ai/dsh/tui
 */

import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  addHarnessSourceSection,
  boot,
  installFailLoud,
  loadOverlayPatches,
  loadPersonalPatches,
  resolveConfigPath,
  watchPersonalPatches,
} from '@deepseek-ai/dsh-app-boot'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { PatchOptions } from '@cordisjs/plugin-include'
import { SessionId } from '@deepseek-ai/dsh-session'
import { configHasTelemetryRow, resolveTelemetryPatch } from './app-cli-entry.ts'
import { SESSION_QUERY_SQLITE_PATH_KEY } from '@deepseek-ai/dsh-session-query-sqlite'
import { CONFIGURED_AGENT_IDENTITIES_KEY } from '@deepseek-ai/dsh-agent-loop'
import type { Context } from 'cordis'
import {
  INITIAL_SKILL_KEY,
  MAIN_SESSION_ID_KEY,
  TUI_GOODBYE_MESSAGE_KEY,
  type MainSessionIdentity,
  type TuiResumeHost,
} from '@deepseek-ai/dsh-tui'
import {
  apply as applyTuiFirstRunWelcome,
  hasTuiFirstRunWelcomeAcknowledgement,
  inject as tuiFirstRunWelcomeInject,
  name as tuiFirstRunWelcomeName,
  needsTuiFirstRunWelcomeAsciiArt,
} from './tui-onboarding/tui-first-run-welcome.ts'
import {
  TUI_FIRST_RUN_WELCOME_NOTICE_VERSION,
} from './tui-onboarding/tui-first-run-welcome-copy.ts'

const NAME = 'dsh'

// The shared core every `dsh` surface mounts, and the TUI's own overlay over
// it. Both the source tree (apps/cli/src) and the bundled bin (apps/cli/lib)
// sit one directory under apps/cli, so each resolves with the same hop.
const BASE_CONFIG = fileURLToPath(new URL('../config/base.cordis.yml', import.meta.url))
const TUI_OVERLAY = fileURLToPath(new URL('../config/tui.cordis.yml', import.meta.url))

// The `agents` entry in tui.cordis.yml the TUI drives; the launcher binds its
// session identity by this config id.
const MAIN_AGENT_ID = 'main'

/** Per-process filename of the disposable `/resume` index. */
const SESSION_QUERY_DB = `session-query-${String(process.pid)}-${randomUUID()}.db`

// The harness checkout root: three hops up from apps/cli/{src,lib}, resolved
// from this bin's location so it holds however `dsh` is launched (a PATH
// symlink, an arbitrary cwd). The agent is told where its own source lives.
/** The harness checkout used as the `dsh meta` workspace and source prompt path. */
export const SOURCE_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/* v8 ignore start -- composition over the unit-tested dsh-app-boot helpers;
   the CLI PTY smoke drives this path end to end, personal overlay included */
/**
 * Run the interactive TUI from the invoking directory.
 * @param config - an overlay patch list applied over the shared base and the
 * TUI overlay, REPLACING the personal `~/.dsh/config.yaml` so a named tree never
 * inherits the user's route, or `undefined` to use the personal overlay;
 * already parsed from `--config`.
 * @param resumeSessionId - a persisted session id to resume, or `undefined` to
 * mint a fresh one; already parsed and non-empty-validated from `--resume`.
 * Either way the resulting identity reaches the booted app through
 * {@link CONFIGURED_AGENT_IDENTITIES_KEY}, so no config key selects the session
 * and an overlay replacing the agent row cannot drop it.
 * @param workspace - a directory to make the workspace instead of the invoking
 * one, or `undefined` to keep the cwd. Only `dsh meta` passes it.
 * @param initialSkill - a bundled skill to auto-invoke as a fresh session's
 * first turn, or `undefined`. Set only by `dsh upgrade` and
 * ignored on a resume, so it never re-fires; reaches the app through
 * {@link INITIAL_SKILL_KEY}.
 * @param configReplace - a config path to boot as the ENTIRE tree, bypassing the
 * shared base, the TUI overlay, and the personal overlay alike, or `undefined`
 * to compose them; already parsed from `--config-replace`.
 */
export async function runTui(
  config: string | undefined,
  resumeSessionId: string | undefined,
  workspace?: string,
  initialSkill?: string,
  configReplace?: string,
): Promise<void> {
  // Refuse pipes BEFORE booting: a compose-time throw inside the Loader tree
  // is logged per-entry rather than rethrown, so a piped launch would
  // otherwise settle into an idle UI-less process instead of exiting nonzero.
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write(
      `${NAME}: the TUI requires stdin and stdout to be interactive TTYs; use \`${NAME} -p "task"\` for pipes and automation\n`,
    )
    process.exit(1)
  }
  // The bin already loaded the invoking directory's .env, and that is the
  // whole environment: $DSH_HOME/.env is credentials-local's writable store,
  // and hoisting it would make every stored key read as a read-only ambient
  // override on the next run — unrotatable from the TUI or the web page.
  // The environment is settled, so switching the workspace here cannot alter
  // its precedence. The cwd IS the workspace seam: the shipped config
  // resolves the session cwd and the HMR watch root from it, so one chdir moves
  // both together. Sessions themselves live under the Harness home so `/resume`
  // spans every workspace, and are unaffected by this chdir.
  if (workspace !== undefined) process.chdir(workspace)
  const dshHome = resolveDshHome()
  const showFirstRunWelcome = !await hasTuiFirstRunWelcomeAcknowledgement(
    dshHome,
    TUI_FIRST_RUN_WELCOME_NOTICE_VERSION,
  )
  process.env.DSH_BUNDLED_SKILL_DIR = join(SOURCE_ROOT, 'skills')
  // The in-place `/resume` handoff re-execs `dsh` with a normalized `--resume`
  // flag, so the resumed process rehydrates through this same intake. The
  // selected session may belong to another workspace, so the handoff also enters
  // that directory. The host is offered only when Node exposes `process.execve`
  // and knows its own entry.
  const resolvedConfig = config === undefined ? undefined : resolve(config)
  const resolvedConfigReplace = configReplace === undefined ? undefined : resolve(configReplace)
  const entry = process.argv[1]
  const execve = process.execve?.bind(process)
  const app: { current?: Context } = {}
  // The Loader mounts entries concurrently, so `ui-tui` can already hold the
  // terminal (raw mode, bracketed paste, keyboard protocol) when something
  // else fails. A config-tree failure settles through `boot`, which disposes
  // the tree itself; this release covers the rejections `boot` cannot see — a
  // plugin's detached async work rejecting while mounting is still in flight
  // or after the tree settled. Disposing the tree runs the TUI's own shutdown,
  // which stops the terminal and hands the shell back; without it such a
  // failure returns to a corrupted prompt. `app.current` is captured from
  // boot's `prepare` hook, so it holds the root context for the whole mounting
  // window rather than only after boot resolves.
  installFailLoud(NAME, process, async () => {
    await app.current?.fiber.dispose()
  })
  // Resume always enters the default surface because meta rejects
  // parent options, including `--resume`. The resumed session already persists
  // its cwd.
  const resumeArgs = (sessionId: string): string[] => [
    `--resume=${sessionId}`,
    // Both config flags must survive the handoff: resuming into a different
    // tree than the session was created in would silently change the agent.
    ...resolvedConfig !== undefined ? ['--config', resolvedConfig] : [],
    ...resolvedConfigReplace !== undefined ? ['--config-replace', resolvedConfigReplace] : [],
  ]
  // Mint the fresh id here rather than in the app bundle: the exit line names
  // the session to resume, so the launcher must know it before the tree boots.
  const identity: MainSessionIdentity = resumeSessionId === undefined
    ? { id: SessionId(`main-session-${randomUUID()}`), resume: false }
    : { id: SessionId(resumeSessionId), resume: true }
  const goodbye = `To resume this session: ${NAME} ${resumeArgs(identity.id).join(' ')}`
  const resumeHost: TuiResumeHost | undefined = entry === undefined || execve === undefined ? undefined : {
    async handoff(sessionId, cwd): Promise<never> {
      const current = app.current
      if (current === undefined) throw new Error(`${NAME}: app boot has not completed`)
      const nextArgv = [
        process.execPath,
        ...process.execArgv,
        entry,
        ...resumeArgs(sessionId),
      ]
      // `execve` inherits the cwd, and the target session may belong to another
      // workspace. Enter it BEFORE teardown commits: an unreachable directory
      // (deleted, unreadable) must reject while the caller can still restore the
      // terminal, and a chdir after disposal would have no owner to report to.
      try {
        process.chdir(cwd)
      } catch (error) {
        throw new Error(`${NAME}: cannot resume in "${cwd}": ${String(error)}`)
      }
      try {
        await current.fiber.dispose()
        execve(process.execPath, nextArgv, process.env)
        throw new Error('process replacement returned unexpectedly')
      } catch (error) {
        process.stderr.write(`${NAME}: resume handoff failed after terminal release: ${String(error)}\n`)
        process.exit(1)
      }
    },
  }
  // One include of the shared base, with every overlay applied as a sibling
  // patch list: patches never cross an include boundary, so stacking these as
  // nested includes would silently stop reaching base rows. Later lists win.
  //
  // `--config` REPLACES the personal overlay rather than layering under it: an
  // explicitly named tree must not inherit `~/.dsh/config.yaml`'s route, or a
  // demo or test config would silently run on the user's provider and model.
  // `--config-replace` additionally discards the base and the surface overlay.
  const replaceTree = configReplace !== undefined
  const bootConfig = resolvedConfigReplace === undefined ? BASE_CONFIG : resolveConfigPath(resolvedConfigReplace, undefined)
  // Same opt-out semantics as the web surface (resolveTelemetryPatch: any
  // non-empty value disables; setting the switch against a tree without the
  // row fails loud rather than silently no-opping a privacy switch). The row
  // presence is checked against the tree actually booting, so a
  // --config-replace tree is judged on its own rows, not the shipped base's.
  const telemetryPatch = resolveTelemetryPatch(process.env.DSH_TELEMETRY_DISABLED, configHasTelemetryRow(bootConfig))
  const composePatches = (personalPatches: PatchOptions[]): PatchOptions[] => [
    ...replaceTree ? [] : [
      ...loadOverlayPatches(NAME, TUI_OVERLAY),
      ...resolvedConfig === undefined
        ? personalPatches
        : loadOverlayPatches(NAME, resolveConfigPath(resolvedConfig, undefined)),
    ],
    ...telemetryPatch === undefined ? [] : [telemetryPatch],
  ]
  const patches = composePatches(loadPersonalPatches(NAME) ?? [])
  const queryIndexPath = join(tmpdir(), SESSION_QUERY_DB)
  const ctx = await boot(
    NAME,
    bootConfig,
    patches,
    (hostCtx) => {
      // Runs after the Loader installs and before any config-tree entry mounts,
      // so the fail-loud release hook can reach the tree for the whole window in
      // which an entry may reject.
      app.current = hostCtx
      // The launcher owns session identity and the exit line: a config-mounted
      // app bundle reads both from these slots, so no cordis.yml key can drop
      // resume.
      hostCtx.provide(MAIN_SESSION_ID_KEY, identity)
      hostCtx.provide(TUI_GOODBYE_MESSAGE_KEY, goodbye)
      // Shared-store policy is the launcher's: sessions live in one root under
      // the Harness home across every cwd, so /resume sees every workspace.
      // The bundle treats the slot as opaque.
      // The agent-loop row reads this to bind `main`, and the tui row reads the
      // same id, so a personal overlay repointing the model route cannot drop
      // the session identity or desynchronise the two.
      hostCtx.provide(CONFIGURED_AGENT_IDENTITIES_KEY, { [MAIN_AGENT_ID]: identity })
      // The query database is a disposable derived index with single-process
      // ownership. Keep it process-local while it indexes the shared logs.
      hostCtx.provide(SESSION_QUERY_SQLITE_PATH_KEY, queryIndexPath)
      hostCtx.effect(() => async () => {
        await Promise.all([
          rm(queryIndexPath, { force: true }),
          rm(`${queryIndexPath}-wal`, { force: true }),
          rm(`${queryIndexPath}-shm`, { force: true }),
        ])
      }, `${SESSION_QUERY_SQLITE_PATH_KEY}.cleanup`)
      if (resumeHost !== undefined) hostCtx.provide('tuiResumeHost', resumeHost)
      // Seed the first turn only for a fresh session, so resuming never
      // re-invokes the skill.
      if (initialSkill !== undefined && resumeSessionId === undefined) {
        hostCtx.provide(INITIAL_SKILL_KEY, initialSkill)
      }
    },
  )
  // The shipped tree includes HMR and keeps personal config live. An explicit
  // --config tree replaces the personal overlay (so there is nothing to keep
  // live), and a --config-replace or HMR-less tree remains a valid composition
  // that still receives the startup overlay but deliberately has no hidden
  // watcher.
  if (resolvedConfig === undefined && !replaceTree && ctx.get('hmr') !== undefined) {
    await watchPersonalPatches(ctx, { binName: NAME, compose: composePatches })
  }
  app.current = ctx
  addHarnessSourceSection(ctx, SOURCE_ROOT)
  if (showFirstRunWelcome) {
    await ctx.plugin({
      name: tuiFirstRunWelcomeName,
      inject: tuiFirstRunWelcomeInject,
      apply: applyTuiFirstRunWelcome,
    }, {
      dshHome,
      asciiArt: needsTuiFirstRunWelcomeAsciiArt(),
    })
  }
}
/* v8 ignore stop */
