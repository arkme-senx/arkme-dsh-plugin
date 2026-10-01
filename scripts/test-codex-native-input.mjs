import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Pure policy tests only. The executable never constructs NativeCodexInput.
if (process.platform !== 'darwin' || process.argv.length !== 2) throw new Error('macOS only; no arguments accepted')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporary = mkdtempSync(join(tmpdir(), 'arkme-native-policy-'))
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', timeout: 60_000 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Policy check exited ${result.status}`)
}
try {
  const executable = join(temporary, 'test')
  run('/usr/bin/xcrun', ['swiftc', '-warnings-as-errors', join(root, 'tools/codex-companion/NativeInput.swift'),
    join(root, 'tools/codex-companion/native-input-tests/main.swift'), '-o', executable])
  run(executable, [])
} finally { rmSync(temporary, { recursive: true }) }
