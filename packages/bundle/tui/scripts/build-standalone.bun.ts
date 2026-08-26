// Bun.build --compile: produces a standalone dsh-tui binary for the current
// platform. Run on each platform's CI runner.
//
// The binary embeds the Bun runtime + ALL JS EXCEPT @opentui/core (which
// reads its own ../package.json via createRequire at import time — that
// fails inside a --compile binary's virtual FS). @opentui/core's JS + the
// platform .so are shipped beside the binary in a node_modules/ tree so
// the bare specifier resolves at runtime.
//
// `--compile-autoload-package-json` makes the compiled binary discover a
// local package.json at startup, which sets the module-resolution CWD to
// the binary's directory so the node_modules tree is found.
//
// @module @ruhooai/dsh-tui/scripts/build-standalone
import { $ } from 'bun'
import { existsSync, mkdirSync, copyFileSync, cpSync } from 'node:fs'
import { join, resolve } from 'node:path'

const here = resolve(import.meta.dir, '..')
const target = `bun-${process.platform}-${process.arch}`
const outDir = join(here, 'dist', target)
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

// 1. Patch lib/bin.js: skip the runtime @opentui/solid/preload import.
const patchedBin = join(here, 'lib', 'bin.standalone.js')
const orig = await Bun.file(join(here, 'lib', 'bin.js')).text()
const patched = orig.replace(
  /await import\(__rewriteRelativeImportExtension\(SOLID_PRELOAD, true\)\)/,
  '/* preload skipped: solid transform applied at build time */',
)
await Bun.write(patchedBin, patched)

// 2. Build: bundle everything EXCEPT @opentui/core + broken musl symlinks.
const binName = process.platform === 'win32' ? 'dsh-tui.exe' : 'dsh-tui'
const binPath = join(outDir, binName)

console.log(`Building ${target} → ${binPath}`)
await $`bun build --compile ${patchedBin} --target ${target} --outfile ${binPath} --no-compile-autoload-bunfig --compile-autoload-package-json -e @opentui/core -e @opentui/core-linux-x64-musl -e @opentui/core-linux-arm64-musl -e @deepseek-ai/dsh-llm`.quiet()

// 3. Ship the FULL @opentui/core package (all chunks, testing, etc.) in a
//    node_modules tree beside the binary. Copying individual files misses
//    chunk-*.js dependencies that index.bun.js imports relatively.
const nmDir = join(outDir, 'node_modules')
const corePkgDir = join(nmDir, '@opentui', 'core')
mkdirSync(corePkgDir, { recursive: true })

let coreSrc: string | undefined
let dir = here
for (let i = 0; i < 20; i++) {
  const candidate = join(dir, 'node_modules', '@opentui', 'core')
  if (existsSync(candidate)) { coreSrc = candidate; break }
  const parent = resolve(dir, '..')
  if (parent === dir) break
  dir = parent
}
if (coreSrc !== undefined) {
  cpSync(coreSrc, corePkgDir, { recursive: true })
  console.log('  ✓ @opentui/core (full package)')
} else {
  console.warn('  WARNING: @opentui/core not found')
}

// 4. Copy the platform native library into its platform package dir.
const NATIVE_FILE = process.platform === 'win32' ? 'opentui.dll'
  : process.platform === 'darwin' ? 'libopentui.dylib'
    : 'libopentui.so'
const PLATFORM_PKG_NAME = `@opentui/core-${process.platform === 'win32' ? 'win32' : process.platform}-${process.arch}`

let soPath: string | undefined
let soDir: string | undefined
dir = here
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
  copyFileSync(soPath, join(platPkgDir, NATIVE_FILE))
  const platPkgJson = join(soDir, 'node_modules', PLATFORM_PKG_NAME, 'package.json')
  if (existsSync(platPkgJson)) copyFileSync(platPkgJson, join(platPkgDir, 'package.json'))
  console.log(`  ✓ ${NATIVE_FILE} (${PLATFORM_PKG_NAME})`)
} else {
  console.warn(`  WARNING: ${NATIVE_FILE} not found — install ${PLATFORM_PKG_NAME}`)
}

// 5. Copy cordis.yml.
for (const cfg of ['cordis.yml', 'cordis.snapshot.yml']) {
  const cfgPath = join(here, cfg)
  if (existsSync(cfgPath)) copyFileSync(cfgPath, join(outDir, cfg))
}

console.log(`Done. Artifact: ${outDir}/`)
