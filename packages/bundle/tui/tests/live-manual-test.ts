import { resolve } from 'node:path'
import { runTuiPtySmoke } from './pty-harness.ts'
async function main(): Promise<void> {
  const out = await runTuiPtySmoke({
    label: 'diag-onsubmit',
    tempDirPrefix: 'dsh-tui-diag-',
    binPath: resolve(import.meta.dirname, '..', 'lib', 'bin.js'),
    configPath: resolve(import.meta.dirname, '..', 'cordis.yml'),
    columns: 100, rows: 30, timeoutMs: 30_000,
    env: { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY!, https_proxy: 'http://127.0.0.1:7890', http_proxy: 'http://127.0.0.1:7890' },
    actions: [{ waitFor: 'task>', send: 'hi\r' }],
    expectedExitCode: -9,
  })
  // Check: did 'hi' echo (input received keystrokes)? did a reply come?
  console.log('hi echoed (input got keys):', /hi/i.test(out) ? 'YES' : 'NO')
  console.log('reply rendered:', /Hello|你好|Hi|help|ready/i.test(out) ? 'YES' : 'NO')
  // Check for any error in output
  console.log('has error:', /error|TextNodeRenderable|fatal/i.test(out) ? out.match(/[^\n]*error[^\n]*/i)?.[0]?.slice(0,120) : 'NO')
}
main().catch((e: unknown) => { console.error(e); process.exit(1) })
