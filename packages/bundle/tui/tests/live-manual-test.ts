import { resolve } from 'node:path'
import { runTuiPtySmoke } from './pty-harness.ts'
async function main(): Promise<void> {
  const out = await runTuiPtySmoke({
    label: 'tool-registry-test',
    tempDirPrefix: 'dsh-tui-tool-',
    binPath: resolve(import.meta.dirname, '..', 'lib', 'bin.js'),
    configPath: resolve(import.meta.dirname, '..', 'cordis.yml'),
    columns: 100, rows: 30, timeoutMs: 35_000,
    env: { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY!, https_proxy: 'http://127.0.0.1:7890', http_proxy: 'http://127.0.0.1:7890' },
    actions: [{ waitFor: 'task>', send: 'hi\r' }],
    expectedExitCode: -9,
  })
  console.log('reply:', /Hello|你好|Hi|help|ready/i.test(out) ? 'YES' : 'NO')
  console.log('error:', /TextNodeRenderable|fatal/i.test(out) ? 'YES' : 'NO')
}
main().catch((e: unknown) => { console.error(e); process.exit(1) })
