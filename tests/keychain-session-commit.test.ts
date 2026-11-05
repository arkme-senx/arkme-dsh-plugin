import { afterEach, expect, it, vi } from 'vitest'
import { ArkmeKeychainStore } from '../src/keychain-store.js'
import { ArkmeAccountSessionOwner } from '../src/account-session-owner.js'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  execFile: Object.assign(() => undefined, { [Symbol.for('nodejs.util.promisify.custom')]: run }),
}))
afterEach(() => { vi.unstubAllGlobals(); run.mockReset() })
const session = { userId: 42, accessToken: 'test-access', refreshToken: 'test-refresh' }

it('commits a relaunching account scope only after Keychain can be read by a new Host', async () => {
  vi.stubGlobal('process', { ...process, platform: 'darwin' })
  let disk: string | undefined, finish!: () => void
  const pending = new Promise<void>(resolve => { finish = resolve })
  run.mockImplementation(async (_file: string, args: string[]) => {
    if (args[0] === 'find-generic-password') {
      if (!disk) throw Object.assign(new Error('missing'), { code: 44 })
      return { stdout: disk }
    }
    await pending
    disk = args.at(-1)
    return { stdout: '' }
  })
  const commit = vi.fn(async () => ({ status: 'relaunch' as const }))
  const owner = new ArkmeAccountSessionOwner(new ArkmeKeychainStore('test'), {
    attest: async () => ({ status: 'ready' }), prepare: async () => ({ transitionRef: 't' }),
    commit, abort: async () => ({ status: 'ready' }),
  })
  const writing = owner.write(session)
  await vi.waitFor(() => expect(run.mock.calls.some(([, args]) => args[0] === 'add-generic-password')).toBe(true))
  expect(commit).not.toHaveBeenCalled()
  finish(); await writing
  expect(commit).toHaveBeenCalledOnce()
  await expect(new ArkmeKeychainStore('test').read()).resolves.toEqual(session)
})

it('keeps the previous session and aborts account switching when persistence fails without exposing credentials', async () => {
  vi.stubGlobal('process', { ...process, platform: 'darwin' })
  run.mockImplementation(async (_file: string, args: string[]) => {
    if (args[0] === 'find-generic-password') return { stdout: JSON.stringify(session) }
    throw new Error('command contained secret-access-token')
  })
  const store = new ArkmeKeychainStore('test'), commit = vi.fn(), abort = vi.fn(async () => ({ status: 'ready' as const }))
  const owner = new ArkmeAccountSessionOwner(store, {
    attest: async () => ({ status: 'ready' }), prepare: async () => ({ transitionRef: 't' }), commit, abort,
  })
  const error = await owner.write({ ...session, userId: 43 }).catch(error => error)
  expect(error.message).toBe('无法保存 Arkme 登录凭据，请重试登录')
  expect(error.cause).toBeUndefined()
  expect(commit).not.toHaveBeenCalled()
  expect(abort).toHaveBeenCalledOnce()
  await expect(store.read()).resolves.toEqual(session)
})
