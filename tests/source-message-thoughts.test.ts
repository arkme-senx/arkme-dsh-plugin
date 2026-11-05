import { describe, expect, it, vi } from 'vitest'
import { ArkmeService } from '../src/arkme-service.js'

function fixture(kind: 'owned' | 'chat' = 'owned') {
  const session = { userId: 11, refreshToken: 'synthetic-session' }
  const result = { accountScope: 'test:11', items: [{ id: 'thought', content: 'private thought', replyTargetRef: 'opaque' }] }
  const owner = {
    config: { environment: 'test' }, runtime: { requireSession: vi.fn(async () => session) },
    chat: { recordEditHistoryTarget: vi.fn(async () => ({ kind, viewerUserId: 11, recordUid: 'source' })) },
    record: { personalRecordDetail: vi.fn(async () => ({ itemUid: 'source' })) },
    recordThoughts: vi.fn(async () => result), chatThoughts: vi.fn(async () => result),
  }
  const run = (signal?: AbortSignal) => ArkmeService.prototype.sourceMessageThoughts.call(owner as never, 'signed-source', 'signed-action', signal)
  return { owner, result, run }
}
describe('source-bound thought read owner', () => {
  it('checks current personal access before and after reading the thought', async () => {
    const { owner, run, result } = fixture(), signal = new AbortController().signal
    expect(await run(signal)).toBe(result)
    expect(owner.chat.recordEditHistoryTarget).toHaveBeenCalledWith('signed-source', 'signed-action')
    expect(owner.record.personalRecordDetail).toHaveBeenCalledTimes(2)
    expect(owner.recordThoughts).toHaveBeenCalledExactlyOnceWith('test:11', ['source'], signal)
    expect(owner.chatThoughts).not.toHaveBeenCalled()
  })
  it('denies a locked or deleted personal source before exposing its thought', async () => {
    const { owner, run } = fixture()
    owner.record.personalRecordDetail.mockRejectedValueOnce(new Error('locked'))
    await expect(run()).rejects.toThrow('locked')
    expect(owner.recordThoughts).not.toHaveBeenCalled()
  })
  it('rejects privacy revocation arriving during the thought read', async () => {
    const { owner, run } = fixture()
    owner.record.personalRecordDetail.mockResolvedValueOnce({ itemUid: 'source' }).mockRejectedValueOnce(new Error('revoked'))
    await expect(run()).rejects.toThrow('revoked')
    expect(owner.recordThoughts).toHaveBeenCalledOnce()
  })
  it('uses the existing relation-bound chat owner without reading another author’s personal metadata', async () => {
    const { owner, run } = fixture('chat'), signal = new AbortController().signal
    await run(signal)
    expect(owner.chatThoughts).toHaveBeenCalledExactlyOnceWith('test:11', 'signed-source', ['signed-action'], signal)
    expect(owner.record.personalRecordDetail).not.toHaveBeenCalled()
  })
  it('rejects account/session changes and propagates pre-aborted cancellation without reads', async () => {
    const { owner, run } = fixture()
    owner.runtime.requireSession.mockResolvedValueOnce({ userId: 11, refreshToken: 'synthetic-session' }).mockResolvedValue({ userId: 22, refreshToken: 'another-session' })
    await expect(run()).rejects.toMatchObject({ code: 'record-thought-account-changed' })
    const fresh = fixture(), controller = new AbortController(); controller.abort()
    await expect(fresh.run(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fresh.owner.runtime.requireSession).not.toHaveBeenCalled()
  })
})
