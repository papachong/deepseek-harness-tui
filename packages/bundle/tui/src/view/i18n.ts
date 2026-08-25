/**
 * Runtime internationalization for the TUI view layer. Mirrors the `theme.ts`
 * pattern: a module-scoped SolidJS signal owns the active locale, `t()` reads
 * it inside tracking scopes so `setLocale` re-renders, and the runner's
 * `/lang` command is the runtime override. Locale is detected from the system
 * env at startup (LANG / LC_ALL / LC_MESSAGES); `/lang` overrides it.
 *
 * @module @deepseek-ai/dsh-tui/view/i18n
 */

import { createSignal } from 'solid-js'

/** The two supported locales. */
export type Locale = 'en' | 'zh'

/** The runtime-overridable parameter record for {@link t}. */
export type TranslationParams = Record<string, string>

/** The env-source signature `detectLocale` reads from. */
export type LocaleEnv = Record<string, string | undefined>

const ZH_HINT = /zh|chs|cn/i

/**
 * Detect the locale from the system environment. Any locale env value
 * containing `zh`, `CHS`, or `CN` (case-insensitive) yields `'zh'`;
 * otherwise `'en'` (English is the safe default for the GitHub audience).
 * @param env - the env source; defaults to `process.env`.
 * @returns the detected locale.
 */
export function detectLocale(env: LocaleEnv = process.env): Locale {
  const raw = env.LANG ?? env.LC_ALL ?? env.LC_MESSAGES
  if (raw === undefined || raw === '') return 'en'
  return ZH_HINT.test(raw) ? 'zh' : 'en'
}

const MESSAGES_EN: Record<string, string> = {
  'prompt.task': 'task> ',
  'prompt.answer': 'answer> ',
  'prompt.plan': 'plan> ',
  'palette.title': 'command palette',
  'sidebar.sessions': 'sessions',
  'home.footer': 'tab cycle · ctrl+p palette · /help',
  'chat.footer': 'ctrl+s sessions · ctrl+p palette · tab mode',
  'lang.listing': 'langs: en, zh (active: {locale})',
  'lang.switched': 'lang: {locale}',
  'lang.unknown': 'unknown lang: {arg}; available: en, zh',
  'mode.standard.name': 'Standard',
  'mode.standard.desc': 'Full-featured coding agent: file edits, shell, file & web retrieval, skills, plans, goals, subagents, workflows.',
  'mode.code.name': 'PTC',
  'mode.code.desc': 'All of Standard, plus Code Mode SDK presenting tools so the model composes multi-step operations as one TypeScript program.',
  'mode.minimal.name': 'Minimal',
  'mode.minimal.desc': 'A two-tool coding agent: persistent bash plus str_replace_editor only.',
  'mode.cordis.name': 'Create',
  'mode.cordis.desc': 'For building custom agent presets: all of Standard, plus runtime introspection, plugin experimentation, and preset authoring guidance.',
}

const MESSAGES_ZH: Record<string, string> = {
  'prompt.task': '任务> ',
  'prompt.answer': '回答> ',
  'prompt.plan': '计划> ',
  'palette.title': '命令面板',
  'sidebar.sessions': '会话',
  'home.footer': 'tab 切模式 · ctrl+p 面板 · /help',
  'chat.footer': 'ctrl+s 会话 · ctrl+p 面板 · tab 模式',
  'lang.listing': '语言: en, zh（当前: {locale}）',
  'lang.switched': '语言: {locale}',
  'lang.unknown': '未知语言: {arg}; 可选: en, zh',
  'mode.standard.name': '标准模式',
  'mode.standard.desc': '功能完整的编码 Agent，支持文件编辑、Shell、文件与网页检索、Skills、计划、目标、子代理和工作流。',
  'mode.code.name': 'PTC 模式',
  'mode.code.desc': '具备标准模式的全部能力，并通过 Code Mode SDK 呈现工具，让模型用一个 TypeScript 程序组合多步操作。',
  'mode.minimal.name': '极简模式',
  'mode.minimal.desc': '仅提供持久 bash 与 str_replace_editor 的双工具编码 Agent。',
  'mode.cordis.name': '创造模式',
  'mode.cordis.desc': '用于创建自定义 Agent preset：具备标准模式的全部能力，并提供运行时检查、插件实验和 preset 创作指导。',
}

const DICTIONARIES: Record<Locale, Record<string, string>> = {
  en: MESSAGES_EN,
  zh: MESSAGES_ZH,
}

const [localeSignal, setLocaleSignal] = createSignal<Locale>(detectLocale())

/** The active locale accessor (reads the signal). */
export function locale(): Locale { return localeSignal() }

/** The available locales for `/lang` listing. */
export function localeNames(): readonly Locale[] { return ['en', 'zh'] }

/**
 * Switch the active locale. Components reading `t(...)` inside a tracking
 * scope re-render on success. Unknown values are ignored (returns false).
 * @param next - the locale to switch to.
 * @returns true when switched, false when unknown.
 */
export function setLocale(next: Locale): boolean {
  if (next !== 'en' && next !== 'zh') return false
  setLocaleSignal(next)
  return true
}

/**
 * Resolve a translation key for the active locale. An unknown key falls back
 * to the key string itself (fail-soft: a missing translation never breaks
 * the render). `{name}` placeholders in the value are replaced from `params`.
 * @param key - the dotted translation key.
 * @param params - optional interpolation values.
 * @returns the translated, interpolated string.
 */
export function t(key: string, params?: TranslationParams): string {
  const dict = DICTIONARIES[localeSignal()]
  const value = dict[key] ?? key
  if (params === undefined) return value
  return value.replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? `{${name}}`)
}
