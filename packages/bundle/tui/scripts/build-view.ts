// Bun.build step for the OpenTUI view layer: bundles the Solid JSX files under
// src/view/ into lib/view/ using @opentui/solid/bun-plugin's
// createSolidTransformPlugin().
//
// tsdown/rolldown does NOT compile Solid JSX (it ignores jsx:{runtime:'solid'}),
// so the .tsx files under src/view/ MUST go through this Bun.build step. The
// non-JSX spine modules (store.ts, renderer.ts) are emitted by tsc to
// lib/types/view/ and bundled by tsdown; only the .tsx files go here.
//
// Run via `bun scripts/build-view.ts` (invoked by the root build chain).
// @module @deepseek-ai/dsh-tui/scripts/build-view

import { build } from 'bun'
import { createSolidTransformPlugin } from '@opentui/solid/bun-plugin'

const result = await build({
  entrypoints: ['src/view/app.tsx'],
  outdir: 'lib/view',
  target: 'bun',
  format: 'esm',
  plugins: [createSolidTransformPlugin()],
  // Externalize @opentui/* and solid-js: they MUST resolve at runtime against
  // node_modules, NOT be inlined into the bundle. Bun.build otherwise inlines
  // @opentui/core-linux-x64's index.bun stub as a RELATIVE hash-named .so path
  // (e.g. "./libopentui-ysqfqwkq.so") resolved against the package root, where
  // the file does not exist (it lives in the pnpm store). Keeping these imports
  // external lets @opentui/core's own resolveNativeLibraryPath / setRenderLibPath
  // load the .so from its real pnpm-store location at runtime.
  external: [
    '@opentui/core',
    '@opentui/core-linux-x64',
    '@opentui/core-linux-x64-musl',
    '@opentui/core-linux-arm64',
    '@opentui/core-linux-arm64-musl',
    '@opentui/core-darwin-x64',
    '@opentui/core-darwin-arm64',
    '@opentui/core-win32-x64',
    '@opentui/core-win32-arm64',
    '@opentui/solid',
    '@opentui/keymap',
    'solid-js',
    'solid-js/store',
  ],
  sourcemap: 'external',
})

if (!result.success) {
  process.exit(1)
}
