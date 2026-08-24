/**
 * Work-mode definitions for the TUI's Tab-cycling surface. The four modes map
 * 1:1 to the shipped agent presets in `apps/cli/config/agent-presets/` — their
 * display names and descriptions are copied verbatim from each preset's
 * `preset.yml` so the TUI's labels match the Web UI's. The actual agent
 * composition swap happens in the runner (Stage D); this module owns only the
 * vocabulary + cycling order the view layer reads.
 *
 * @module @deepseek-ai/dsh-tui/view/modes
 */

/** The preset id; joins the agent via `meta.preset` in the runner. */
export type WorkMode = 'standard' | 'code' | 'minimal' | 'cordis'

/** One work mode's display metadata, copied from `preset.yml`. */
export interface WorkModeDef {
  /** The preset id (the value passed to the agent). */
  readonly id: WorkMode
  /** Display name (Chinese, matches the Web UI). */
  readonly name: string
  /** One-line description (Chinese, matches the Web UI). */
  readonly description: string
}

/**
 * The ordered mode list. Tab cycles in this order; the index of the active mode
 * advances by one (wrapping). `standard` is first so it is the default.
 */
export const WORK_MODES: readonly WorkModeDef[] = [
  {
    id: 'standard',
    name: '标准模式',
    description: '功能完整的编码 Agent，支持文件编辑、Shell、文件与网页检索、Skills、计划、目标、子代理和工作流。',
  },
  {
    id: 'code',
    name: 'PTC 模式',
    description: '具备标准模式的全部能力，并通过 Code Mode SDK 呈现工具，让模型用一个 TypeScript 程序组合多步操作。',
  },
  {
    id: 'minimal',
    name: '极简模式',
    description: '仅提供持久 bash 与 str_replace_editor 的双工具编码 Agent。',
  },
  {
    id: 'cordis',
    name: '创造模式',
    description: '用于创建自定义 Agent preset：具备标准模式的全部能力，并提供运行时检查、插件实验和 preset 创作指导。',
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
