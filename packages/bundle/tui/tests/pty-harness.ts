/**
 * Pseudo-terminal smoke harness for the `dsh-tui` bin: boots `bun lib/bin.js`
 * in a real PTY, drives marker-gated keystrokes, and returns the captured
 * terminal output. Mirrors the deleted `apps/cli/tests/pty-harness.ts` POSIX
 * driver (python3 `pty.fork`) but stripped to the OpenTUI bin's needs — no
 * `resolveExampleLaunch` (the bin is a built artifact, not a tsx source
 * launch), no Windows ConPTY path (the TUI is Bun-only, and Bun's FFI is
 * not available under Node's `node-pty` Windows path).
 *
 * @module @deepseek-ai/dsh-tui/tests/pty-harness
 */

import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execa } from 'execa'

/** A marker-gated terminal input action. */
export type PtyAction = {
  /** Substring to wait for in the PTY output before sending. */
  readonly waitFor: string
  /** Occurrence count to wait for (default 1). */
  readonly occurrence?: number
  /** Bytes to write to the PTY after the marker renders. */
  readonly send: string
}

/** Inputs for one `dsh-tui` PTY smoke. */
export interface TuiPtySmokeOptions {
  /** Diagnostic label for error messages. */
  readonly label: string
  /** Temp-dir prefix for the isolated workspace. */
  readonly tempDirPrefix: string
  /** Absolute path to `lib/bin.js`. */
  readonly binPath: string
  /** `cordis.yml` path argument (or undefined for the built-in default). */
  readonly configPath?: string
  /** Process working directory; defaults to the TUI package directory. */
  readonly workingDirectory?: string
  /** Marker-gated input actions. */
  readonly actions?: readonly PtyAction[]
  /** Extra environment for the bin. */
  readonly env?: Readonly<NodeJS.ProcessEnv>
  readonly expectedExitCode?: number
  readonly timeoutMs?: number
  /** PTY columns; defaults to 100. */
  readonly columns?: number
  /** PTY rows; defaults to 30. */
  readonly rows?: number
}

/** The POSIX python3 PTY driver: `pty.fork`, marker-gated writes, output capture. */
const POSIX_PTY_DRIVER = String.raw`
import errno, fcntl, json, os, pty, select, signal, struct, sys, termios, time
bun, bin_path, config_path, cwd, actions_json, expected_exit, timeout_seconds, columns, rows = sys.argv[1:]
env = os.environ.copy()
env.update({"COLUMNS": columns, "LINES": rows})
env.pop("COLORTERM", None)
actions = json.loads(actions_json)
pid, fd = pty.fork()
if pid == 0:
    os.chdir(cwd)
    args = [bun, bin_path]
    if config_path:
        args.append(config_path)
    os.execvpe(bun, args, env)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", int(rows), int(columns), 0, 0))
output = bytearray()
action_index = 0
deadline = time.monotonic() + float(timeout_seconds)
status = None
while time.monotonic() < deadline:
    ready, _, _ = select.select([fd], [], [], 0.05)
    if ready:
        try:
            chunk = os.read(fd, 65536)
        except OSError as error:
            if error.errno != errno.EIO:
                raise
            chunk = b""
        if chunk:
            output.extend(chunk)
    while action_index < len(actions):
        marker = actions[action_index]["waitFor"].encode()
        if output.count(marker) < actions[action_index].get("occurrence", 1):
            break
        os.write(fd, actions[action_index]["send"].encode())
        action_index += 1
    waited, candidate = os.waitpid(pid, os.WNOHANG)
    if waited == pid:
        status = candidate
        break
if status is None:
    os.kill(pid, signal.SIGKILL)
    _, status = os.waitpid(pid, 0)
sys.stdout.buffer.write(output)
if action_index != len(actions):
    sys.stderr.write(f"completed {action_index}/{len(actions)} PTY actions before timeout\n")
    sys.exit(124)
actual_exit = os.waitstatus_to_exitcode(status)
if actual_exit != int(expected_exit):
    sys.stderr.write(f"expected exit {expected_exit}, got {actual_exit}\n")
    sys.exit(125)
`

/** Resolve the Bun executable from PATH (same walk as scripts/build.ts). */
function resolveBun(environment: NodeJS.ProcessEnv): string {
  const pathEnv = environment['PATH'] ?? ''
  for (const dir of pathEnv.split(':')) {
    if (dir === '') continue
    const candidate = join(dir, 'bun')
    if (existsSync(candidate)) return candidate
  }
  throw new Error('tui-pty: bun not found on PATH; the dsh-tui bin runs under Bun')
}

const INHERITED_ENVIRONMENT_KEYS = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR', 'TMP', 'TEMP'] as const

function createChildEnvironment(overrides: Readonly<NodeJS.ProcessEnv> | undefined): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  for (const name of INHERITED_ENVIRONMENT_KEYS) {
    const value = process.env[name]
    if (value !== undefined) environment[name] = value
  }
  for (const [name, value] of Object.entries(overrides ?? {})) {
    if (value !== undefined) environment[name] = value
  }
  return environment
}

/**
 * Boot `bun lib/bin.js` in a real PTY, drive marker-gated keystrokes, and
 * return the captured terminal output after the expected process exit.
 * @param options - launch paths, environment, actions, and expected exit code.
 * @returns the complete PTY output bytes (as a string).
 */
export async function runTuiPtySmoke(options: TuiPtySmokeOptions): Promise<string> {
  // The bin dynamically imports ./view/app.js which externalizes solid-js +
  // @opentui/* — those resolve from the TUI package's node_modules. Run the
  // bin from its own package dir (where node_modules lives), NOT from a
  // mkdtemp temp dir (which has no node_modules → the dynamic import fails).
  // The temp dir is only for the session workspace ($DSH_HOME etc.) if needed.
  const cwd = options.workingDirectory ?? resolve(options.binPath, '..', '..')
  const timeoutMs = options.timeoutMs ?? 30_000
  try {
    const bun = resolveBun(process.env)
    const environment = createChildEnvironment(options.env)
    const result = await execa('python3', [
      '-c', POSIX_PTY_DRIVER,
      bun,
      options.binPath,
      options.configPath ?? '',
      cwd,
      JSON.stringify(options.actions ?? []),
      String(options.expectedExitCode ?? 0),
      String(timeoutMs / 1_000),
      String(options.columns ?? 100),
      String(options.rows ?? 30),
    ], {
      env: environment,
      extendEnv: false,
      stdin: 'ignore',
      timeout: timeoutMs + 5_000,
      killSignal: 'SIGKILL',
      reject: false,
      stripFinalNewline: false,
    })
    if (result.timedOut) {
      throw new Error(`${options.label} PTY driver timed out. stdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
    }
    if (result.failed) {
      throw new Error(`${options.label} PTY driver exited ${String(result.exitCode)}. stdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
    }
    return result.stdout
  } finally {
    // No temp dir to clean (cwd is the package dir).
  }
}
