import { beforeEach, it, expect, vi } from 'vitest'
import { forwardSelectedText, selectedTextForwardContent } from '../src/client/selected-text-forward.js'
import { registerLocalSnapshotForward } from '../src/client/local-snapshot-forward.js'
import { callArkme } from '../src/client/api.js'
import type { ArkmeSourceItem } from '../src/types.js'
vi.mock('../src/client/api.js', () => ({ callArkme: vi.fn() }))
const quote = { version: 1 as const, sourceLabel: '群聊 · 工作', senderName: '同事', sourceAtMillis: 1000, text: '只选中的原文' }
const self = { kind: 'send_to_self', sourceRef: 'self' } as ArkmeSourceItem
const chat = { kind: 'private_chat', sourceRef: 'old', sourceKey: 'chat:a' } as ArkmeSourceItem
const group = { kind: 'group_chat', sourceRef: 'group', sourceKey: 'chat:g' } as ArkmeSourceItem
const callsFor = (operation: string) => vi.mocked(callArkme).mock.calls.filter(([op]) => op === operation)
beforeEach(() => {
  vi.mocked(callArkme).mockReset()
  vi.mocked(callArkme).mockImplementation(async (op, params) => op === 'selected-text.prepare'
    ? params!.quote
    : { itemUid: params!.recordUid, localState: 'synced' })
})
it('freezes selected content and optional comment, retains successful targets and retries only failed targets', async () => {
  const content = selectedTextForwardContent('prod:11', quote), ctrl = new AbortController()
  content.preview.quote!.text = '预览更改不能改变发送快照'
  await content.delivery.send(self, '', ctrl.signal)
  vi.mocked(callArkme).mockRejectedValueOnce(new Error('timeout'))
  await expect(content.delivery.send(chat, '更改附言', ctrl.signal)).rejects.toThrow('timeout')
  await content.delivery.send({ ...chat, sourceRef: 'renewed' }, '再改', ctrl.signal)
  await content.delivery.send(self, '不应重发', ctrl.signal)
  await content.delivery.send(group, '仍是原附言', ctrl.signal)
  const calls = callsFor('selected-text.forward')
  expect(calls).toHaveLength(4)
  expect(calls.every(([op, params]) => op === 'selected-text.forward' && params?.commentText === '' && (params?.quote as typeof quote).text === quote.text)).toBe(true)
  expect(calls[1]![1]).toMatchObject({ recordUid: calls[2]![1]!.recordUid, relationUid: calls[2]![1]!.relationUid })
  expect(calls[1]![1]!.recordUid).not.toBe(calls[0]![1]!.recordUid)
  expect(calls[3]![1]!.recordUid).not.toBe(calls[0]![1]!.recordUid)
  ctrl.abort()
  await expect(content.delivery.send({ ...group, sourceKey: 'chat:new' }, '', ctrl.signal)).rejects.toThrow()
})

it('opens the existing picker before source preparation and shares one check across targets', async () => {
  const prepared = { ...quote, source: { kind: 'record' as const, owner_user_id: 11, record_uid: 'original' } }
  let finishPreparation!: (value: typeof prepared) => void
  const pending = new Promise<typeof prepared>(resolve => { finishPreparation = resolve })
  vi.mocked(callArkme).mockImplementationOnce(() => pending)

  const controller = new AbortController()
  const present = vi.fn(async (content: ReturnType<typeof selectedTextForwardContent>, signal: AbortSignal) => {
    expect(content.preview.quote).toEqual(quote)
    expect(callArkme).not.toHaveBeenCalled()
    const sends = [self, chat].map(target => content.delivery.send(target, '', signal))
    expect(callsFor('selected-text.prepare')).toHaveLength(1)
    expect(callsFor('selected-text.forward')).toHaveLength(0)
    finishPreparation(prepared)
    await Promise.all(sends)
    return { completed: true }
  })
  const stop = registerLocalSnapshotForward(present)
  try {
    const result = forwardSelectedText('test:11', quote, controller.signal)
    expect(present).toHaveBeenCalledOnce()
    await expect(result).resolves.toEqual({ completed: true })
  } finally { stop() }
  expect(callsFor('selected-text.forward')).toHaveLength(2)
  for (const [, params] of callsFor('selected-text.forward')) {
    expect(params!.quote).toEqual(prepared)
    expect(params!.sendAtMillis).toBeGreaterThan(0)
  }
})

it('lets the same picker retry a failed source check and never sends after cancellation', async () => {
  const content = selectedTextForwardContent('test:11', quote)
  const controller = new AbortController()
  vi.mocked(callArkme).mockImplementationOnce(async () => {
    controller.abort()
    return quote
  })
  vi.mocked(callArkme).mockRejectedValueOnce(new Error('network'))
  await expect(content.delivery.send(self, '附言', controller.signal)).rejects.toThrow()
  await expect(content.delivery.send(self, '仍是原附言', new AbortController().signal)).rejects.toThrow('network')
  await content.delivery.send(self, '不会覆盖原附言', new AbortController().signal)
  expect(callsFor('selected-text.prepare')).toHaveLength(3)
  expect(callsFor('selected-text.forward')).toHaveLength(1)
  expect(callsFor('selected-text.forward')[0]![1]!.commentText).toBe('附言')
})

it('keeps nested source identity and exact selection independent from previews and failed dispatches', async () => {
  const input = { ...quote, source: { kind: 'record' as const, owner_user_id: 11, record_uid: 'original' }, sourceSelection: { projection: 'arkme-text-v1' as const, source_digest: 'a'.repeat(64), start: 3, end: 3 + quote.text.length } }
  const expected = structuredClone(input)
  const content = selectedTextForwardContent('test:11', input), signal = new AbortController().signal
  input.source.record_uid = 'changed-input'
  if (content.preview.quote!.source!.kind === 'record') content.preview.quote!.source!.record_uid = 'changed-preview'
  content.preview.quote!.sourceSelection!.start = 0
  vi.mocked(callArkme).mockImplementation(async (op, params) => {
    expect(params!.quote).toEqual(expected)
    if (op === 'selected-text.prepare') return params!.quote
    if (callsFor('selected-text.forward').length === 1) {
      const sent = params!.quote as typeof input
      sent.source.record_uid = 'changed-dispatch'
      sent.sourceSelection.end = 1
      throw new Error('timeout')
    }
    return { itemUid: params!.recordUid, localState: 'synced' }
  })
  await expect(content.delivery.send(chat, '', signal)).rejects.toThrow('timeout')
  await content.delivery.send(chat, '', signal)
})
