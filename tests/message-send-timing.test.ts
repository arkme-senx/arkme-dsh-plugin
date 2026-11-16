import { afterEach, expect, it, vi } from 'vitest'

const first = '00000000-0000-4000-8000-000000000001'
const second = '00000000-0000-4000-8000-000000000002'
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.resetModules() })
async function enabled() {
  vi.resetModules()
  vi.stubGlobal('__ARKME_LOCAL_SEND_TIMING__', true)
  return await import('../src/message-send-timing.js')
}

it('keeps diagnostics disabled by default and preserves outcomes', async () => {
  vi.stubGlobal('__ARKME_LOCAL_SEND_TIMING__', false)
  const timing = await import('../src/message-send-timing.js')
  const host = await import('../src/message-send-host-timing.js')
  const log = vi.spyOn(console, 'info').mockImplementation(() => {})
  const clock = vi.spyOn(performance, 'now')
  const result = {}
  expect(await host.measureMessageSend(first, 'owner', async () => result)).toBe(result)
  expect(timing.messageSendRecord('files.send', { recordUid: first })).toBeUndefined()
  timing.beginClientSendTiming(first, Date.now(), 'group_chat')
  timing.messageSendPoint('host', first, 'hidden')
  expect(log).not.toHaveBeenCalled()
  expect(clock).not.toHaveBeenCalled()
})

it('bounds logs and rejects payload, credentials, malformed IDs and unsafe metadata', async () => {
  const timing = await enabled()
  const log = vi.spyOn(console, 'info').mockImplementation(() => {})
  expect(timing.messageSendRecord('auth.login', { recordUid: first })).toBeUndefined()
  expect(timing.messageSendRecord('files.send', { recordUid: 'secret-token' })).toBeUndefined()
  expect(timing.messageSendRecord('files.send', { recordUid: first })).toBe(first)
  timing.messageSendPoint('host', first, 'owner', { durationMs: 1.234, route: 'https://secret?token=secret',
    ...{ textContent: 'secret body', accessToken: 'secret token', sourceRef: 'secret ref' } })
  expect(JSON.stringify(log.mock.calls)).not.toContain('secret')
  expect(JSON.parse(log.mock.calls[0]![0].split('] ')[1])).toMatchObject({ durationMs: 1.2, recordUid: first })
  for (let index = 0; index < 1300; index++) timing.messageSendPoint('host', first, 'owner')
  expect(log).toHaveBeenCalledTimes(1200)
})

it('keeps concurrent sends and queued callbacks isolated without hiding errors', async () => {
  await enabled()
  vi.spyOn(console, 'info').mockImplementation(() => {})
  const host = await import('../src/message-send-host-timing.js')
  const failure = new Error('private message body')
  let queued!: () => string | undefined
  await Promise.all([
    host.measureMessageSend(first, 'owner', async () => {
      await Promise.resolve()
      queued = host.bindMessageSend(() => host.currentMessageSend())
      expect(host.currentMessageSend()).toBe(first)
    }),
    expect(host.measureMessageSend(second, 'owner', async () => {
      await Promise.resolve()
      expect(host.currentMessageSend()).toBe(second)
      throw failure
    })).rejects.toBe(failure),
  ])
  expect(queued()).toBe(first)
  expect(host.currentMessageSend()).toBeUndefined()
})

it('records receipt rendering after two frames and cancels stale observations', async () => {
  const timing = await enabled()
  const log = vi.spyOn(console, 'info').mockImplementation(() => {})
  const frames = new Map<number, FrameRequestCallback>()
  let next = 0
  vi.stubGlobal('document', { visibilityState: 'visible' })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++next, callback); return next })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  const frame = () => { const entries = [...frames]; frames.clear(); for (const [, callback] of entries) callback(0) }
  const element = { isConnected: true } as HTMLElement
  timing.beginClientSendTiming(first, Date.now() - 10, 'group_chat')
  const stop = timing.observeClientSendPaint(first, true, element)
  stop(); frame(); frame()
  expect(log.mock.calls.some(([line]) => line.includes('loading-visible'))).toBe(false)
  timing.observeClientSendPaint(first, false, element)
  frame()
  expect(log.mock.calls.some(([line]) => line.includes('loading-finished'))).toBe(false)
  frame()
  expect(log.mock.calls.filter(([line]) => line.includes('loading-finished'))).toHaveLength(1)
  timing.observeClientSendPaint(first, false, element)
  frame(); frame()
  expect(log.mock.calls.filter(([line]) => line.includes('loading-finished'))).toHaveLength(1)
})

it('keeps the SDK request unchanged and logs headers and decoding without the body', async () => {
  await enabled()
  const log = vi.spyOn(console, 'info').mockImplementation(() => {})
  const { createArkmeSdk } = await import('../src/sdk/index.js')
  const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ ok: true, value: { accepted: true } })))
  const params = { recordUid: first, textContent: 'secret message' }
  expect(await createArkmeSdk({ fetchImpl: fetcher }).call('source.send-text', params)).toEqual({ accepted: true })
  expect(fetcher).toHaveBeenCalledOnce()
  expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toEqual({ operation: 'source.send-text', params })
  expect(log.mock.calls.map(([line]) => JSON.parse(line.split('] ')[1]).stage)).toEqual([
    'loopback-start', 'loopback-headers', 'loopback-decoded', 'loopback-end',
  ])
  expect(JSON.stringify(log.mock.calls)).not.toContain('secret message')
})

it('measures the upstream queue and request while preserving authorization and response', async () => {
  await enabled()
  const log = vi.spyOn(console, 'info').mockImplementation(() => {})
  const { ServiceRuntime } = await import('../src/services/service.js')
  const { measureMessageSend } = await import('../src/message-send-host-timing.js')
  const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ code: 200, data: { accepted: true } })))
  const config = { environment: 'test', authBaseUrl: 'https://auth.test', chatBaseUrl: 'https://chat.test',
    recordBaseUrl: 'https://record.test', requestTimeoutMs: 1000 } as import('../src/services/service.js').ArkmeServiceConfig
  const runtime = new ServiceRuntime(config, { read: async () => undefined, write: async () => {}, delete: async () => {} }, {} as never, fetcher)
  try {
    expect(await measureMessageSend(first, 'owner', () => runtime.post('https://chat.test', '/api/v1/chats/records/send',
      { record_uid: first, text_content: 'private body' }, 'private-token', [200]))).toEqual({ accepted: true })
    expect(fetcher).toHaveBeenCalledOnce()
    const headers = fetcher.mock.calls[0]![1]!.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer private-token')
    expect(headers['X-Request-ID']).toContain(first)
    const stages = log.mock.calls.map(([line]) => JSON.parse(line.split('] ')[1]).stage)
    expect(stages).toEqual(expect.arrayContaining(['upstream-queue', 'upstream-http-start', 'upstream-http-headers', 'upstream-http-decoded', 'upstream-http-end']))
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private body|private-token/)
  } finally { runtime.dispose() }
})
