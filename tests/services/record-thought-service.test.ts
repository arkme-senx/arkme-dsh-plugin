import { expect, it, vi } from 'vitest'
import { readRecordThoughts } from '../../src/services/record-thought-service.js'
import type { ServiceRuntime } from '../../src/services/service.js'

function fixture() {
  const requireSession = vi.fn(async () => ({ userId: 42 }))
  const post = vi.fn(async () => ({ thought_ls: [
    {source_version:1,current_source_version:1,id: 'a', record_uid: 'note', content: '**可以试试**', biz: 1 },
    {source_version:1,current_source_version:1,id: 'b', record_uid: 'note', content: '主动回应', biz: 2 },
    {source_version:1,current_source_version:1,id: 'a', record_uid: 'note', content: '**可以试试**', biz: 1 },
    {source_version:1,current_source_version:1,id: 'foreign', record_uid: 'not-requested', content: '不能返回', biz: 1 },
  ] }))
  const runtime = { config: { environment: 'production' }, requireSession, authenticatedIntelligentPost: post } as unknown as ServiceRuntime
  return { runtime, requireSession, post }
}
it('reads existing private thoughts in a bounded background batch and preserves both businesses', async () => {
  const f = fixture(), signal = new AbortController().signal
  const result = await readRecordThoughts(f.runtime, 'production:42', [' note ', 'note'], signal)
  expect(f.post).toHaveBeenCalledExactlyOnceWith('/api/v1/thought/get-private-by-ruids', { ruids: ['note'] }, { userId: 42 }, signal,
    { lane: 'background-read', publishServiceCooldown: false })
  expect(result).toEqual({ accountScope: 'production:42', items: [
    {sourceVersion:1,currentSourceVersion:1,id: 'a', recordUid: 'note', content: '**可以试试**', biz: 1 }, {sourceVersion:1,currentSourceVersion:1,id: 'b', recordUid: 'note', content: '主动回应', biz: 2 },
  ] })
})
it('rejects foreign account scopes and malformed or oversized queries before a remote read', async () => {
  const f = fixture()
  await expect(readRecordThoughts(f.runtime, 'production:7', ['note'])).rejects.toThrow('账号已切换')
  for (const value of [undefined, [''], ['bad\nuid'], [42], Array.from({ length: 51 }, (_, i) => String(i))])
    await expect(readRecordThoughts(f.runtime, 'production:42', value)).rejects.toThrow('范围无效')
  expect(f.post).not.toHaveBeenCalled()
  expect(await readRecordThoughts(f.runtime, 'production:42', [])).toEqual({ accountScope: 'production:42', items: [] })
})
it('rejects a late result after account switching or cancellation', async () => {
  const f = fixture()
  f.requireSession.mockResolvedValueOnce({ userId: 42 }).mockResolvedValue({ userId: 7 })
  await expect(readRecordThoughts(f.runtime, 'production:42', ['note'])).rejects.toThrow('账号已切换')
  const other = fixture(), controller = new AbortController()
  other.post.mockImplementation(async () => { controller.abort(); return { thought_ls: [] } })
  await expect(readRecordThoughts(other.runtime, 'production:42', ['note'], controller.signal)).rejects.toThrow()
})
it('does not turn an invalid response into a confirmed empty result', async () => {
  const f = fixture()
  f.post.mockResolvedValue({} as never)
  await expect(readRecordThoughts(f.runtime, 'production:42', ['note'])).rejects.toThrow('暂时无法读取')
})
