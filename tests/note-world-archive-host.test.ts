import { expect, it, vi } from 'vitest'
import { ArkmeService } from '../src/arkme-service.js'

function fixture() {
  const runtime = { requireSession: vi.fn(async () => ({ userId: 7 })) }
  const chat = { recordEditHistoryTarget: vi.fn(async () => ({ kind: 'owned', recordUid: 'exact-original' })) }
  const world = { reactionReference: vi.fn(async () => 'sealed-world-original') }
  const prepareWorldReactions = vi.fn(async () => ({ items: [], unavailableRecordRefs: [] }))
  const service = { runtime, chat, world, prepareWorldReactions, config: { environment: 'test' } }
  const read = (account = 'test:7', signal?: AbortSignal) => ArkmeService.prototype.prepareNoteWorldReactions.call(service as never, account, 'source', 'message', signal)
  return { ...service, read }
}

it('resolves only the exact owned original through the existing capability gate', async () => {
  const f = fixture()
  await f.read()
  expect(f.chat.recordEditHistoryTarget).toHaveBeenCalledWith('source', 'message')
  expect(f.world.reactionReference).toHaveBeenCalledWith('exact-original')
  expect(f.prepareWorldReactions).toHaveBeenCalledWith('test:7', ['sealed-world-original'], undefined)
})

it('rejects account mismatch, cancellation and denied source references without World reads', async () => {
  const f = fixture()
  await expect(f.read('test:8')).rejects.toMatchObject({ code: 'reaction-account-changed' })
  await expect(f.read('prod:7')).rejects.toMatchObject({ code: 'reaction-account-changed' })
  const c = new AbortController(); c.abort()
  await expect(f.read('test:7', c.signal)).rejects.toThrow()
  expect(f.chat.recordEditHistoryTarget).not.toHaveBeenCalled()
  f.chat.recordEditHistoryTarget.mockRejectedValueOnce(new Error('not owned'))
  await expect(f.read()).rejects.toThrow('not owned')
  expect(f.world.reactionReference).not.toHaveBeenCalled()
})

it('does not convert a chat record into a World archive', async () => {
  const f = fixture()
  f.chat.recordEditHistoryTarget.mockResolvedValue({ kind: 'chat', recordUid: 'chat-original' })
  expect(await f.read()).toEqual({ items: [], unavailableRecordRefs: [] })
  expect(f.world.reactionReference).not.toHaveBeenCalled()
  expect(f.prepareWorldReactions).not.toHaveBeenCalled()
})
