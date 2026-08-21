/**
 * Live DeepSeek PTY smoke for `dsh-tui`: boots the bin, types a prompt, waits
 * for the model's streamed reply, and asserts the reply renders with ANSI
 * styling (not raw stdout). Self-skips without `DEEPSEEK_API_KEY` (the e2e
 * contract — real-API tests self-skip without a key).
 *
 * @module @deepseek-ai/dsh-tui/tests/live-pty.spec
 */

import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runTuiPtySmoke } from './pty-harness.ts'

const TUI_BIN = resolve(import.meta.dirname, '..', 'lib', 'bin.js')
const TUI_CONFIG = resolve(import.meta.dirname, '..', 'cordis.yml')
const hasKey = process.env['DEEPSEEK_API_KEY'] !== undefined && process.env['DEEPSEEK_API_KEY'] !== ''

describe.skipIf(!hasKey)('dsh-tui live DeepSeek PTY', { timeout: 120_000 }, () => {
  it('renders the model reply with ANSI styling after a typed prompt', async () => {
    const output = await runTuiPtySmoke({
      label: 'live-deepseek',
      tempDirPrefix: 'dsh-tui-live-',
      binPath: TUI_BIN,
      configPath: TUI_CONFIG,
      columns: 100,
      rows: 30,
      timeoutMs: 90_000,
      env: {
        DEEPSEEK_API_KEY: process.env['DEEPSEEK_API_KEY'],
        https_proxy: process.env['https_proxy'] ?? 'http://127.0.0.1:7890',
        http_proxy: process.env['http_proxy'] ?? 'http://127.0.0.1:7890',
      },
      actions: [
        // Wait for the task> prompt, then type a prompt + Enter.
        { waitFor: 'task>', send: 'Say hello in one short sentence.\r' },
        // The runner writes a [capture] dry-run line on exit; type exit + Enter
        // after the model reply renders (the 2nd task> appears once the turn ends).
        { waitFor: 'task>', occurrence: 2, send: 'exit\r' },
      ],
    })
    // The onSubmit probe confirms the input loop ran (renderer.start() wired
    // the key dispatch). Remove the probe assertion once stable; keep the SGR
    // assertion as the real acceptance gate.
    expect(output, 'expected the onSubmit probe to fire').toContain('[prompt] onSubmit fired')
    // The model's streamed reply must render with ANSI SGR codes (OpenTUI
    // markdown styling), not as raw stdout text deltas.
    const hasSgr = /\x1b\[[0-9;]*m/.test(output)
    expect(hasSgr, 'expected ANSI SGR codes in the rendered reply').toBe(true)
  })
})
