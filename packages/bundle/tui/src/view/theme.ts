/**
 * Centralized TUI theme: role/status colors, panel/background tokens, and the
 * syntax-highlight style for `<markdown>` code blocks. Consolidates the
 * per-component hardcoded named colors into one truecolor palette so the view
 * layer is recolorable in one place.
 *
 * Colors use `#rrggbb` hex (OpenTUI's `parseColor` accepts hex + the 16 W3C
 * named colors + `RGBA` objects; it does NOT accept `rgb(...)` strings — those
 * silently fall back to magenta). The palette below borrows the one-dark
 * family for syntax tokens and a neutral dark panel set for chrome.
 *
 * @module @deepseek-ai/dsh-tui/view/theme
 */

import { SyntaxStyle } from '@opentui/core'

/** Message author role, drives the left-border color and the prefix glyph. */
export type Role = 'user' | 'assistant'

/** The role → foreground color (hex) map for prefixes and left borders. */
export const ROLE_COLORS: Record<Role, string> = {
  user: '#4ade80',
  assistant: '#22d3ee',
}

/** The role → prefix glyph shown before each message body. */
export const ROLE_PREFIX: Record<Role, string> = {
  user: '❯',
  assistant: '●',
}

/** Tool/tool-card status → color (hex). */
export const STATUS_COLORS = {
  pending: '#facc15',
  completed: '#4ade80',
  error: '#f87171',
} as const

/** Tool-card state → status glyph. */
export const STATUS_GLYPH = {
  pending: '⠋', // animated; replaced by <Spinner> at runtime, static fallback here
  completed: '✓',
  error: '✗',
} as const

/** Panel/background/border truecolor tokens for chrome (status bar, prompt divider). */
export const CHROME = {
  bgPanel: '#0f0f17',
  bgElement: '#1a1a2e',
  border: '#3a3a4e',
  borderActive: '#22d3ee',
  textMuted: '#7f848e',
  text: '#e4e4e7',
} as const

/**
 * Module-level cached {@link SyntaxStyle}. One per process: the native handle
 * is an FFI resource, recreating it per render leaks and stalls. Built once
 * from a one-dark-style token map so code blocks in `<markdown>` get colored
 * keywords/strings/comments instead of the flat default.
 */
export const SYNTAX_THEME: SyntaxStyle = SyntaxStyle.fromStyles({
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
})

/** Braille spinner frames, 80ms cadence (matches opencode's spinner). */
export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const

/** Spinner tick interval in milliseconds. */
export const SPINNER_INTERVAL_MS = 80
