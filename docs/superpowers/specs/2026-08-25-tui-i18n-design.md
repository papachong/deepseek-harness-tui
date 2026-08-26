# TUI Runtime Internationalization (en / zh)

Date: 2026-08-25
Branch: `worktree-tui-i18n`

## Problem

The TUI view layer hardcodes every user-visible string as a literal in SolidJS components. The mix is inconsistent: UI chrome (placeholders, footers, palette title, sidebar header) is English-only; the four work-mode names and descriptions in `src/view/modes.ts` are Chinese-only (copied verbatim from each preset's `preset.yml` so the TUI "matches the Web UI"). Neither side is switchable at runtime. There is no i18n dependency, no `t()`/`useTranslation`, and no `/lang` command in the runner's slash-command table.

## Goal

A runtime language switch for the terminal UI with two locales (`en`, `zh`), mirroring the proven `theme.ts` pattern (SolidJS signal + global accessors + a `/theme`-style REPL command). No new dependencies.

## Design

### Module: `src/view/i18n.ts`

The single source of locale state, structured to match `src/view/theme.ts` (the existing precedent: a module-scoped `createSignal`, derived accessors, and a swap function that components read inside tracking scopes to re-render).

- `type Locale = 'en' | 'zh'`
- `detectLocale(): Locale` — reads `process.env.LANG ?? process.env.LC_ALL ?? process.env.LC_MESSAGES`; any value containing `zh`, `CHS`, or `CN` (case-insensitive) yields `'zh'`; otherwise `'en'` (GitHub's international audience makes English the safe default).
- `[locale, setLocale] = createSignal<Locale>(detectLocale())` — the reactive root.
- `t(key: string): string` — looks up `MESSAGES[locale()][key]`; an unknown key falls back to the key itself (fail-soft, never throws; a missing translation never breaks the render).
- `locale(): Locale` — the active locale accessor (reads the signal).
- `localeNames(): readonly Locale[]` — `['en', 'zh']` for `/lang` listing.

### Dictionary (in `i18n.ts`)

Two flat objects keyed by semantic dotted paths. Coverage is the set of strings the pre-implementation audit found hardcoded:

| key | en | zh |
| --- | --- | --- |
| `prompt.task` | `task> ` | `任务> ` |
| `prompt.answer` | `answer> ` | `回答> ` |
| `prompt.plan` | `plan> ` | `计划> ` |
| `palette.title` | `command palette` | `命令面板` |
| `sidebar.sessions` | `sessions` | `会话` |
| `home.footer` | `tab cycle · ctrl+p palette · /help` | `tab 切模式 · ctrl+p 面板 · /help` |
| `chat.footer` | `ctrl+s sessions · ctrl+p palette · tab mode` | `ctrl+s 会话 · ctrl+p 面板 · tab 模式` |
| `lang.listing` | `langs: en, zh (active: {locale})` | `语言: en, zh（当前: {locale}）` |
| `lang.switched` | `lang: {locale}` | `语言: {locale}` |
| `lang.unknown` | `unknown lang: {arg}; available: en, zh` | `未知语言: {arg}; 可选: en, zh` |
| `mode.standard.name` | `Standard` | `标准模式` |
| `mode.standard.desc` | `Full-featured coding agent: file edits, shell, file & web retrieval, skills, plans, goals, subagents, workflows.` | `功能完整的编码 Agent，支持文件编辑、Shell、文件与网页检索、Skills、计划、目标、子代理和工作流。` |
| `mode.code.name` | `PTC` | `PTC 模式` |
| `mode.code.desc` | `All of Standard, plus Code Mode SDK presenting tools so the model composes multi-step operations as one TypeScript program.` | `具备标准模式的全部能力，并通过 Code Mode SDK 呈现工具，让模型用一个 TypeScript 程序组合多步操作。` |
| `mode.minimal.name` | `Minimal` | `极简模式` |
| `mode.minimal.desc` | `A two-tool coding agent: persistent bash plus str_replace_editor only.` | `仅提供持久 bash 与 str_replace_editor 的双工具编码 Agent。` |
| `mode.cordis.name` | `Create` | `创造模式` |
| `mode.cordis.desc` | `For building custom agent presets: all of Standard, plus runtime introspection, plugin experimentation, and preset authoring guidance.` | `用于创建自定义 Agent preset：具备标准模式的全部能力，并提供运行时检查、插件实验和 preset 创作指导。` |

Interpolation uses a `{name}` placeholder convention; `t` accepts an optional `params` record and replaces `{name}` occurrences. Kept inline (no dependency) — the dictionary is small.

### `modes.ts` refactor

`WORK_MODES` keeps its static `id`/`name`/`description` shape, but `name`/`description` become **getter functions** calling `t(...)`, or the callers (`workMode`, the status bar, the home banner) read the translated values at render time instead of at module load. The preset `id` is not localized (it is a stable machine identifier passed to `agentPresets.mount`); only the display strings are.

### `/lang [en|zh]` command (`src/runner.ts`)

Inserted into the slash-command dispatch in `onSubmit`, immediately after the existing `/theme` block (both are view-local commands that mutate a view signal, not the agent session):

- No arg → print `t('lang.listing', { locale: locale() })` to stdout.
- Known arg (`en`/`zh`, case-insensitive) → `setLocale(arg)`, print `t('lang.switched', { locale: arg })`.
- Unknown → print `t('lang.unknown', { arg })`.

The command-palette local entry list gains a `Switch language` row mirroring `Switch theme`.

### String replacement

Every hardcoded literal identified by the audit is replaced with a `t(...)` call in the component that owns it:

- `src/view/components/home.tsx` — quick-action labels and `home.footer`.
- `src/view/components/prompt.tsx` — `task>`/`answer>`/`plan>` placeholders.
- `src/view/components/sidebar.tsx` — `sessions` header.
- `src/view/components/command-palette.tsx` — `command palette` title.
- `src/view/components/status-bar.tsx` — mode name reads through `modeName()` which now translates.
- `src/view/app.tsx` — chat-page footer.
- `src/view/modes.ts` — name/description translations.

Non-translatable literals (key bindings like `Ctrl+P`, `Tab`, file paths, the `process.cwd()` footer value) stay as-is.

## Testing

TDD, package-level Vitest. `tests/i18n.spec.ts` (AAA pattern), written RED first:

- `t('prompt.task')` returns the English value under the default (detected) locale and the Chinese value after `setLocale('zh')`.
- `setLocale('zh')` then `setLocale('en')` flips `t(...)` results both ways (the signal is the single source of truth).
- `t('nonexistent.key')` returns the key string unchanged (fail-soft).
- `detectLocale()` maps `zh_CN.UTF-8` → `'zh'`, `en_US.UTF-8` → `'en'`, and empty/unset env → `'en'` (env is injected via a thin seam, not monkey-patched on `process.env`).
- Interpolation: `t('lang.switched', { locale: 'zh' })` yields the translated string with `{locale}` replaced.

The `detectLocale` test needs an injectable env source (a function parameter or an options object) so the unit test does not mutate the real `process.env` and so CI locale differences cannot flip it.

## Out of scope

- No persistence of the chosen locale across runs (no config file write); the env-detected default is restored each launch. A future `dsh-tui` config block can persist it when one exists.
- No locale beyond `en`/`zh`. The dictionary is closed; adding a locale is a future change to `Locale` plus a new object.
- No translation of model-facing text (prompts, tool schemas, agent replies) — only the UI chrome, per the model-facing contract rule.
- No changes to `README.md`/`README.zh.md` docs pairing (that is a documentation concern, already satisfied).

## Non-obvious decisions

- **English is the fallback default, not the system locale's exact value.** When the env gives no signal, English reaches the broader GitHub audience; the `/lang` command is the explicit override for anyone whose detection is wrong.
- **`/lang` mutates a view signal, not the agent.** Like `/theme` and `/mode`, it owns the renderer/store, so the runner stays the dispatch authority and no agent round-trip is needed. The SolidJS signal triggers re-render of any component reading `t(...)` inside a tracking scope.
- **Unknown keys fail soft to the key string.** A missing translation must never blank a button or crash a render; the key itself is a readable (if English) placeholder during development.
- **Interpolation is inline, not a dependency.** The only parameterized strings are the `/lang` listing/switched/unknown messages; a 3-line `String.replace` covers it.
