// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const provider = vi.hoisted(() => vi.fn())
vi.mock('../src/sdk/index.js', async original => ({ ...await original<typeof import('../src/sdk/index.js')>(), callArkme: provider }))
import { callArkme } from '../src/client/api.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'

const background = { priority: 'background' as const }
beforeEach(() => {
  provider.mockReset()
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 4 })
})
afterEach(() => vi.restoreAllMocks())

it('keeps startup fanout out of the browser connection queue so official entry and sends can proceed', async () => {
  const release: Array<() => void> = []
  provider.mockImplementation(async (operation: string) => {
    if (operation === 'world.interactions.list') await new Promise<void>(resolve => release.push(resolve))
    return {}
  })
  const controller = new AbortController()
  const reads = Array.from({ length: 6 }, (_, index) => callArkme('world.interactions.list', { recordRef: String(index) }, controller.signal, background))
  const completion = Promise.allSettled(reads)
  try {
    await vi.waitFor(() => expect(release.length).toBeGreaterThanOrEqual(2))
    expect(release).toHaveLength(2)
    await callArkme('team.app.official')
    await callArkme('team.app.open', { publicRef: 'official' })
    await callArkme('source.send-text', { text: 'hello' })
    expect(provider.mock.calls.slice(-3).map(args => args[0])).toEqual(['team.app.official', 'team.app.open', 'source.send-text'])
  } finally {
    controller.abort()
    release.forEach(resolve => resolve())
    await completion
  }
})

it('shares one background budget across notifications, private directory and both avatar readers', async () => {
  const release: Array<() => void> = []
  provider.mockImplementation(async () => { await new Promise<void>(resolve => release.push(resolve)); return {} })
  const controller = new AbortController()
  const operations = ['official-notifications.list', 'private-interaction.directory', 'image.read', 'team.app.image'] as const
  const reads = operations.map(operation => callArkme(operation, {}, controller.signal, background))
  const completion = Promise.allSettled(reads)
  try {
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(2))
    release.shift()!()
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(3))
    expect(provider.mock.calls.map(args => args[0])).toEqual(operations.slice(0, 3))
  } finally {
    controller.abort(); release.forEach(resolve => resolve()); await completion
  }
})

it('removes cancelled queued work before it reaches the provider', async () => {
  const release: Array<() => void> = []
  provider.mockImplementation(async () => { await new Promise<void>(resolve => release.push(resolve)); return {} })
  const active = [callArkme('image.read', {}, undefined, background), callArkme('image.read', {}, undefined, background)]
  const controller = new AbortController()
  const queued = callArkme('world.interactions.list', {}, controller.signal, background)
  const rejected = expect(queued).rejects.toMatchObject({ name: 'AbortError' })
  try {
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(2))
    controller.abort()
    await rejected
  } finally { release.forEach(resolve => resolve()); await Promise.allSettled(active) }
  expect(provider).toHaveBeenCalledTimes(2)
})

it('rechecks identity when a queued read starts instead of using a new login with old parameters', async () => {
  const release: Array<() => void> = []
  provider.mockImplementation(async () => { await new Promise<void>(resolve => release.push(resolve)); return {} })
  const active = [callArkme('image.read', {}, undefined, background), callArkme('image.read', {}, undefined, background)]
  const completed = Promise.allSettled(active)
  const queued = callArkme('private-interaction.directory', { cursor: 'old-account' }, undefined, background)
  const rejected = expect(queued).rejects.toMatchObject({ body: { code: 'read-account-changed' } })
  await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(2))
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 5 })
  release.forEach(resolve => resolve())
  expect((await completed).every(result => result.status === 'rejected')).toBe(true)
  await rejected
  expect(provider).toHaveBeenCalledTimes(2)
})

it('aborts old active avatar fetches on account change and immediately admits the new account', async () => {
  const signals: AbortSignal[] = []
  provider.mockImplementation(async (operation: string, _params: unknown, signal?: AbortSignal) => {
    if (operation !== 'image.read') return {}
    signals.push(signal!)
    await new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }))
    return {}
  })
  const active = [callArkme('image.read', {}, undefined, background), callArkme('image.read', {}, undefined, background)]
  const completed = Promise.allSettled(active)
  await vi.waitFor(() => expect(signals).toHaveLength(2))
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'prod', userId: 5 })
  expect(signals.every(signal => signal.aborted)).toBe(true)
  await expect(callArkme('private-interaction.directory', {}, undefined, background)).resolves.toEqual({})
  expect((await completed).every(result => result.status === 'rejected')).toBe(true)
})

it('rejects a late result when the account changes between dispatch and admission completion', async () => {
  let release!: (value: unknown) => void
  const response = new Promise(resolve => { release = resolve })
  // Run after dispatch's response check, before the coordinator unwinds back to callArkme.
  response.then(() => queueMicrotask(() => {
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 5 })
  }))
  provider.mockReturnValue(response)
  const read = callArkme('private-interaction.directory', {}, undefined, background)
  const rejected = expect(read).rejects.toMatchObject({ body: { code: 'read-account-changed' } })
  await vi.waitFor(() => expect(provider).toHaveBeenCalledOnce())
  release({ oldAccountRows: true })
  await rejected
})

it('does not retry failures and releases capacity after the complete provider promise settles', async () => {
  let reject!: (error: Error) => void
  let release!: () => void
  provider.mockImplementationOnce(() => new Promise((_resolve, rejectFn) => { reject = rejectFn }))
    .mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({}) }))
    .mockResolvedValue({})
  const failure = new Error('offline')
  const first = callArkme('image.read', { imageRef: 'first' }, undefined, background)
  const rejected = expect(first).rejects.toBe(failure)
  const second = callArkme('image.read', { imageRef: 'second' }, undefined, background)
  const third = callArkme('image.read', { imageRef: 'third' }, undefined, background)
  await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(2))
  reject(failure)
  await rejected
  await third
  release(); await second
  expect(provider).toHaveBeenCalledTimes(3)
})

it('never queues or coalesces mutations even if a caller mistakenly provides a background hint', async () => {
  let release!: () => void
  const blocked = new Promise<void>(resolve => { release = resolve })
  provider.mockImplementation(async (operation: string) => {
    if (operation === 'image.read') await blocked
    return {}
  })
  const active = [callArkme('image.read', {}, undefined, background), callArkme('image.read', {}, undefined, background)]
  try {
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(2))
    await Promise.all([
      callArkme('source.send-text', { text: 'same' }, undefined, background),
      callArkme('source.send-text', { text: 'same' }, undefined, background),
      callArkme('auth.logout', undefined, undefined, background),
      callArkme('team.app.open', { publicRef: 'official' }, undefined, background),
      callArkme('world.interactions.list', { recordRef: 'foreground' }),
    ])
    expect(provider).toHaveBeenCalledTimes(7)
  } finally { release(); await Promise.all(active) }
})
