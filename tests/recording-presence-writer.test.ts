import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RecordingPresenceWriter } from '../src/services/recording-presence-writer.js'
import type { ServiceRuntime } from '../src/services/service.js'

const recordingId = 'e236f5cf-01a6-4e73-9fe9-bbc80d0b6804'
const startedAt = 1790000000000
const scope = 'test:42'
const dirs: string[] = []
const writers: RecordingPresenceWriter[] = []
afterEach(async () => { writers.splice(0).forEach(writer => writer.revoke()); await new Promise(resolve => setTimeout(resolve, 15)); await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })
async function setup(send?: (path: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>) {
  const directory = await mkdtemp(join(tmpdir(), 'arkme-presence-test-')); dirs.push(directory)
  let now = startedAt
  let userId = 42
  const post = vi.fn(async (path: string, body: Record<string, unknown>) => send ? await send(path, body) : { heartbeat_interval_ms: 10000 })
  const runtime = { config: { environment: 'test' }, requireSession: vi.fn(async () => ({ userId, accessToken: 'test-token', refreshToken: 'test-refresh' })), authenticatedAudioPost: post } as unknown as ServiceRuntime
  const writer = new RecordingPresenceWriter(runtime, directory, () => now, () => ({ name: 'real-device', platform: 'macos' }))
  writers.push(writer)
  const stored = async () => JSON.parse(await readFile(join(directory, 'recording-presence-test_42.json'), 'utf8')) as { entries: Array<{ pending?: { operation: string; body: Record<string, unknown> }; stopped: boolean; seq: number }> }
  const wait = async (count: number) => { for (let i = 0; i < 100 && post.mock.calls.length < count; i++) await new Promise(resolve => setTimeout(resolve, 2)); expect(post.mock.calls.length).toBeGreaterThanOrEqual(count) }
  return { writer, post, stored, wait, setNow: (value: number) => { now = value }, setUser: (value: number) => { userId = value }, directory }
}
const start = { operation: 'start' as const, recordingId, startedAt, elapsedMillis: 1000 }
const update = (elapsedMillis: number) => ({ operation: 'update' as const, recordingId, startedAt, elapsedMillis })
const stop = (elapsedMillis: number) => ({ operation: 'stop' as const, recordingId, startedAt, elapsedMillis, reason: 'capture_stopped' })

describe('durable recording presence writer', () => {
  it('owns protocol identity and sends exact PCM duration with ten second heartbeat', async () => {
    const h = await setup(); await h.writer.report(scope, start); await h.wait(1); await new Promise(resolve => setTimeout(resolve, 5))
    const [path, body] = h.post.mock.calls[0]!
    expect(path.endsWith('/recording-presence/start')).toBe(true)
    expect(body).toMatchObject({ recording_id: recordingId, elapsed_ms: 1000, started_at: startedAt, seq: 1, state: 'recording', client_type: 'desktop', platform: 'macos', device_name: 'real-device', recording_mode: 'manual' })
    expect(body.writer_token).toMatch(/^[0-9a-f]{64}$/); expect(body.runtime_id).toMatch(/^[0-9a-f-]{36}$/)
    h.setNow(startedAt + 1000); await h.writer.report(scope, update(2000))
    expect(h.post).toHaveBeenCalledTimes(1)
    h.setNow(startedAt + 11000); await h.writer.report(scope, update(12000)); await h.wait(2)
    expect(h.post.mock.calls[1]![1]).toMatchObject({ seq: 2, elapsed_ms: 12000, writer_token: body.writer_token, runtime_id: body.runtime_id })
  })
  it('keeps retry sequence/body and lets stop supersede an offline update', async () => {
    let failUpdate = true
    const h = await setup(async path => { if (path.endsWith('/update') && failUpdate) throw new Error('offline'); return { heartbeat_interval_ms: 10000 } })
    await h.writer.report(scope, start); await h.wait(1); await new Promise(resolve => setTimeout(resolve, 5))
    h.setNow(startedAt + 11000); await h.writer.report(scope, update(12000)); await h.wait(2)
    const failed = h.post.mock.calls[1]![1]
    await new Promise(resolve => setTimeout(resolve, 5))
    expect((await h.stored()).entries[0]?.pending?.body).toEqual(failed)
    h.setNow(startedAt + 12000); await h.writer.report(scope, stop(12500)); await h.wait(3)
    expect(h.post.mock.calls[2]![0].endsWith('/recording-presence/stop')).toBe(true)
    expect(h.post.mock.calls[2]![1]).toMatchObject({ seq: 3, elapsed_ms: 12500, state: 'stopped' })
    failUpdate = false
  })
  it('retries the identical pending request and never renews without fresh capture evidence', async () => {
    let offline = true
    const h = await setup(async () => { if (offline) throw new Error('offline'); return { heartbeat_interval_ms: 10000 } })
    await h.writer.report(scope, start); await h.wait(1)
    const first = h.post.mock.calls[0]![1]
    await new Promise(resolve => setTimeout(resolve, 5))
    h.setNow(startedAt + 9000); await h.writer.report(scope, update(9000))
    expect(h.post).toHaveBeenCalledTimes(1)
    offline = false
    h.setNow(startedAt + 11000); await (h.writer as any).tick(); await h.wait(2)
    expect(h.post.mock.calls[1]![1]).toEqual(first)
    await new Promise(resolve => setTimeout(resolve, 5))
    h.setNow(startedAt + 40000); await (h.writer as any).tick()
    expect(h.post).toHaveBeenCalledTimes(2)
  })
  it('coalesces offline PCM evidence into one current snapshot after retry succeeds', async () => {
    let offline = true
    const h = await setup(async () => { if (offline) throw new Error('offline'); return { heartbeat_interval_ms: 10000 } })
    await h.writer.report(scope, start); await h.wait(1); await new Promise(resolve => setTimeout(resolve, 5))
    offline = false; h.setNow(startedAt + 12000)
    await h.writer.report(scope, update(13000)); await h.wait(3)
    expect(h.post.mock.calls[1]![1]).toEqual(h.post.mock.calls[0]![1])
    expect(h.post.mock.calls[2]![1]).toMatchObject({ seq: 2, elapsed_ms: 13000, state: 'recording' })
  })
  it('does not retry an old running snapshot after capture evidence goes stale', async () => {
    const h = await setup(async () => { throw new Error('offline') })
    await h.writer.report(scope, start); await h.wait(1); await new Promise(resolve => setTimeout(resolve, 5))
    h.setNow(startedAt + 20000); await (h.writer as any).tick()
    expect(h.post).toHaveBeenCalledTimes(1)
    await h.writer.report(scope, update(21000)); await h.wait(2)
    expect(h.post.mock.calls[1]![1]).toEqual(h.post.mock.calls[0]![1])
  })
  it('sends stop next when it overtakes an in-flight start', async () => {
    let release!: () => void
    const h = await setup(async path => path.endsWith('/start')
      ? await new Promise<Record<string, unknown>>(resolve => { release = () => resolve({ heartbeat_interval_ms: 10000 }) })
      : { heartbeat_interval_ms: 10000 })
    await h.writer.report(scope, start); await h.wait(1)
    await h.writer.report(scope, stop(1500))
    expect((await h.stored()).entries[0]).toMatchObject({ stopped: true, seq: 1 })
    release(); await h.wait(2)
    expect(h.post.mock.calls.map(([path]) => path.split('/').at(-1))).toEqual(['start', 'stop'])
    expect(h.post.mock.calls[1]![1]).toMatchObject({ seq: 2, state: 'stopped', elapsed_ms: 1500 })
  })
  it('does not send a new recording start ahead of a durable failed stop', async () => {
    let stopOffline = true
    const h = await setup(async path => { if (path.endsWith('/stop') && stopOffline) throw new Error('offline'); return { heartbeat_interval_ms: 10000 } })
    await h.writer.report(scope, start); await h.wait(1); await new Promise(resolve => setTimeout(resolve, 5))
    await h.writer.report(scope, stop(1500)); await h.wait(2); await new Promise(resolve => setTimeout(resolve, 5))
    const nextId = 'c20ff9fd-9aa8-4a0f-aa83-c8ad588e4a7d'
    await h.writer.report(scope, { ...start, recordingId: nextId })
    expect(h.post).toHaveBeenCalledTimes(2)
    stopOffline = false; h.setNow(startedAt + 11000); await (h.writer as any).tick(); await h.wait(3)
    expect(h.post.mock.calls[2]![0].endsWith('/stop')).toBe(true)
    expect(h.post.mock.calls[2]![1]).toEqual(h.post.mock.calls[1]![1])
    await h.wait(4)
    expect(h.post.mock.calls[3]![1].recording_id).toBe(nextId)
  })
  it('does not refresh evidence or keep heartbeats alive from repeated elapsed snapshots', async () => {
    const h = await setup(); await h.writer.report(scope, start); await h.wait(1); await new Promise(resolve => setTimeout(resolve, 5))
    h.setNow(startedAt + 20000); await h.writer.report(scope, update(1000)); await (h.writer as any).tick()
    expect(h.post).toHaveBeenCalledTimes(1)
    h.setNow(startedAt + 21000); await h.writer.report(scope, update(2000)); await h.wait(2)
    expect(h.post.mock.calls[1]![1]).toMatchObject({ elapsed_ms: 2000, seq: 2 })
  })
  it('replays a recovered stop from the normal session entry without a new capture', async () => {
    const h = await setup(async () => await new Promise<Record<string, unknown>>(() => undefined))
    await h.writer.report(scope, start); await h.wait(1); h.writer.revoke()
    const post = vi.fn(async () => ({ heartbeat_interval_ms: 10000 }))
    const runtime = { config: { environment: 'test' }, requireSession: async () => ({ userId: 42, accessToken: 'test-token', refreshToken: 'test-refresh' }), authenticatedAudioPost: post } as unknown as ServiceRuntime
    const recovered = new RecordingPresenceWriter(runtime, h.directory, () => startedAt + 10000, () => ({ name: 'real-device', platform: 'macos' }))
    writers.push(recovered)
    await recovered.resumeCurrent()
    for (let i = 0; i < 100 && !post.mock.calls.length; i++) await new Promise(resolve => setTimeout(resolve, 2))
    expect(post.mock.calls[0]![0]).toMatch(/\/recording-presence\/stop$/)
    expect(post.mock.calls[0]![1]).toMatchObject({ state: 'stopped', stop_reason: 'process_recovered', recording_id: recordingId })
  })
  it('fences a queued old-account fact across logout and same-account login', async () => {
    const h = await setup()
    let release!: (session: { userId: number; accessToken: string; refreshToken: string }) => void
    const deferred = new Promise<{ userId: number; accessToken: string; refreshToken: string }>(resolve => { release = resolve })
    const runtime = (h.writer as any).runtime as { requireSession: ReturnType<typeof vi.fn> }
    runtime.requireSession.mockImplementationOnce(async () => await deferred)
    const old = h.writer.report(scope, start)
    const queued = h.writer.report(scope, update(2000))
    await Promise.resolve(); h.writer.revoke()
    release({ userId: 42, accessToken: 'old-token', refreshToken: 'old-refresh' })
    await Promise.all([old, queued])
    expect(h.post).not.toHaveBeenCalled()
    await h.writer.report(scope, start); await h.wait(1)
    expect(h.post).toHaveBeenCalledTimes(1)
  })
  it('uses the server heartbeat interval above and below ten seconds', async () => {
    const slow = await setup(async () => ({ heartbeat_interval_ms: 20000 }))
    await slow.writer.report(scope, start); await slow.wait(1); await new Promise(resolve => setTimeout(resolve, 5))
    expect((slow.writer as any).timer._idleTimeout).toBe(20000)
    slow.setNow(startedAt + 11000); await slow.writer.report(scope, update(12000))
    expect(slow.post).toHaveBeenCalledTimes(1)
    slow.setNow(startedAt + 21000); await slow.writer.report(scope, update(22000)); await slow.wait(2)
    expect(slow.post.mock.calls[1]![1]).toMatchObject({ seq: 2, elapsed_ms: 22000 })

    const fast = await setup(async () => ({ heartbeat_interval_ms: 5000 }))
    await fast.writer.report(scope, start); await fast.wait(1); await new Promise(resolve => setTimeout(resolve, 5))
    expect((fast.writer as any).timer._idleTimeout).toBe(5000)
    fast.setNow(startedAt + 6000); await fast.writer.report(scope, update(7000)); await fast.wait(2)
    expect(fast.post.mock.calls[1]![1]).toMatchObject({ seq: 2, elapsed_ms: 7000 })
  })
  it('limits stop reasons by UTF-8 bytes without splitting a code point', async () => {
    const h = await setup(); await h.writer.report(scope, start); await h.wait(1); await new Promise(resolve => setTimeout(resolve, 5))
    await h.writer.report(scope, { ...stop(1200), reason: '😀'.repeat(40) }); await h.wait(2)
    const reason = h.post.mock.calls[1]![1].stop_reason as string
    expect(Buffer.byteLength(reason, 'utf8')).toBe(128)
    expect(reason).toBe('😀'.repeat(32))
  })
  it('catches timer persistence failure and retries on the next tick', async () => {
    const h = await setup(); await h.writer.report(scope, start); await h.wait(1); await new Promise(resolve => setTimeout(resolve, 5))
    h.setNow(startedAt + 11000)
    const save = vi.spyOn(h.writer as any, 'save').mockRejectedValueOnce(new Error('disk full'))
    ;(h.writer as any).schedule(1)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(save).toHaveBeenCalled()
    expect(h.post).toHaveBeenCalledTimes(1)
    save.mockRestore()
    await (h.writer as any).tick(); await h.wait(2)
    expect(h.post.mock.calls[1]![1]).toMatchObject({ seq: 2, elapsed_ms: 1000 })
  })
  it('retries recovery persistence after a transient disk error', async () => {
    const h = await setup(async () => await new Promise<Record<string, unknown>>(() => undefined))
    await h.writer.report(scope, start); await h.wait(1); h.writer.revoke()
    const post = vi.fn(async () => ({ heartbeat_interval_ms: 10000 }))
    const runtime = { config: { environment: 'test' }, requireSession: async () => ({ userId: 42, accessToken: 'test-token', refreshToken: 'test-refresh' }), authenticatedAudioPost: post } as unknown as ServiceRuntime
    const recovered = new RecordingPresenceWriter(runtime, h.directory, () => startedAt + 10000, () => ({ name: 'real-device', platform: 'macos' }))
    writers.push(recovered)
    const save = vi.spyOn(recovered as any, 'save').mockRejectedValueOnce(new Error('disk full'))
    await expect(recovered.resumeCurrent()).rejects.toThrow('disk full')
    expect(post).not.toHaveBeenCalled()
    save.mockRestore(); await recovered.resumeCurrent()
    for (let i = 0; i < 100 && !post.mock.calls.length; i++) await new Promise(resolve => setTimeout(resolve, 2))
    expect(post.mock.calls[0]![0]).toMatch(/\/recording-presence\/stop$/)
  })
  it('recovers a prior process as stopped and fences a different account', async () => {
    const h = await setup(async () => await new Promise<Record<string, unknown>>(() => undefined))
    await h.writer.report(scope, start); await h.wait(1)
    h.writer.revoke()
    const second = new RecordingPresenceWriter(({ config: { environment: 'test' }, requireSession: async () => ({ userId: 42, accessToken: 'test-token', refreshToken: 'test-refresh' }), authenticatedAudioPost: h.post } as unknown as ServiceRuntime), h.directory, () => startedAt + 10000, () => ({ name: 'real-device', platform: 'macos' }))
    writers.push(second)
    await second.report(scope, { ...start, recordingId: 'c20ff9fd-9aa8-4a0f-aa83-c8ad588e4a7d' })
    const data = await h.stored()
    expect(data.entries.find(item => item.stopped)?.pending?.operation).toBe('stop')
    await expect(second.report('test:43', update(2000))).rejects.toThrow('账号已变化')
  })
})
