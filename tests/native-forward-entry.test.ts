import { describe, expect, it, vi } from 'vitest'
import { nativeForwardDelivery, openNativeForward } from '../src/client/native-forward-entry.js'
import type { ArkmeSourceItem } from '../src/types.js'

describe('native forwarding entry and retry boundary', () => {
  it('fails explicitly when the existing Arkme page is unavailable', () => {
    expect(() => openNativeForward({ defaultView: { parent: {} } } as Document, { snapshot: { sessionId: 'a', messages: [] }, userId: 1, delivery: { send: vi.fn(), comment: undefined } }, new AbortController().signal)).toThrow('尚未就绪')
  })
  it('keeps stable identities across refreshed target access refs, failure and comment changes', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('unknown')).mockResolvedValue({ itemUid: 'sent', localState: 'synced' })
    const deliver = nativeForwardDelivery(send)
    const target = { kind: 'private_chat', sourceKey: 'chat:one', sourceRef: 'old' } as ArkmeSourceItem
    const signal = new AbortController().signal
    await expect(deliver.send(target, 'first', signal)).rejects.toThrow('unknown')
    await deliver.send({ ...target, sourceRef: 'new' }, 'changed', signal)
    expect(send.mock.calls[1]![1]).toEqual(send.mock.calls[0]![1])
    expect(send.mock.calls[1]![2]).toBe('first')
    await deliver.send(target, 'again', signal)
    expect(send).toHaveBeenCalledTimes(2)
    expect(deliver.comment).toBe('first')
    await deliver.send({ ...target, sourceKey: 'chat:two' }, 'changed', signal)
    expect(send.mock.calls[2]![2]).toBe('first')
    expect(send.mock.calls[2]![1]).not.toEqual(send.mock.calls[0]![1])
  })
  it('retains original identity for comment-only retry without treating a warning as complete', async () => {
    const send = vi.fn().mockResolvedValueOnce({ itemUid: 'sent', localState: 'synced', warningText: '附言失败' }).mockResolvedValue({ itemUid: 'sent', localState: 'synced' })
    const deliver = nativeForwardDelivery(send)
    const target = { kind: 'send_to_self', sourceRef: 'first' } as ArkmeSourceItem
    await deliver.send(target, 'comment', new AbortController().signal)
    await deliver.send({ ...target, sourceRef: 'renewed' }, 'changed', new AbortController().signal)
    expect(send.mock.calls[1]![1]).toEqual(send.mock.calls[0]![1])
    expect(send.mock.calls[1]![2]).toBe('comment')
  })
  it('does not accept an unconfirmed receipt as delivered', async () => {
    const deliver = nativeForwardDelivery(vi.fn().mockResolvedValue({ localState: 'pending' }))
    await expect(deliver.send({ kind: 'send_to_self', sourceRef: 's' } as ArkmeSourceItem, '', new AbortController().signal)).rejects.toThrow('未确认')
  })
})
