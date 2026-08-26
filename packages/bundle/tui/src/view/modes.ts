/**
 * Work-mode definitions for the TUI's Tab-cycling surface. The four modes map
 * 1:1 to the shipped agent presets in `apps/cli/config/agent-presets/`. The
 * preset `id` is a stable machine identifier passed to `agentPresets.mount`;
 * only the display `name`/`description` are localized via `t()` so they read
 * from the active locale at render time, not at module load. The actual agent
 * composition swap happens in the runner; this module owns only the
 * vocabulary + cycling order the view layer reads.
 *
 * @module @ruhooai/dsh-tui/view/modes
 */

import { t } from './i18n.js'

/** The preset id; joins the agent via `meta.preset` in the runner. */
export type WorkMode = 'standard' | 'code' | 'minimal' | 'cordis'

/** One work mode's display metadata. `name`/`description` translate lazily. */
export interface WorkModeDef {
  /** The preset id (the value passed to the agent). */
  readonly id: WorkMode
  /** Resolves the display name for the active locale. */
  readonly name: () => string
  /** Resolves the one-line description for the active locale. */
  readonly description: () => string
}

/**
 * The ordered mode list. Tab cycles in this order; the index of the active mode
 * advances by one (wrapping). `standard` is first so it is the default.
 */
export const WORK_MODES: readonly WorkModeDef[] = [
  {
    id: 'standard',
    name: () => t('mode.standard.name'),
    description: () => t('mode.standard.desc'),
  },
  {
    id: 'code',
    name: () => t('mode.code.name'),
    description: () => t('mode.code.desc'),
  },
  {
    id: 'minimal',
    name: () => t('mode.minimal.name'),
    description: () => t('mode.minimal.desc'),
  },
  {
    id: 'cordis',
    name: () => t('mode.cordis.name'),
    description: () => t('mode.cordis.desc'),
  },
]

/** The default work mode (first in {@link WORK_MODES}). */
export const DEFAULT_WORK_MODE: WorkMode = (WORK_MODES[0] as WorkModeDef).id

/**
 * Look up a mode definition by id.
 * @param id - the preset id.
 * @returns the mode definition, or undefined when unknown.
 */
export function workMode(id: WorkMode): WorkModeDef | undefined {
  return WORK_MODES.find(m => m.id === id)
}

/**
 * The next mode in the Tab cycle, wrapping after the last.
 * @param current - the current mode id.
 * @returns the next mode id.
 */
export function nextWorkMode(current: WorkMode): WorkMode {
  const idx = WORK_MODES.findIndex(m => m.id === current)
  const next = (idx + 1) % WORK_MODES.length
  return (WORK_MODES[next] as WorkModeDef).id
}
