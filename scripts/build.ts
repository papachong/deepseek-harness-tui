/** Run the complete repository build and bind its client artifacts to their public environment. */

import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { delimiter, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  CLIENT_BUILD_RECORD_PATH,
  clientBuildProcessEnvironment,
  repositoryCommitHash,
  resolveClientBuildEnvironment,
  writeClientBuildRecord,
} from './client-build-environment.ts'

/** Run one package script through the package manager that invoked this build. */
function runScript(script: string, environment: NodeJS.ProcessEnv): void {
  const packageManager = process.env.npm_execpath
  if (packageManager === undefined || packageManager === '') {
    throw new Error('build: npm_execpath is unavailable; invoke the build through a package script')
  }
  const result = spawnSync(process.execPath, [packageManager, 'run', script], {
    cwd: resolve(import.meta.dirname, '..'),
    env: environment,
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`build: ${script} exited with ${String(result.status ?? result.signal)}`)
  }
}

/**
 * Resolve the Bun executable from PATH. `command -v bun` is a shell builtin
 * (not spawnable via `spawnSync`), so walk `$PATH` entries for a `bun` binary
 * with the executable bit. Returns the absolute path, or undefined when absent.
 *
 * On Windows the binary is `bun.exe`; on POSIX it is `bun`. The PATH delimiter
 * is `;` on Windows and `:` on POSIX — `node:path.delimiter` picks the right
 * one. Bun ships under `~/.bun/bin` (POSIX) or `%USERPROFILE%\.bun\bin\bun-windows-x64`
 * (Windows zip install); neither is on PATH by default at process start, so
 * the walker also probes the well-known `~/.bun/bin` location when the PATH
 * walk finds nothing.
 */
function resolveBun(environment: NodeJS.ProcessEnv): string | undefined {
  const pathEnv = environment['PATH']
  const exeSuffix = process.platform === 'win32' ? '.exe' : ''
  if (pathEnv !== undefined && pathEnv !== '') {
    for (const dir of pathEnv.split(delimiter)) {
      if (dir === '') continue
      const candidate = resolve(dir, `bun${exeSuffix}`)
      try {
        if (existsSync(candidate)) return candidate
      } catch {
        // unreadable PATH entry — keep walking
      }
    }
  }
  // Fallback: probe the well-known Bun install location when the PATH walk
  // finds nothing (Bun's installer persists the dir to the user shell rc, but
  // a non-login spawnSync child does not source it).
  const home = environment['USERPROFILE'] ?? environment['HOME']
  if (home !== undefined && home !== '') {
    const fallbackDirs = process.platform === 'win32'
      ? [resolve(home, '.bun', 'bin', 'bun-windows-x64'), resolve(home, '.bun', 'bin')]
      : [resolve(home, '.bun', 'bin')]
    for (const dir of fallbackDirs) {
      const candidate = resolve(dir, `bun${exeSuffix}`)
      try {
        if (existsSync(candidate)) return candidate
      } catch {
        // unreadable fallback dir — keep walking
      }
    }
  }
  return undefined
}

/**
 * Run the `dsh-tui` OpenTUI view build (`bun scripts/build-view.ts`) when Bun
 * is on PATH. The view layer's `.tsx` files go through `Bun.build()` because
 * tsdown/rolldown does not compile Solid JSX; the non-JSX spine is already
 * bundled by tsdown in `build:lib`. Bun is required because
 * `@opentui/solid`'s `createSolidTransformPlugin` and the native FFI are
 * Bun-only. When Bun is absent (e.g. a CI lane that does not exercise the TUI
 * bin), the step is skipped with a warning — the `lib/view/*.js` artifacts are
 * only consumed at runtime under `bun lib/bin.js`, so a build lane without Bun
 * produces a spine that still type-checks and bundles. The release lane
 * installs Bun (`setup-bun` in `.github/workflows/release.yml`) so
 * `release:pack` ships `lib/view/*.js`.
 */
function runViewBuild(environment: NodeJS.ProcessEnv): void {
  const tuiDir = resolve(import.meta.dirname, '..', 'packages', 'bundle', 'tui')
  const buildScript = resolve(tuiDir, 'scripts', 'build-view.ts')
  if (!existsSync(buildScript)) return
  const bunPath = resolveBun(environment)
  if (bunPath === undefined) {
    console.warn('build: bun not found on PATH; skipping dsh-tui OpenTUI view build (lib/view/*.js). Install Bun to produce the TUI runtime bundle.')
    return
  }
  const result = spawnSync(bunPath, [buildScript], {
    cwd: tuiDir,
    env: environment,
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`build: dsh-tui view build exited with ${String(result.status ?? result.signal)}`)
  }
}

/** Run the full build selected by `--profile` or `DSH_BUILD_CLIENT_PROFILE`. */
function main(): void {
  const { values } = parseArgs({
    options: { profile: { type: 'string' } },
    allowPositionals: false,
  })
  const root = resolve(import.meta.dirname, '..')
  const parentEnvironment = {
    ...process.env,
    DSH_CLIENT_COMMIT_HASH: repositoryCommitHash(root, process.env),
  }
  const clientEnvironment = resolveClientBuildEnvironment(parentEnvironment, values.profile)
  const buildEnvironment = clientBuildProcessEnvironment(parentEnvironment, clientEnvironment)

  rmSync(resolve(root, CLIENT_BUILD_RECORD_PATH), { force: true })
  runScript('build:lib', buildEnvironment)
  runViewBuild(buildEnvironment)
  runScript('build:web', buildEnvironment)
  const record = writeClientBuildRecord(root, clientEnvironment)
  console.log(
    `build: recorded ${String(record.artifacts.fileCount)} client artifact(s) with ${String(Object.keys(record.environment).length)} public value(s)}`,
  )
}

if (import.meta.main) main()
