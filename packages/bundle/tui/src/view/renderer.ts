/**
 * OpenTUI FFI bootstrap: locate the platform native library, point OpenTUI at
 * it via `setRenderLibPath`, and create the async {@link CliRenderer}. Also
 * exposes a `renderApp` helper that mounts a Solid root with
 * `@opentui/solid`'s `render`.
 *
 * The renderer runs under Bun (the bin entrypoint is `bun lib/bin.js`); Bun's
 * FFI loads the `.so`/`.dylib`/`.dll` that the platform optional-dependency
 * package ships. The spike (commit 2c23b3320d) proved linux-x64 works; this
 * resolver is cross-platform and walks the pnpm store for any
 * `@opentui/core-*` package matching the current `process.platform` /
 * `process.arch`, with a musl suffix on linux when `OPENTUI_LIBC=musl`.
 *
 * @module @deepseek-ai/dsh-tui/view/renderer
 */

import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setRenderLibPath, createCliRenderer, type CliRenderer } from '@opentui/core'
import { render, type JSX } from '@opentui/solid'

/**
 * The native library file name per platform: `.so` on linux, `.dylib` on
 * darwin, `.dll` on win32. Matches the file the platform package ships.
 *
 * NOTE: the win32 package ships `opentui.dll` (no `lib` prefix), while linux
 * and darwin ship `libopentui.{so,dylib}`. OpenTUI's own
 * `resolveNativeLibraryPath` / `setRenderLibPath` handles this naming when
 * called directly, but `findNativeLibInStore` walks the pnpm store and must
 * know the exact file name to stat.
 */
const NATIVE_FILE_NAMES: Record<string, string> = {
  linux: 'libopentui.so',
  darwin: 'libopentui.dylib',
  win32: 'opentui.dll',
}

/**
 * Walk up from this module's directory until a `node_modules` directory is
 * found, then search the pnpm store (`.pnpm`) for a platform package matching
 * the current platform/arch. Returns the first match's native library path.
 * @param startDir - the directory to start walking up from.
 * @param platform - the platform string (e.g. `linux`, `darwin`, `win32`).
 * @param arch - the arch string (e.g. `x64`, `arm64`).
 * @param musl - whether to prefer the musl variant on linux.
 * @returns the absolute path to the native library, or undefined when not found.
 */
function findNativeLibInStore(
  startDir: string,
  platform: string,
  arch: string,
  musl: boolean,
): string | undefined {
  const fileName = NATIVE_FILE_NAMES[platform]
  if (fileName === undefined) return undefined
  const libcSuffix = platform === 'linux' && musl ? '-musl' : ''
  const pkgPrefix = `@opentui+core-${platform}-${arch}${libcSuffix}@`
  let dir = startDir
  for (let i = 0; i < 20; i++) {
    const nodeModules = join(dir, 'node_modules')
    if (existsSync(nodeModules)) {
      const pnpmDir = join(nodeModules, '.pnpm')
      if (existsSync(pnpmDir)) {
        try {
          const entries = readdirSync(pnpmDir)
          const match = entries.find(e => e.startsWith(pkgPrefix))
          if (match !== undefined) {
            const libPath = join(
              pnpmDir, match,
              'node_modules', `@opentui/core-${platform}-${arch}${libcSuffix}`,
              fileName,
            )
            if (existsSync(libPath)) return libPath
          }
        } catch {
          // unreadable .pnpm dir — fall through and keep walking up
        }
      }
    }
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

/**
 * Resolve the platform native library path for the current runtime. Mirrors
 * the spike's findSo but is cross-platform: tries linux/darwin/win32 with
 * the musl suffix on linux when `OPENTUI_LIBC=musl`. Throws when no matching
 * platform package is installed.
 * @returns the absolute path to the native library.
 * @throws Error when no platform package is installed for the current platform/arch.
 */
export function findSo(): string {
  const platform = process.platform
  const arch = process.arch
  if (platform !== 'linux' && platform !== 'darwin' && platform !== 'win32') {
    throw new Error(`OpenTUI is not supported on platform: ${platform}`)
  }
  if (arch !== 'x64' && arch !== 'arm64') {
    throw new Error(`OpenTUI is not supported on arch: ${arch}`)
  }
  const musl = process.env['OPENTUI_LIBC'] === 'musl'
  const here = fileURLToPath(import.meta.url)
  const startDir = resolve(here, '..')
  const libPath = findNativeLibInStore(startDir, platform, arch, musl)
  if (libPath === undefined) {
    throw new Error(
      `OpenTUI native library not found for ${platform}-${arch}${musl ? '-musl' : ''}. ` +
      'Install the matching @opentui/core-* platform package.',
    )
  }
  return libPath
}

/**
 * Create a {@link CliRenderer}: locate the native library, set its path, and
 * `await createCliRenderer()` (it is async because it queries terminal DSR over
 * stdin). The caller MUST `await` this before mounting any Solid root.
 * @returns the created renderer, ready for {@link renderApp}.
 * @throws Error when the native library cannot be found or terminal setup fails.
 */
export async function createTuiRenderer(): Promise<CliRenderer> {
  setRenderLibPath(findSo())
  const renderer = await createCliRenderer()
  return renderer
}

/**
 * Mount a Solid root into the renderer and start the render loop. Delegates to
 * `@opentui/solid`'s `render` (which reconciles the element tree), then calls
 * `renderer.start()` so the frame loop + stdin-driven key dispatch run. Without
 * `start()`, `render()` mounts the tree but the input loop never runs — the
 * `<input>`'s `onSubmit` never fires (the renderer reads stdin only while the
 * loop is active). The caller passes a root factory that closes over the store.
 * @param root - a factory returning the top-level JSX element.
 * @param renderer - the renderer returned by {@link createTuiRenderer}.
 * @returns a promise that resolves when the initial render is committed and the loop is started.
 */
export async function renderApp(root: () => JSX.Element, renderer: CliRenderer): Promise<void> {
  await render(root, renderer)
  renderer.start()
}
