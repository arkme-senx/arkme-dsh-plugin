import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createWriteStream } from 'node:fs'
import { access, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Prerequisite: the Audio checkout uses isolated loopback Mongo replica set
// (recording_import_test), Redis and Rabbit. The Go fixture rejects other targets.
const audio = process.env.JOTMO_AUDIO_CHECKOUT
if (!audio) throw new Error('Set JOTMO_AUDIO_CHECKOUT to the task Audio checkout')
const root = fileURLToPath(new URL('..', import.meta.url))
const evidence = await mkdtemp(join(tmpdir(), 'recording import owner '))
const env = { ...process.env, JOTMO_IMPORT_E2E_DIR: evidence, TZ: 'Asia/Shanghai' }
const output = createWriteStream(join(evidence, 'audio.log'))
const owner = spawn(process.env.JOTMO_TEST_GO_BIN || 'go', ['test', '-race', './task/summary', '-run', '^TestRecordingImportCrossRepositoryServer$', '-count=1', '-v'], { cwd: resolve(audio), env, stdio: ['ignore', 'pipe', 'pipe'], shell: false })
owner.stdout.pipe(output, { end: false }); owner.stderr.pipe(output, { end: false })
const ownerDone = once(owner, 'exit')
try {
  const deadline = Date.now() + 90000
  for (;;) {
    try { await access(join(evidence, 'ready.json')); break } catch { /* wait for bounded startup */ }
    if (owner.exitCode !== null || Date.now() > deadline) throw new Error(`Audio did not start; inspect ${join(evidence, 'audio.log')}`)
    await new Promise(r => setTimeout(r, 100))
  }
  const cli = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url))
  const ui = spawn(process.execPath, [cli, 'run', 'tests/e2e/recording-import-owner.e2e.test.tsx'], { cwd: root, env, stdio: 'inherit', shell: false })
  const [code] = await once(ui, 'exit')
  if (code !== 0) throw new Error(`UI integration failed (${code})`)
} finally {
  await writeFile(join(evidence, 'stop'), 'done', { mode: 0o600 })
  const timer = setTimeout(() => owner.kill('SIGTERM'), 15000)
  const [ownerCode] = await ownerDone
  clearTimeout(timer); output.end()
  console.log(`Cross-repository evidence: ${evidence}`)
  if (ownerCode !== 0) throw new Error(`Audio integration failed (${ownerCode}); inspect audio.log`)
}
