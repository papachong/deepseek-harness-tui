/**
 * Package-owned invariant companion for `@ruhooai/dsh-tui`.
 * @module @ruhooai/dsh-tui/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@ruhooai/dsh-tui'

/** Cordis companion plugin name. */
export const name = 'tui-invariant'

/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: the runner is a process-level REPL driver over the
 * API carrier whose observable contract (streaming text on stdout, approval
 * answered from stdin, exit code by turn-end reason) is owned by the bin's
 * e2e; it registers nothing model-facing and holds no mutable relation to
 * audit inside the tree.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
