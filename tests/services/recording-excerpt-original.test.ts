import { expect, it, vi } from 'vitest'
import { RecordingService } from '../../src/services/recording-service.js'
import type { RecordingServiceDependencies } from '../../src/services/recording-service.js'
import type { ServiceRuntime } from '../../src/services/service.js'
import { recordingOwnerResponse, recordingId, childId } from '../fixtures/recording-owner.js'

function fixture(text = '原文', source = 'system') {
  const at = 1_700_000_000_000
  const post = vi.fn(async (path: string, body: Record<string, unknown>) => {
    expect(path).toBe('/api/v1/audio/recordings/transcript/query')
    expect(body).toMatchObject({ recording_uid: recordingId, start_at: at, end_at: at + 1000, source: source === 'system' ? 'primary' : 'enhanced' })
    return recordingOwnerResponse(path, body, [{ startAt: at, items: [{text}], enhanced: [{text}] }])
  })
  const runtime = { requireSession: async () => ({userId:42}), authenticatedAudioPost:post, subscribeAccountScope: () => () => {}, stateStore:{} } as unknown as ServiceRuntime
  const service = new RecordingService(runtime, {} as RecordingServiceDependencies)
  return { service, post, at, ref:JSON.stringify([childId,0,source,at,at,at+1000,null]) }
}

it.each(['system','doubao'])('opens the exact %s clip through the current Audio owner without loading a day', async source => {
  const f=fixture('原文',source)
  try { await expect(f.service.excerptOriginal(recordingId,f.ref)).resolves.toEqual({title:'录音原文',text:'原文',at:f.at});expect(f.post).toHaveBeenCalledTimes(1) }
  finally { f.service.dispose() }
})

it('joins a split clip across pages while keeping the owner revision and exact location', async () => {
  const text='🙂原文'.repeat(9000),f=fixture(text)
  try { await expect(f.service.excerptOriginal(recordingId,f.ref)).resolves.toMatchObject({text});expect(f.post.mock.calls.length).toBeGreaterThan(1) }
  finally { f.service.dispose() }
})

it('rejects a removed clip and a canceled read without returning the saved excerpt', async () => {
  const f=fixture()
  try {
    f.post.mockResolvedValueOnce({status:'unavailable'})
    await expect(f.service.excerptOriginal(recordingId,f.ref)).rejects.toMatchObject({code:'recording-view-changed'})
    const controller=new AbortController();controller.abort()
    await expect(f.service.excerptOriginal(recordingId,f.ref,controller.signal)).rejects.toThrow()
    expect(f.post).toHaveBeenCalledTimes(1)
  } finally { f.service.dispose() }
})
