import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Compile and fail-closed CLI checks only: never navigate, activate, type or send.
assert.equal(process.platform, 'darwin')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const directory = mkdtempSync(join(tmpdir(), 'arkme-native-validation-test-'))
const binary = join(directory, 'native-validation')
const compiled = spawnSync('/usr/bin/xcrun', ['swiftc', '-warnings-as-errors',
  join(root, 'tools/codex-companion/validation/main.swift'), '-o', binary],
{ encoding: 'utf8', timeout: 30_000 })
assert.equal(compiled.status, 0, compiled.stderr)
const uuid = '00000000-0000-0000-0000-000000000000'
const cases = [[], ['send', 'hello'], ['verify-thread', 'not-a-uuid'],
  ['navigate-verify', 'https://example.com'], ['stage-test', uuid, 'arbitrary-text'],
  ['submit-test', uuid, 'idle'], ['submit-test', uuid, 'unknown', '/tmp/not-written'],
  ['clear-test-draft', uuid, 'unknown'], ['probe-copy-menu', '--send']]
for (const args of cases) {
  const result = spawnSync(binary, args, { encoding: 'utf8', timeout: 5_000 })
  assert.equal(result.status, 1, result.stderr)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /REFUSED: blocked\("usage:/)
}
console.log(`PASS: native fixture compiles and ${cases.length} invalid command cases stop before native UI access.`)
console.log('No live input test is run by this script; live tests require a user-authorized disposable conversation.')
