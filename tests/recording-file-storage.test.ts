import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { RecordingFileStorageService } from '../src/services/recording-file-storage-service.js'
import type { ServiceRuntime } from '../src/services/service.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import { createArkmeSdk } from '../src/sdk/index.js'
import { registerArkmeTools, type ArkmeToolPorts } from '../src/tools/index.js'

const id = '0123456789abcdef01234567'
const second = 'abcdef0123456789abcdef01'
const row = (patch = {}) => ({ session_id: id, bytes: 200, checked_at: 1234, ...patch })
function fixture() {
  let userId = 42
  const post = vi.fn(async () => ({ items: [row()] }))
  const open = vi.fn(async (ref: string) => {
    if (ref === 'foreign') throw new Error('foreign reference')
    return { sessionId: ref === 'second' ? second : id }
  })
  const service = new RecordingFileStorageService({ requireSession: async () => ({ userId }), authenticatedAudioPost: post } as unknown as ServiceRuntime, open)
  return { service, post, open, setUser: (next: number) => { userId = next } }
}

it('uses one account-scoped Audio read and exposes only observations and opaque refs', async () => {
  const f = fixture(), signal = new AbortController().signal
  expect(await f.service.query({ sessionRefs: ['opaque'] }, signal)).toEqual({ items: [{ sessionRef: 'opaque', bytes: 200, checkedAtMillis: 1234 }] })
  expect(f.post).toHaveBeenCalledWith('/api/v1/audio/files/storage', { session_ids: [id] }, { userId: 42 }, signal, { bypassCache: true })
  expect(JSON.stringify(await f.service.query({ sessionRefs: ['opaque'] }))).not.toContain(id)
})

it('rejects invalid, duplicate and foreign refs before Audio I/O', async () => {
  const f = fixture()
  for (const refs of [[], [''], ['x', 'x'], Array.from({ length: 21 }, (_, i) => `r${i}`), ['foreign'], ['same-owner-a', 'same-owner-b']]) {
    await expect(f.service.query({ sessionRefs: refs })).rejects.toThrow()
  }
  expect(f.post).not.toHaveBeenCalled()
  await expect(f.service.query({ sessionRefs: ['opaque'] }, AbortSignal.abort())).rejects.toThrow()
  expect(f.post).not.toHaveBeenCalled()
})

it('requires a numeric result including real zero and refuses malformed or foreign results', async () => {
  const f = fixture()
  f.post.mockResolvedValueOnce({ items: [row({ bytes: 0 })] })
  expect((await f.service.query({ sessionRefs: ['opaque'] })).items[0]?.bytes).toBe(0)
  for (const bad of [row({ bytes: -1 }), row({ bytes: 1e20 }), row({ bytes: null }), row({ checked_at: -1 }), row({ session_id: second })]) {
    f.post.mockResolvedValueOnce({ items: [bad] })
    await expect(f.service.query({ sessionRefs: ['opaque'] })).rejects.toThrow('返回数据无效')
  }
  f.post.mockResolvedValueOnce({ items: [row(), row()] })
  await expect(f.service.query({ sessionRefs: ['opaque', 'second'] })).rejects.toThrow()
})

it('discards an account change or cancellation while the read is in flight', async () => {
  const f = fixture()
  f.post.mockImplementationOnce(async () => { f.setUser(43); return { items: [row()] } })
  await expect(f.service.query({ sessionRefs: ['opaque'] })).rejects.toThrow('账号已变化')
  const controller = new AbortController()
  f.post.mockImplementationOnce(async () => { controller.abort(); return { items: [row()] } })
  await expect(f.service.query({ sessionRefs: ['opaque'] }, controller.signal)).rejects.toThrow()
})

it('shares Host and public SDK contracts, capability discovery, cancellation and dispose', async () => {
  const calls: unknown[] = [], signal = new AbortController().signal
  const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    const input = JSON.parse(String(init?.body)); calls.push(input)
    return new Response(JSON.stringify({ ok: true, value: input.operation === 'provider.capabilities' ? { contractVersion: 1, features: { recordingFileStorageV1: true } } : { items: [] } }))
  } })
  await sdk.recordingFileStorage({ sessionRefs: ['opaque'] }, signal)
  expect(calls).toEqual([{ operation: 'provider.capabilities' }, { operation: 'recordings.files.storage', params: { sessionRefs: ['opaque'] } }])
  const owner = { recordingFileStorage: vi.fn(async () => ({ items: [] })) }
  await dispatchArkmeHostOperation(owner as never, 'recordings.files.storage', { sessionRefs: ['opaque'], userId: 99, objectKey: 'foreign' }, undefined, undefined, undefined, undefined, signal)
  expect(owner.recordingFileStorage).toHaveBeenCalledWith({ sessionRefs: ['opaque'] }, signal)
  const old = createArkmeSdk({ fetchImpl: async () => new Response(JSON.stringify({ ok: true, value: { contractVersion: 1, features: {} } })) })
  await expect(old.recordingFileStorage({ sessionRefs: ['opaque'] })).rejects.toThrow('不支持')
  sdk.dispose()
  const beforeDisposedRead = calls.length
  await expect(sdk.recordingFileStorage({ sessionRefs: ['opaque'] })).rejects.toThrow()
  expect(calls).toHaveLength(beforeDisposedRead)
})

it('is discoverable and callable through official DSH tool registration with read-only grants and schema limits', async () => {
  const ctx = new Context()
  await ctx.plugin(ToolRuntime); await ctx.plugin(SystemPrompt)
  const recordingFileStorage = vi.fn(async () => ({ items: [{ sessionRef: 'opaque', bytes: 200, checkedAtMillis: 1234 }] }))
  const fiber = await ctx.plugin(Object.assign((c: Context) => registerArkmeTools(c, { recordingFileStorage } as unknown as ArkmeToolPorts, 'business'), { inject: ['tools', 'systemPrompt'] }))
  try {
    expect(ctx.tools.schemas().some(tool => tool.name === 'arkme_recording_file_storage')).toBe(true)
    const result = await ctx.tools.execute({ name: 'arkme_recording_file_storage', callId: ToolCallId('storage-read'), arguments: { session_refs: ['opaque'] }, signal: new AbortController().signal })
    expect(result.isError).not.toBe(true); expect(JSON.stringify(result)).toContain('200')
    expect(recordingFileStorage).toHaveBeenCalledWith({ sessionRefs: ['opaque'] }, expect.any(AbortSignal))
    const invalid = await ctx.tools.execute({ name: 'arkme_recording_file_storage', callId: ToolCallId('storage-invalid'), arguments: { session_refs: [] }, signal: new AbortController().signal })
    expect(invalid.isError).toBe(true); expect(recordingFileStorage).toHaveBeenCalledOnce()
  } finally { await fiber.dispose() }
})

it('SDK disposal cancels an in-flight storage read and never publishes its late response', async () => {
  let finish!: (response: Response) => void
  let observed: AbortSignal | undefined
  const fetcher = vi.fn(async (_url, init) => {
    const input = JSON.parse(String(init?.body))
    if (input.operation === 'provider.capabilities') return new Response(JSON.stringify({ ok: true, value: { contractVersion: 1, features: { recordingFileStorageV1: true } } }))
    observed = init.signal
    return new Promise<Response>(resolve => { finish = resolve })
  })
  const sdk = createArkmeSdk({ fetchImpl: fetcher })
  const pending = sdk.recordingFileStorage({ sessionRefs: ['opaque'] })
  await vi.waitFor(() => expect(finish).toBeDefined())
  sdk.dispose(); expect(observed?.aborted).toBe(true)
  finish(new Response(JSON.stringify({ ok: true, value: { items: [] } })))
  await expect(pending).rejects.toThrow()
  expect(fetcher).toHaveBeenCalledTimes(2)
})
