import { describe, it, expect, vi } from 'vitest'
import { selectedTextForwardContent } from '../src/client/selected-text-forward.js'
import { callArkme } from '../src/client/api.js'
import type { ArkmeSourceItem } from '../src/types.js'
vi.mock('../src/client/api.js', () => ({ callArkme: vi.fn() }))
const quote = { version: 1 as const, sourceLabel: '群聊 · 工作', senderName: '同事', sourceAtMillis: 1000, text: '只选中的原文' }
const self = { kind: 'send_to_self', sourceRef: 'self' } as ArkmeSourceItem
const chat = { kind: 'private_chat', sourceRef: 'old', sourceKey: 'chat:a' } as ArkmeSourceItem
const group = { kind: 'group_chat', sourceRef: 'group', sourceKey: 'chat:g' } as ArkmeSourceItem
it('freezes selected content and optional comment, retains successful targets and retries only failed targets', async () => {
  const content = selectedTextForwardContent('prod:11', quote), ctrl = new AbortController()
  content.preview.quote!.text = '预览更改不能改变发送快照'
  vi.mocked(callArkme).mockImplementation(async (_op, params) => ({ itemUid: params!.recordUid, localState: 'synced' }))
  await content.delivery.send(self, '', ctrl.signal)
  vi.mocked(callArkme).mockRejectedValueOnce(new Error('timeout'))
  await expect(content.delivery.send(chat, '更改附言', ctrl.signal)).rejects.toThrow('timeout')
  await content.delivery.send({ ...chat, sourceRef: 'renewed' }, '再改', ctrl.signal)
  await content.delivery.send(self, '不应重发', ctrl.signal)
  await content.delivery.send(group, '仍是原附言', ctrl.signal)
  const calls = vi.mocked(callArkme).mock.calls
  expect(calls).toHaveLength(4)
  expect(calls.every(([op, params]) => op === 'selected-text.forward' && params?.commentText === '' && (params?.quote as typeof quote).text === quote.text)).toBe(true)
  expect(calls[1]![1]).toMatchObject({ recordUid: calls[2]![1]!.recordUid, relationUid: calls[2]![1]!.relationUid })
  expect(calls[1]![1]!.recordUid).not.toBe(calls[0]![1]!.recordUid)
  expect(calls[3]![1]!.recordUid).not.toBe(calls[0]![1]!.recordUid)
  ctrl.abort()
  await expect(content.delivery.send({ ...group, sourceKey: 'chat:new' }, '', ctrl.signal)).rejects.toThrow()
})
