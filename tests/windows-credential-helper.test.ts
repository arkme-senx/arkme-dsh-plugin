import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  ArkmeWindowsCredentialManagerBackend,
  type SpawnWindowsCredentialHelper,
} from '../src/windows-credential-helper.js'

interface FakeScenario {
  stdout?: string | Buffer
  stderr?: string | Buffer
  exitCode?: number
  neverCloses?: boolean
}

function createFakeSpawn(scenario: FakeScenario) {
  const calls: Array<{ command: string, args: string[], request: string }> = []
  let killed = false

  const spawn: SpawnWindowsCredentialHelper = (command, args) => {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const call = { command, args: [...args], request: '' }
    calls.push(call)
    stdin.setEncoding('utf8')
    stdin.on('data', (chunk: string) => { call.request += chunk })

    const child = new EventEmitter() as EventEmitter & {
      stdin: PassThrough
      stdout: PassThrough
      stderr: PassThrough
      kill(): boolean
    }
    child.stdin = stdin
    child.stdout = stdout
    child.stderr = stderr
    child.kill = () => {
      killed = true
      return true
    }

    if (scenario.neverCloses !== true) {
      queueMicrotask(() => {
        if (scenario.stdout !== undefined) stdout.write(scenario.stdout)
        if (scenario.stderr !== undefined) stderr.write(scenario.stderr)
        child.emit('close', scenario.exitCode ?? 0)
      })
    }
    return child
  }

  return {
    calls,
    spawn,
    wasKilled: () => killed,
  }
}

function createBackend(scenario: FakeScenario, overrides: { outputLimitBytes?: number, timeoutMs?: number } = {}) {
  const fake = createFakeSpawn(scenario)
  const backend = new ArkmeWindowsCredentialManagerBackend({
    helperPath: 'C:\\Arkme\\arkme-credential-helper.exe',
    spawn: fake.spawn,
    outputLimitBytes: overrides.outputLimitBytes,
    timeoutMs: overrides.timeoutMs,
  })
  return { backend, fake }
}

describe('Arkme Windows credential helper adapter', () => {
  it('returns undefined when the native helper reports a missing credential', async () => {
    const { backend, fake } = createBackend({ stdout: '{"ok":true,"found":false}\n' })

    await expect(backend.read('service', 'session')).resolves.toBeUndefined()
    expect(fake.calls).toEqual([{
      command: 'C:\\Arkme\\arkme-credential-helper.exe',
      args: [],
      request: '{"operation":"read","service":"service","account":"session"}\n',
    }])
  })

  it('returns a stored credential value', async () => {
    const { backend } = createBackend({ stdout: '{"ok":true,"found":true,"value":"session-json"}\n' })

    await expect(backend.read('service', 'session')).resolves.toBe('session-json')
  })

  it('writes and deletes through one request per helper process without command-line secrets', async () => {
    const write = createBackend({ stdout: '{"ok":true}\n' })
    const remove = createBackend({ stdout: '{"ok":true}\n' })

    await expect(write.backend.write('service', 'session', 'secret-session-json')).resolves.toBeUndefined()
    await expect(remove.backend.delete('service', 'session')).resolves.toBeUndefined()
    expect(write.fake.calls[0]?.args).toEqual([])
    expect(write.fake.calls[0]?.request).toBe('{"operation":"write","service":"service","account":"session","payload":"secret-session-json"}\n')
    expect(remove.fake.calls[0]?.request).toBe('{"operation":"delete","service":"service","account":"session"}\n')
  })

  it('rejects a non-zero helper exit without exposing stderr content', async () => {
    const { backend } = createBackend({ exitCode: 5, stderr: 'secret-session-json' })

    const operation = backend.read('service', 'session')
    await expect(operation).rejects.toThrow(/退出码 5/)
    await expect(operation).rejects.not.toThrow(/secret-session-json/)
  })

  it('rejects malformed helper responses without exposing their content', async () => {
    const { backend } = createBackend({ stdout: 'secret-session-json' })

    const operation = backend.read('service', 'session')
    await expect(operation).rejects.toThrow(/返回无效/)
    await expect(operation).rejects.not.toThrow(/secret-session-json/)
  })

  it('kills a helper that exceeds the output limit', async () => {
    const { backend, fake } = createBackend({ stdout: Buffer.alloc(33, 1) }, { outputLimitBytes: 32 })

    await expect(backend.read('service', 'session')).rejects.toThrow(/返回内容过大/)
    expect(fake.wasKilled()).toBe(true)
  })

  it('kills a helper that does not finish before the timeout', async () => {
    const { backend, fake } = createBackend({ neverCloses: true }, { timeoutMs: 5 })

    await expect(backend.read('service', 'session')).rejects.toThrow(/操作超时/)
    expect(fake.wasKilled()).toBe(true)
  })
})
