#!/usr/bin/env node
/**
 * dsh-tui bin: boot the terminal UI REPL.
 *
 * Bun runtime note: the bin entrypoint runs under `bun lib/bin.js` (the OpenTUI
 * FFI requires Bun's `bun:ffi`; Node.js is unsupported). Bun 1.3.14 lacks
 * `process.loadEnvFile` — the app-boot `loadEnv()` called inside `runTui`
 * calls it and try/catches ENOENT but not the TypeError from a missing
 * function. Bun loads `.env` natively, so the call is redundant under Bun;
 * the guard below short-circuits it. The app-boot `loadEnv` itself is shared
 * and left untouched.
 * @module @ruhooai/dsh-tui/bin
 */

// Bun lacks process.loadEnvFile; Bun loads .env natively, so the call inside
// app-boot's loadEnv() is redundant under Bun. Guard the property so the
// downstream loadEnv() that reaches process.loadEnvFile under Bun does not
// throw TypeError. The function-shaped no-op satisfies the typeof check
// without loading anything (Bun already populated process.env from .env at
// process start).
if (typeof process.loadEnvFile !== 'function') {
  process.loadEnvFile = () => {}
}

// The package-local bunfig.toml is only discovered when Bun starts from this
// directory. Load the preloader here before the runner imports Solid so a
// workspace-root invocation still gets the reactive Solid runtime.
const SOLID_PRELOAD = '@opentui/solid/preload'

async function start(): Promise<void> {
  await import(SOLID_PRELOAD)
  const { runTui } = await import('./runner.ts')

  void runTui()
}

void start()

export {}
