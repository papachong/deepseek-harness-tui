import { defineConfig } from 'tsdown'

/**
 * Builds each published entry as a self-contained file admitted by the package
 * whitelist. Mirrors packages/examples/jsonrpc-demo/tsdown.config.ts: the root
 * workspace tsdown only bundles `index`/`invariant`, so this package-local
 * config adds the bin and its runtime modules (`runner`, `answerers`,
 * `capture`) so `lib/bin.js` resolves without hitting node_modules for the
 * TUI's own code. Render and transport modules bundle into the entries that
 * import them (`codeSplitting: false`).
 *
 * `solid-js`, `solid-js/store`, and `@opentui/*` are EXTERNAL on the
 * `runner`/`answerers` entries: the store (tsdown-bundled in `runner.js`) and
 * the JSX components (Bun.build-bundled in `lib/view/app.js`) MUST share ONE
 * `solid-js` instance. If tsdown inlines its own copy, the store's signals
 * (created via the inlined `createStore`) and the `<For>` memo (created via
 * the external `solid-js` that `app.js` resolves at runtime) are different
 * Solid runtimes — signals do not cross instances, the `<For>` never
 * re-runs, and the view never updates. Keeping these external makes both
 * sides resolve the same `node_modules/solid-js`.
 */
const EXTERNAL = [
  'solid-js',
  'solid-js/store',
  '@opentui/core',
  '@opentui/solid',
  '@opentui/keymap',
]

export default defineConfig([
  {
    entry: ['lib/types/index.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
    fixedExtension: false, outputOptions: { codeSplitting: false }, dts: false, clean: false,
  },
  {
    entry: ['lib/types/invariant.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
    fixedExtension: false, outputOptions: { codeSplitting: false }, dts: false, clean: false,
  },
  {
    entry: ['lib/types/bin.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
    fixedExtension: false, outputOptions: { codeSplitting: false }, dts: false, clean: false,
  },
  {
    entry: ['lib/types/runner.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
    fixedExtension: false, outputOptions: { codeSplitting: false }, dts: false, clean: false,
    external: EXTERNAL,
  },
  {
    entry: ['lib/types/answerers.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
    fixedExtension: false, outputOptions: { codeSplitting: false }, dts: false, clean: false,
    external: EXTERNAL,
  },
  {
    entry: ['lib/types/capture.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
    fixedExtension: false, outputOptions: { codeSplitting: false }, dts: false, clean: false,
  },
])
