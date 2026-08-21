import { existsSync, statSync } from 'node:fs'

/**
 * Fail `npm publish` / `pnpm publish` unless the repo-root build produced the
 * artifacts the published bin resolves at runtime.
 *
 * The TUI is NOT a leaf package: its `tsconfig.json` references 12 workspace
 * projects, so `lib/types/*.js` is emitted by the root `tsc -b
 * tsconfig.host.json` and bundled by the root tsdown workspace pass. A
 * package-local `prepare` cannot reproduce that chain in isolation, so this
 * script does not build — it only asserts the root `pnpm run build` already
 * ran. Misconfiguration fails loud at the earliest resolvable point (publish),
 * not silently as a broken bin on the registry.
 *
 * Run by the `prepublishOnly` lifecycle hook.
 *
 * @module @deepseek-ai/dsh-tui/scripts/verify-published-artifacts
 * @private
 */

const artifacts = [
  'lib/bin.js',
  'lib/runner.js',
  'lib/answerers.js',
  'lib/view/app.js',
]

for (const artifact of artifacts) {
  if (!existsSync(artifact)) {
    console.error(
      `prepublishOnly: missing built artifact ${artifact} — run 'pnpm run build' at the repo root first. ` +
        'The TUI is not a leaf package; its lib/ requires the root tsc + tsdown + Bun view chain.',
    )
    process.exit(1)
  }
}

// Guard against a stale view build: lib/view/app.js must be newer than its
// src/view/app.tsx source. A stale .js from a prior release would ship Solid
// JSX compiled against an older @opentui/solid.
const viewSource = 'src/view/app.tsx'
const viewOutput = 'lib/view/app.js'
if (existsSync(viewSource) && existsSync(viewOutput)) {
  if (statSync(viewOutput).mtimeMs < statSync(viewSource).mtimeMs) {
    console.error(
      `prepublishOnly: ${viewOutput} is older than ${viewSource} — run 'pnpm run build' at the repo root to rebuild the Solid view layer.`,
    )
    process.exit(1)
  }
}
