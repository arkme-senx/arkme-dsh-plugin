import { beforeEach, expect, it, vi } from 'vitest'
import { prepareRecordSelectedTextReplace } from '../src/client/record-selected-text-replace.js'
import { callArkme } from '../src/client/api.js'
import type { ArkmeTimelineItem } from '../src/types.js'
vi.mock('../src/client/api.js', () => ({ callArkme: vi.fn() }))
const target = { sourceRef: 'source', item: { itemUid: 'one', textContent: '词 词', textFormat: 'plain', recordVersion: 3 } as ArkmeTimelineItem }
const quote = { version: 1 as const, projection: 'arkme-text-v1' as const, sourceDigest: 'a'.repeat(64), start: 2, end: 3, text: '词', prefix: '词 ', suffix: '' }
const snapshot = { itemUid: 'one', textContent: '词 词', textFormat: 'plain', version: 3, maxTextLength: 100, hasVoice: false,
  attachments: [{ selection: { fileAssetUid: 'asset1' } }] }
beforeEach(() => vi.mocked(callArkme).mockReset())
it('keeps attachments, CAS version, mentions and existing submission recovery', async () => {
  const receipt = { submissionId: 'job', state: 'pending' }, accepted = vi.fn()
  vi.mocked(callArkme).mockResolvedValueOnce(snapshot).mockResolvedValueOnce(receipt)
  const session = await prepareRecordSelectedTextReplace(target, quote, new AbortController().signal, () => {}, accepted)
  await session.save('新词')
  expect(callArkme).toHaveBeenLastCalledWith('source.record-reedit.submit', expect.objectContaining({ newText: '词 新词', expectedVersion: 3, expectedDraftRevision: 0,
    attachments: [{ fileAssetUid: 'asset1' }], mentions: [] }), expect.any(AbortSignal))
  expect(accepted).toHaveBeenCalledWith(receipt)
})
it.each([
  [{ ...snapshot, draft: { draftRevision: 1 } }, '草稿'],
  [{ ...snapshot, version: 4 }, '消息已更新'],
  [{ ...snapshot, textContent: '词 另一个词' }, '消息已更新'],
])('does not overwrite a draft or a newer remote version', async (detail, error) => {
  vi.mocked(callArkme).mockResolvedValueOnce(detail)
  await expect(prepareRecordSelectedTextReplace(target, quote, new AbortController().signal, () => {}, vi.fn())).rejects.toThrow(error)
  expect(callArkme).toHaveBeenCalledTimes(1)
})
it('checks account and editor ownership again immediately before submitting', async () => {
  vi.mocked(callArkme).mockResolvedValueOnce(snapshot)
  let switched = false
  const session = await prepareRecordSelectedTextReplace(target, quote, new AbortController().signal, () => { if (switched) throw new Error('账号已变化') }, vi.fn())
  switched = true
  await expect(session.save('新词')).rejects.toThrow('账号已变化')
  expect(callArkme).toHaveBeenCalledTimes(1)
})
