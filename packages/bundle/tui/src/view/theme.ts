/**
 * Centralized TUI theme: role/status colors, panel/background tokens, the
 * syntax-highlight style for `<markdown>` code blocks, and the named-theme
 * registry. Consolidates the per-component hardcoded named colors into one
 * truecolor palette so the view layer is recolorable in one place — and
 * switchable at runtime via the `/theme <name>` REPL command.
 *
 * Colors use `#rrggbb` hex (OpenTUI's `parseColor` accepts hex + the 16 W3C
 * named colors + `RGBA` objects; it does NOT accept `rgb(...)` strings — those
 * silently fall back to magenta).
 *
 * @module @deepseek-ai/dsh-tui/view/theme
 */

import { RGBA, SyntaxStyle } from '@opentui/core'
import { createSignal } from 'solid-js'

/**
 * Linearly blend `a` toward `b` by `factor` (0 → a, 1 → b), returning a
 * `#rrggbb` hex string. Used for the logo shadow cells (25% toward the
 * background) and any hover/pressed color derivation. Mirrors opencode's
 * theme `tint` helper.
 * @param a - the source color.
 * @param b - the target color.
 * @param factor - blend factor in [0, 1].
 * @returns the blended `#rrggbb` hex color.
 */
export function tint(a: string, b: string, factor: number): string {
  const ca = RGBA.fromHex(a)
  const cb = RGBA.fromHex(b)
  const mix = (x: number, y: number): number => Math.round(x + (y - x) * factor)
  const r = mix(ca.r, cb.r)
  const g = mix(ca.g, cb.g)
  const bch = mix(ca.b, cb.b)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bch.toString(16).padStart(2, '0')}`
}

/** Message author role, drives the left-border color and the prefix glyph. */
export type Role = 'user' | 'assistant'

/** One complete theme definition: all color tokens the view layer reads. */
export interface ThemeDef {
  /** Display name shown by `/theme`. */
  readonly name: string
  /** Role → foreground color for prefixes and left borders. */
  readonly roleColors: Record<Role, string>
  /** Role → prefix glyph. */
  readonly rolePrefix: Record<Role, string>
  /** Tool status → color. */
  readonly status: { pending: string; completed: string; error: string }
  /** Chrome (status bar, prompt divider, panels). */
  readonly chrome: {
    readonly bgPanel: string
    readonly bgElement: string
    readonly border: string
    readonly borderActive: string
    readonly textMuted: string
    readonly text: string
  }
  /** Syntax token → style for `<markdown>` code blocks. */
  readonly syntax: Record<string, { fg?: string; bg?: string; bold?: boolean; italic?: boolean; dim?: boolean }>
}

/**
 * The built-in theme registry. Each entry is a full palette; `/theme <name>`
 * swaps the active one at runtime. `one-dark` is the default. Adding a theme
 * is one object literal here — no component changes needed.
 */
export const THEMES: readonly ThemeDef[] = [
  {
    name: 'one-dark',
    roleColors: { user: '#4ade80', assistant: '#22d3ee' },
    rolePrefix: { user: '❯', assistant: '●' },
    status: { pending: '#facc15', completed: '#4ade80', error: '#f87171' },
    chrome: {
      bgPanel: '#0f0f17', bgElement: '#1a1a2e', border: '#3a3a4e', borderActive: '#22d3ee',
      textMuted: '#7f848e', text: '#e4e4e7',
    },
    syntax: {
      keyword: { fg: '#c678dd', bold: true },
      string: { fg: '#98c379' },
      comment: { fg: '#7f848e', italic: true },
      'function': { fg: '#61afef' },
      number: { fg: '#d19a66' },
      type: { fg: '#e5c07b' },
      operator: { fg: '#56b6c2' },
      variable: { fg: '#e06c75' },
      property: { fg: '#61afef' },
      tag: { fg: '#e06c75' },
      punctuation: { fg: '#abb2bf' },
    },
  },
  {
    name: 'catppuccin',
    roleColors: { user: '#a6e3a1', assistant: '#89dceb' },
    rolePrefix: { user: '❯', assistant: '●' },
    status: { pending: '#f9e2af', completed: '#a6e3a1', error: '#f38ba8' },
    chrome: {
      bgPanel: '#1e1e2e', bgElement: '#181825', border: '#313244', borderActive: '#89dceb',
      textMuted: '#a6adc8', text: '#cdd6f4',
    },
    syntax: {
      keyword: { fg: '#cba6f7', bold: true },
      string: { fg: '#a6e3a1' },
      comment: { fg: '#7f849c', italic: true },
      'function': { fg: '#89b4fa' },
      number: { fg: '#fab387' },
      type: { fg: '#e4c07e' },
      operator: { fg: '#94e2d5' },
      variable: { fg: '#f38ba8' },
      property: { fg: '#89b4fa' },
      tag: { fg: '#f38ba8' },
      punctuation: { fg: '#bac2de' },
    },
  },
  {
    name: 'dracula',
    roleColors: { user: '#50fa7b', assistant: '#8be9fd' },
    rolePrefix: { user: '❯', assistant: '●' },
    status: { pending: '#f1fa8c', completed: '#50fa7b', error: '#ff5555' },
    chrome: {
      bgPanel: '#282a36', bgElement: '#21222c', border: '#44475a', borderActive: '#8be9fd',
      textMuted: '#6272a4', text: '#f8f8f2',
    },
    syntax: {
      keyword: { fg: '#ff79c6', bold: true },
      string: { fg: '#50fa7b' },
      comment: { fg: '#6272a4', italic: true },
      'function': { fg: '#8be9fd' },
      number: { fg: '#bd93f9' },
      type: { fg: '#f1fa8c' },
      operator: { fg: '#ff79c6' },
      variable: { fg: '#f8f8f2' },
      property: { fg: '#8be9fd' },
      tag: { fg: '#ff79c6' },
      punctuation: { fg: '#f8f8f2' },
    },
  },
  {
    name: 'nord',
    roleColors: { user: '#a3be8c', assistant: '#88c0d0' },
    rolePrefix: { user: '❯', assistant: '●' },
    status: { pending: '#ebcb8b', completed: '#a3be8c', error: '#bf616a' },
    chrome: {
      bgPanel: '#2e3440', bgElement: '#3b4252', border: '#4c566a', borderActive: '#88c0d0',
      textMuted: '#616e88', text: '#e5e9f0',
    },
    syntax: {
      keyword: { fg: '#b48ead', bold: true },
      string: { fg: '#a3be8c' },
      comment: { fg: '#616e88', italic: true },
      'function': { fg: '#88c0d0' },
      number: { fg: '#ebcb8b' },
      type: { fg: '#8fbcbb' },
      operator: { fg: '#81a1c1' },
      variable: { fg: '#d8dee9' },
      property: { fg: '#88c0d0' },
      tag: { fg: '#bf616a' },
      punctuation: { fg: '#d8dee9' },
    },
  },
]

/** The active theme signal; components read this and re-render on swap. */
const initialTheme: ThemeDef = THEMES[0] as ThemeDef
const [activeTheme, setActiveTheme] = createSignal<ThemeDef>(initialTheme)

/**
 * Resolve a theme by name (case-insensitive); returns undefined when unknown.
 * @param name - the theme display name.
 * @returns the matching theme, or undefined.
 */
export function findTheme(name: string): ThemeDef | undefined {
  const lower = name.toLowerCase()
  return THEMES.find(t => t.name.toLowerCase() === lower)
}

/**
 * Retrieve the currently active theme definition.
 * @returns the currently active theme.
 */
export function theme(): ThemeDef { return activeTheme() }

/**
 * Retrieve the names of all registered themes for `/theme` listing.
 * @returns the names of all registered themes.
 */
export function themeNames(): readonly string[] { return THEMES.map(t => t.name) }

/**
 * Switch the active theme by name. No-op (returns false) when the name is
 * unknown; components reading `theme()` re-render on success.
 * @param name - the theme display name.
 * @returns true when switched, false when unknown.
 */
export function switchTheme(name: string): boolean {
  const found = findTheme(name)
  if (found === undefined) return false
  setActiveTheme(found)
  return true
}

// ---- Derived accessors (kept for backward compat with existing imports) ----
// These read the active theme so existing `ROLE_COLORS` / `CHROME` references
// stay reactive when the theme swaps. Components that read them inside a
// tracking scope re-render on `switchTheme`.

/** The role → foreground color for the active theme. */
export const ROLE_COLORS: Record<Role, string> = new Proxy({} as Record<Role, string>, {
  get(_t, key: string) { return theme().roleColors[key as Role] },
})
/** The role → prefix glyph for the active theme. */
export const ROLE_PREFIX: Record<Role, string> = new Proxy({} as Record<Role, string>, {
  get(_t, key: string) { return theme().rolePrefix[key as Role] },
})
/** Tool status → color for the active theme. */
export const STATUS_COLORS = new Proxy({} as { pending: string; completed: string; error: string }, {
  get(_t, key: string) {
    return theme().status[key as keyof ThemeDef['status']]
  },
})
/** Tool-card state → status glyph. */
export const STATUS_GLYPH = {
  pending: '⠋',
  completed: '✓',
  error: '✗',
} as const
/** Chrome tokens for the active theme. */
export const CHROME = new Proxy({} as ThemeDef['chrome'], {
  get(_t, key: string) { return theme().chrome[key as keyof ThemeDef['chrome']] },
})

/**
 * Build a {@link SyntaxStyle} from the active theme's syntax map. Called on
 * theme swap (the caller owns the lifecycle: destroy the old, create the new).
 * @returns a SyntaxStyle for the active theme.
 */
export function buildSyntaxStyle(): SyntaxStyle {
  return SyntaxStyle.fromStyles(theme().syntax)
}

/** Braille spinner frames, 80ms cadence (matches opencode's spinner). */
export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const

/** Spinner tick interval in milliseconds. */
export const SPINNER_INTERVAL_MS = 80
