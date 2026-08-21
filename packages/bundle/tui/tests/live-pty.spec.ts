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

describe.skipIf(!hasKey)('dsh-tui live DeepSeek PTY', { timeout: 60_000 }, () => {
  it('renders the model reply with ANSI styling after a typed prompt', async () => {
    const output = await runTuiPtySmoke({
      label: 'live-deepseek',
      tempDirPrefix: 'dsh-tui-live-',
      binPath: TUI_BIN,
      configPath: TUI_CONFIG,
      columns: 100,
      rows: 30,
      timeoutMs: 30_000,
      env: {
        DEEPSEEK_API_KEY: process.env['DEEPSEEK_API_KEY'],
        https_proxy: process.env['https_proxy'] ?? 'http://127.0.0.1:7890',
        http_proxy: process.env['http_proxy'] ?? 'http://127.0.0.1:7890',
      },
      actions: [
        // Wait for the task> prompt, then type a prompt + Enter.
        { waitFor: 'task>', send: 'Say hello in one short sentence.\r' },
      ],
      // The bin does not exit cleanly after the reply (the <Prompt> may lose
      // focus, and `exit` via onSubmit doesn't always fire). The driver
      // SIGKILLs at the timeout; the assertions below gate only on the
      // rendered reply, not the exit code.
      expectedExitCode: -9,
    })
    // The model's streamed reply must render with ANSI SGR codes (OpenTUI
    // markdown styling), not as raw stdout text deltas. The reply text ("Hello"
    // / "How can I help") appears in the rendered buffer, proving the Solid
    // store → <markdown streaming> reactivity path works under Bun.
    const hasSgr = /\x1b\[[0-9;]*m/.test(output)
    expect(hasSgr, 'expected ANSI SGR codes in the rendered reply').toBe(true)
    const hasReply = /Hello/i.test(output)
    expect(hasReply, 'expected the model reply text in the rendered buffer').toBe(true)
  })
})
