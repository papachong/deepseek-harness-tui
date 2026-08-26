// Bun.build --compile: produces a standalone dsh-tui binary for the current
// platform. Run on each platform's CI runner.
//
// Strategy (learned from opencode/packages/opencode/script/build.ts): bundle
// @opentui/core wholesale into the binary instead of externalizing it. The
// native .so/.dylib/.dll loads via a *computed* specifier
// (`@opentui/core-${platform}-${arch}`) that Bun.build cannot resolve at
// compile time, so the platform native package stays external and ships
// beside the binary in a node_modules tree. Core's Solid tree-sitter
// parser.worker.js is read at build time and injected into the binary's
// virtual FS via `files:`, with its path exposed through a `define`
// (`OTUI_TREE_SITTER_WORKER_PATH`) so core's `resolveWorkerPath()` reads the
// virtual file instead of failing `import.meta.url` resolution inside the
// virtual FS.
//
// `autoloadPackageJson` makes the compiled binary discover a local
// package.json at startup, setting the module-resolution CWD to the binary's
// directory so the external node_modules tree is found.
//
// @module @ruhooai/dsh-tui/scripts/build-standalone
import { $ } from 'bun'
import { existsSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = resolve(import.meta.dir, '..')
const target = `bun-${process.platform}-${process.arch}`
const outDir = join(here, 'dist', target)
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

// 1. Patch lib/bin.js: skip the runtime @opentui/solid/preload import.
//    Under --compile the bunfig.toml preload is unavailable; the Solid
//    reactive runtime is established at build time instead.
const patchedBin = join(here, 'lib', 'bin.standalone.js')
const orig = await Bun.file(join(here, 'lib', 'bin.js')).text()
const patched = orig.replace(
  /await import\(__rewriteRelativeImportExtension\(SOLID_PRELOAD, true\)\)/,
  '/* preload skipped: solid transform applied at build time */',
)
await Bun.write(patchedBin, patched)

// 2. Resolve the @opentui/core parser.worker.js source to inject as a virtual
//    file. Core's `resolveWorkerPath()` checks a `OTUI_TREE_SITTER_WORKER_PATH`
//    define first, so we define it to the bunfs virtual root path and inject
//    the worker source there (opencode build.ts ~L160-196).
let workerSource: string | undefined
try {
  const resolved = import.meta.resolve('@opentui/core/parser.worker', import.meta.url)
  workerSource = readFileSync(fileURLToPath(resolved), 'utf8')
} catch {
  // Build proceeds without the injected worker; core falls back to disk.
}

const treeSitterWorkerPath = 'opentui-tree-sitter-worker.js'
const bunfsRoot = process.platform === 'win32' ? 'B:/~BUN/root/' : '/$bunfs/root/'

const binName = process.platform === 'win32' ? 'dsh-tui.exe' : 'dsh-tui'
const binPath = join(outDir, binName)

console.log(`Building ${target} → ${binPath}`)

// 3. Build via the Bun.build JS API: bundles @opentui/core (and all JS) while
//    keeping only the platform native packages external (computed specifier,
//    unresolvable at compile time). The worker source is injected as a virtual
//    file and its path defined for core's resolver.
const externals = [
  '@opentui/core-linux-x64',
  '@opentui/core-linux-x64-musl',
  '@opentui/core-linux-arm64',
  '@opentui/core-linux-arm64-musl',
  '@opentui/core-darwin-x64',
  '@opentui/core-darwin-arm64',
  '@opentui/core-win32-x64',
  '@opentui/core-win32-arm64',
]
await Bun.build({
  entrypoints: [patchedBin],
  format: 'esm',
  target: 'bun' as never,
  compile: {
    // autoloadBunfig/autoloadTsconfig off: the preload is build-time only.
    // autoloadPackageJson on: Bun discovers the package.json anchored to the
    // binary's disk directory (copied below), which sets the module-resolution
    // CWD so the external node_modules tree resolves. The entry module's type
    // (ESM) is read from this package.json, avoiding a virtual-FS probe.
    autoloadBunfig: false,
    autoloadTsconfig: false,
    autoloadPackageJson: true,
    target: target as never,
    outfile: binPath,
  },
  external: externals,
  define: workerSource === undefined ? {} : {
    OTUI_TREE_SITTER_WORKER_PATH: JSON.stringify(bunfsRoot + treeSitterWorkerPath),
  },
  files: {
    // Inject the package.json at /$bunfs/package.json — one level ABOVE the
    // entry (/$bunfs/root/dsh-tui), where Bun's ESM-type walk-up probes
    // `../package.json`. Bare `files:` keys land at /$bunfs/root/<key>; an
    // absolute virtual path lands at that exact bunfs location.
    ...(process.platform === 'win32'
      ? { 'B:/~BUN/package.json': readFileSync(join(here, 'package.json'), 'utf8') }
      : { '/$bunfs/package.json': readFileSync(join(here, 'package.json'), 'utf8') }),
    ...(workerSource === undefined ? {} : { [treeSitterWorkerPath]: workerSource }),
  },
})

// 4. Ship the platform native library in a node_modules tree beside the binary.
//    Core loads it via the computed specifier `@opentui/core-${platform}-${arch}`,
//    resolved from the binary's CWD (set by autoloadPackageJson).
const nmDir = join(outDir, 'node_modules')
const PLATFORM_PKG_NAME = `@opentui/core-${process.platform === 'win32' ? 'win32' : process.platform}-${process.arch}`
const NATIVE_FILE = process.platform === 'win32' ? 'opentui.dll'
  : process.platform === 'darwin' ? 'libopentui.dylib'
    : 'libopentui.so'

let soPath: string | undefined
let soDir: string | undefined
let dir = here
for (let i = 0; i < 20; i++) {
  const candidate = join(dir, 'node_modules', PLATFORM_PKG_NAME, NATIVE_FILE)
  if (existsSync(candidate)) { soPath = candidate; soDir = dir; break }
  const parent = resolve(dir, '..')
  if (parent === dir) break
  dir = parent
}
if (soPath !== undefined && soDir !== undefined) {
  const platPkgDir = join(nmDir, '@opentui', PLATFORM_PKG_NAME.split('/').pop()!)
  mkdirSync(platPkgDir, { recursive: true })
  // The platform package's index.bun.js does `import("./libopentui.so", { with: { type: "file" } })`,
  // so ship the native file + index + package.json.
  const platSrc = join(soDir, 'node_modules', PLATFORM_PKG_NAME)
  for (const f of [NATIVE_FILE, 'index.bun.js', 'package.json']) {
    const src = join(platSrc, f)
    if (existsSync(src)) copyFileSync(src, join(platPkgDir, f))
  }
  console.log(`  ✓ ${NATIVE_FILE} (${PLATFORM_PKG_NAME})`)
} else {
  console.warn(`  WARNING: ${NATIVE_FILE} not found — install ${PLATFORM_PKG_NAME}`)
}

// 5. Copy cordis.yml.
for (const cfg of ['cordis.yml', 'cordis.snapshot.yml']) {
  const cfgPath = join(here, cfg)
  if (existsSync(cfgPath)) copyFileSync(cfgPath, join(outDir, cfg))
}

// 6. Copy the package's own package.json beside the binary. Bun's standalone
//    binary sets its CWD to the binary's directory, so a package.json there
//    anchors module resolution for the external node_modules tree (the
//    `@opentui/core-${platform}-${arch}` specifier resolves from here).
copyFileSync(join(here, 'package.json'), join(outDir, 'package.json'))

console.log(`Done. Artifact: ${outDir}/`)
