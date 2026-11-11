// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const provider = vi.hoisted(() => vi.fn())
vi.mock('../src/sdk/index.js', async original => ({ ...await original<typeof import('../src/sdk/index.js')>(), callArkme: provider }))
import { callArkme } from '../src/client/api.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'

const background = { priority: 'background' as const }
const passiveTeamReads = [
  'provider.capabilities', 'settings.background-sound.get', 'team.app.snapshot.capabilities',
  'team.app.receipt-summaries', 'team.app.people.remarks', 'user.profile', 'user.profile.refresh',
  'team.messages.mention-candidates',
  'arrangements.conversation.recognition.get',
] as const
const notificationReads = [
  ['recordings.workflow', { operation: 'query', cursor: '' }],
  ['world.subscriptions', { action: 'notifications', accountKey: 'test:4' }],
  ['world.comment-notifications', { limit: 50 }],
  ['world.reactions', { action: 'notifications', accountKey: 'test:4', limit: 50 }],
  ['reactions', { action: 'query', accountKey: 'test:4', targets: [] }],
  ['reactions', { action: 'notifications', accountKey: 'test:4', limit: 50 }],
] as const
beforeEach(() => {
  provider.mockReset()
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 4 })
})
afterEach(() => vi.restoreAllMocks())

it.each(['world.interactions.list', 'world.notification-sources'] as const)('keeps %s fanout out of the browser connection queue so official entry and sends can proceed', async operation => {
  const release: Array<() => void> = []
  provider.mockImplementation(async (requested: string) => {
    if (requested === operation) await new Promise<void>(resolve => release.push(resolve))
    return {}
  })
  const controller = new AbortController()
  const reads = Array.from({ length: 6 }, (_, index) => callArkme(operation, { recordRef: String(index) }, controller.signal, background))
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

it('admits ordinary and Team avatar downloads while the general background budget is full', async () => {
  const release: Array<() => void> = []
  provider.mockImplementation(async () => { await new Promise<void>(resolve => release.push(resolve)); return {} })
  const controller = new AbortController()
  const operations = ['official-notifications.list', 'private-interaction.directory', ...passiveTeamReads, 'image.read', 'team.app.image', 'team.app.image', 'team.app.image'] as const
  const reads = operations.map(operation => callArkme(operation, {}, controller.signal,
    operation === 'image.read' ? { ...background, avatarDownload: true } : background))
  const completion = Promise.allSettled(reads)
  try {
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(4))
    expect(provider.mock.calls.map(args => args[0])).toEqual([...operations.slice(0, 2), 'image.read', 'team.app.image'])
    release.shift()!()
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(5))
    expect(provider.mock.calls[4]![0]).toBe(operations[2])
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


it.each(['image.read', 'team.app.image', 'world.interactions.list'] as const)('passes low Fetch priority only for explicitly background %s reads', async operation => {
  provider.mockResolvedValue({})
  const params = { reference: 'opaque' }
  await callArkme(operation, params, undefined, background)
  expect(provider).toHaveBeenCalledOnce()
  expect(provider.mock.calls[0]![3]).toEqual({ priority: 'low' })
  expect(provider.mock.calls[0]![1]).not.toHaveProperty('priority')
})

it.each(['team.app.timeline', 'team.app.preflight'] as const)('gives %s high Fetch priority without changing its signal or account binding', async operation => {
  provider.mockResolvedValue({})
  const signal = new AbortController().signal
  await callArkme(operation, { conversationRef: 'conversation' }, signal)
  await callArkme(operation, { conversationRef: 'conversation' }, signal, background)
  expect(provider).toHaveBeenCalledTimes(2)
  for (const args of provider.mock.calls) {
    expect(args).toEqual([operation, { conversationRef: 'conversation', expectedAccountKey: 'test:4' }, signal, { priority: 'high' }])
  }
})

it.each(['source.send-text', 'auth.logout', 'team.app.open', 'auth.status', 'unknown.operation'])('does not lower %s when a background hint is unsupported', async operation => {
  provider.mockResolvedValue({})
  await callArkme(operation as Parameters<typeof callArkme>[0], {}, undefined, background)
  expect(provider).toHaveBeenCalledOnce()
  expect(provider.mock.calls[0]![3]).toBeUndefined()
})

it('leaves ordinary reads unchanged and rejects stale Team scope before high-priority dispatch', async () => {
  provider.mockResolvedValue({})
  await callArkme('image.read', { imageRef: 'image' })
  expect(provider).toHaveBeenCalledExactlyOnceWith('image.read', { imageRef: 'image' }, undefined)
  await expect(callArkme('team.app.timeline', { expectedAccountKey: 'test:5' })).rejects.toMatchObject({ body: { code: 'team-account-changed' } })
  expect(provider).toHaveBeenCalledOnce()
})

it.each(passiveTeamReads)('lowers only explicitly passive %s, keeping its interactive caller immediate', async operation => {
  const signals: AbortSignal[] = []
  provider.mockImplementation((_operation: string, _params: unknown, signal: AbortSignal) => {
    signals.push(signal)
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  })
  const controller = new AbortController()
  const active = [callArkme(operation, {}, controller.signal, background), callArkme(operation, {}, controller.signal, background)]
  const queued = callArkme(operation, {}, controller.signal, background)
  const completed = Promise.allSettled([...active, queued])
  try {
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(2))
    expect(provider.mock.calls.every(args => args[3]?.priority === 'low')).toBe(true)
    provider.mockResolvedValue({})
    const foreground = new AbortController().signal
    await callArkme(operation, {}, foreground)
    expect(provider.mock.calls[2]?.slice(2)).toEqual([foreground])
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 5 })
    expect((await completed).every(result => result.status === 'rejected')).toBe(true)
    expect(signals.every(signal => signal.aborted)).toBe(true)
    expect(provider).toHaveBeenCalledTimes(3)
  } finally { controller.abort(); await completed }
})

it.each(['settings.background-sound.set', 'user.profile.update', 'team.app.snapshot.seal', 'team.app.read', 'calls.outgoing.intent.claim', 'team.app.entries.query', 'team.app.workspace', 'arrangements.conversation.recognition.set'] as const)('keeps %s outside passive admission even with a mistaken hint', async operation => {
  provider.mockResolvedValue({})
  await callArkme(operation, {}, undefined, background)
  expect(provider.mock.calls[0]?.[3]).toBeUndefined()
})

it.each(notificationReads)('applies the existing background budget and low Fetch hint to %s %j', async (operation, params) => {
  provider.mockResolvedValue({})
  await callArkme(operation, params, undefined, background)
  expect(provider.mock.calls).toEqual([[operation, params, expect.any(AbortSignal), { priority: 'low' }]])
})

it('shares two permits across mixed notification and passive reaction reads, and cancels all old-account work', async () => {
  const signals: AbortSignal[] = []
  provider.mockImplementation((_operation: string, _params: unknown, signal: AbortSignal) => {
    signals.push(signal)
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  })
  const controller = new AbortController()
  const reads = notificationReads.map(([operation, params]) => callArkme(operation, params, controller.signal, background))
  const completed = Promise.allSettled(reads)
  try {
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(2))
    expect(signals).toHaveLength(2)
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 5 })
    expect((await completed).every(result => result.status === 'rejected')).toBe(true)
    expect(signals.every(signal => signal.aborted)).toBe(true)
    expect(provider).toHaveBeenCalledTimes(2)
    provider.mockResolvedValue({})
    await callArkme('reactions', { action: 'query', accountKey: 'test:5', targets: [] }, undefined, background)
    expect(provider).toHaveBeenCalledTimes(3)
  } finally { controller.abort(); await completed }
})

it('never delays interactive, mutation, other-read or unknown actions inside mixed operations even with a background hint', async () => {
  const cases: ReadonlyArray<readonly [Parameters<typeof callArkme>[0], Record<string, unknown> | undefined]> = [
    ...['read', 'capabilities', 'version', 'unknown'].map(operation => ['recordings.workflow', { operation }] as const),
    ['recordings.workflow', undefined],
    ...['state', 'set', 'query', 'read', 'contact', 'unknown'].map(action => ['world.subscriptions', { action }] as const),
    ['world.subscriptions', undefined],
    ...['query', 'set', 'actors', 'groups', 'history', 'received', 'notifications-read', 'unknown'].map(action => ['world.reactions', { action }] as const),
    ['world.reactions', undefined],
    ...['set', 'actors', 'groups', 'history', 'received', 'notifications-read', 'library-query', 'library-set', 'history-policy-query', 'history-policy-set', 'unknown'].map(action => ['reactions', { action }] as const),
    ['reactions', { action: 'query', readPriority: 'interactive' }],
    ['reactions', { action: 'query', readPriority: 'unknown' }],
    ['reactions', undefined],
  ]
  let release!: () => void
  const blocked = new Promise<void>(resolve => { release = resolve })
  provider.mockImplementation(async operation => { if (operation === 'image.read') await blocked; return {} })
  const active = [callArkme('image.read', {}, undefined, background), callArkme('image.read', {}, undefined, background)]
  const reads: Promise<unknown>[] = []
  try {
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(2))
    for (const [operation, params] of cases) reads.push(callArkme(operation, params, undefined, background))
    expect(provider.mock.calls.slice(2)).toEqual(cases.map(([operation, params]) => [operation, params, undefined]))
    await Promise.all(reads)
  } finally { release(); await Promise.allSettled([...active, ...reads]) }
})

it('dispatches cached chat history at high priority while Team directory reads are pending', async () => {
  const release: Array<() => void> = []
  provider.mockImplementation(async (operation: string) => {
    if (operation.startsWith('team.')) await new Promise<void>(resolve => release.push(resolve))
    return {}
  })
  const controller = new AbortController()
  const reads = [
    callArkme('team.app.workspace.request', { request: { operation: 'folders' } }, controller.signal, background),
    callArkme('team.app.conversations', { side: 'team' }, controller.signal, background),
    callArkme('team.app.official.membership', {}, controller.signal, background),
  ]
  const completion = Promise.allSettled(reads)
  try {
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(2))
    const params = { sourceRef: 'chat', cursor: { unified: { mode: 'initial', cacheOnly: true } } }
    await callArkme('source.timeline', params, controller.signal)
    expect(provider).toHaveBeenCalledTimes(3)
    expect(provider).toHaveBeenLastCalledWith('source.timeline', params, controller.signal, { priority: 'high' })
  } finally {
    controller.abort()
    release.forEach(resolve => resolve())
    await completion
  }
})

it('uses desktop IPC for local first paint while remote refresh stays on HTTP', async () => {
  const localChatRead = vi.fn().mockResolvedValue({ ok: true, value: { items: [] } })
  vi.stubGlobal('arkmeDesktop', { localChatRead })
  provider.mockResolvedValue({})
  try {
    const cached = { sourceRef: 'opaque', limit: 40, cursor: { unified: { mode: 'initial', cacheOnly: true, anchorId: 'message:x' } } }
    await expect(callArkme('source.timeline', cached)).resolves.toEqual({ items: [] })
    expect(localChatRead).toHaveBeenCalledWith('test:4', { kind: 'timeline', sourceRef: 'opaque', limit: 40, anchorId: 'message:x' })
    await callArkme('conversation.viewport.read', { accountKey: 'test:4', surface: 'main' })
    expect(localChatRead).toHaveBeenLastCalledWith('test:4', { kind: 'viewport', surface: 'main' })
    await callArkme('source.timeline', { sourceRef: 'opaque', limit: 40 })
    expect(provider).toHaveBeenCalledTimes(1)
    expect(provider.mock.calls[0]?.[0]).toBe('source.timeline')
  } finally { vi.unstubAllGlobals() }
})
