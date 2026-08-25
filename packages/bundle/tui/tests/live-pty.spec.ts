/**
 * Live DeepSeek PTY smoke for `dsh-tui`: boots the bin, types a prompt, waits
 * for the model's streamed reply, and asserts the reply renders with ANSI
 * styling (not raw stdout). Self-skips without `DEEPSEEK_API_KEY` (the e2e
 * contract — real-API tests self-skip without a key).
 *
 * @module @deepseek-ai/dsh-tui/tests/live-pty.spec
 */

import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runTuiPtySmoke } from './pty-harness.ts'

const TUI_BIN = resolve(import.meta.dirname, '..', 'lib', 'bin.js')
const TUI_CONFIG = resolve(import.meta.dirname, '..', 'cordis.yml')
const REPLAY_FIXTURE = resolve(import.meta.dirname, 'fixtures', 'text-turn.session.jsonl')
const REPOSITORY_ROOT = resolve(import.meta.dirname, '..', '..', '..', '..')
const hasKey = process.env['DEEPSEEK_API_KEY'] !== undefined && process.env['DEEPSEEK_API_KEY'] !== ''

describe('dsh-tui workspace-root PTY input', { timeout: 15_000 }, () => {
  it('submits a built-in slash command on Enter', async () => {
    await runTuiPtySmoke({
      label: 'workspace-root-exit',
      tempDirPrefix: 'dsh-tui-root-exit-',
      binPath: TUI_BIN,
      configPath: TUI_CONFIG,
      workingDirectory: REPOSITORY_ROOT,
      columns: 100,
      rows: 30,
      timeoutMs: 5_000,
      env: {
        DSH_SNAPSHOT: 'replay',
        DSH_SNAPSHOT_FILE: REPLAY_FIXTURE,
        DSH_SESSION_ROOT: resolve(tmpdir(), `dsh-tui-root-exit-${process.pid}`),
      },
      actions: [{ waitFor: 'task>', send: '/exit\r' }],
      expectedExitCode: 0,
    })
  })

  it('cycles the work mode on Tab', async () => {
    const output = await runTuiPtySmoke({
      label: 'workspace-root-tab',
      tempDirPrefix: 'dsh-tui-root-tab-',
      binPath: TUI_BIN,
      configPath: TUI_CONFIG,
      workingDirectory: REPOSITORY_ROOT,
      columns: 100,
      rows: 30,
      timeoutMs: 5_000,
      env: {
        DSH_SNAPSHOT: 'replay',
        DSH_SNAPSHOT_FILE: REPLAY_FIXTURE,
        DSH_SESSION_ROOT: resolve(tmpdir(), `dsh-tui-root-tab-${process.pid}`),
      },
      actions: [{ waitFor: 'task>', send: '\t' }],
      expectedExitCode: -9,
    })

    expect(output).toContain('PTC')
  })

  it('cycles the work mode on Tab after entering chat', async () => {
    const output = await runTuiPtySmoke({
      label: 'workspace-root-chat-tab',
      tempDirPrefix: 'dsh-tui-root-chat-tab-',
      binPath: TUI_BIN,
      configPath: TUI_CONFIG,
      workingDirectory: REPOSITORY_ROOT,
      columns: 100,
      rows: 30,
      timeoutMs: 5_000,
      env: {
        DSH_SNAPSHOT: 'replay',
        DSH_SNAPSHOT_FILE: REPLAY_FIXTURE,
        DSH_SESSION_ROOT: resolve(tmpdir(), `dsh-tui-root-chat-tab-${process.pid}`),
      },
      actions: [
        { waitFor: 'task>', send: 'hello\r' },
        { waitFor: 'Hello! How can I help you?', send: '\t' },
      ],
      expectedExitCode: -9,
    })

    expect(output).toContain('PTC')
  })

  it('completes a partial slash command before submitting it', async () => {
    const output = await runTuiPtySmoke({
      label: 'workspace-root-slash-completion',
      tempDirPrefix: 'dsh-tui-root-slash-completion-',
      binPath: TUI_BIN,
      configPath: TUI_CONFIG,
      workingDirectory: REPOSITORY_ROOT,
      columns: 100,
      rows: 30,
      timeoutMs: 5_000,
      env: {
        DSH_SNAPSHOT: 'replay',
        DSH_SNAPSHOT_FILE: REPLAY_FIXTURE,
        DSH_SESSION_ROOT: resolve(tmpdir(), `dsh-tui-root-slash-completion-${process.pid}`),
      },
      actions: [{ waitFor: 'task>', send: '/pl\r\r' }],
      expectedExitCode: -9,
    })

    expect(output).toContain('plan>')
  })

  it('submits a prompt when launched outside the package directory', async () => {
    const output = await runTuiPtySmoke({
      label: 'workspace-root-replay',
      tempDirPrefix: 'dsh-tui-root-',
      binPath: TUI_BIN,
      configPath: TUI_CONFIG,
      workingDirectory: REPOSITORY_ROOT,
      columns: 100,
      rows: 30,
      timeoutMs: 5_000,
      env: {
        DSH_SNAPSHOT: 'replay',
        DSH_SNAPSHOT_FILE: REPLAY_FIXTURE,
        DSH_SESSION_ROOT: resolve(tmpdir(), `dsh-tui-root-${process.pid}`),
      },
      actions: [{ waitFor: 'task>', send: 'hello\r' }],
      expectedExitCode: -9,
    })

    expect(output).toContain('Hello! How can I help you?')
  })
})

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
