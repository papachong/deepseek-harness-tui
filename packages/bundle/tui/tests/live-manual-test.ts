import { resolve } from 'node:path'
import { runTuiPtySmoke } from './pty-harness.ts'

async function main(): Promise<void> {
  const out = await runTuiPtySmoke({
    label: 'visual-redesign-test',
    tempDirPrefix: 'dsh-tui-redesign-',
    binPath: resolve(import.meta.dirname, '..', 'lib', 'bin.js'),
    configPath: resolve(import.meta.dirname, '..', 'cordis.yml'),
    columns: 100, rows: 30, timeoutMs: 45_000,
    env: {
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY!,
      https_proxy: 'http://127.0.0.1:7890',
      http_proxy: 'http://127.0.0.1:7890',
    },
    actions: [{ waitFor: 'task>', send: 'Say hello in one short sentence.\r' }],
    expectedExitCode: -9,
  })
  console.log('PTY output length:', String(out.length))
  const hasSgr = /\x1b\[[0-9;]*m/.test(out)
  console.log('ANSI styling:', hasSgr ? 'YES' : 'NO')
  const hasReply = /Hello|你好|Hi|help/i.test(out)
  console.log('Model reply:', hasReply ? 'YES' : 'NO')
  const hasUserPrefix = /❯|●/.test(out)
  console.log('Role prefix glyph:', hasUserPrefix ? 'YES' : 'NO')
  const hasStatusDot = /dsh|deepseek/i.test(out)
  console.log('Status bar:', hasStatusDot ? 'YES' : 'NO')
  const visible = out
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b[P_][^\x1b]*\x1b\\/g, '')
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/[─━│┃▄█▀]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  console.log('=== visible tail ===')
  console.log(visible.slice(-500))
}
main().catch((e: unknown) => { console.error(e); process.exit(1) })
