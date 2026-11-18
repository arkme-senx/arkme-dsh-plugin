import { beforeEach, describe, expect, it, vi } from 'vitest'
import { conversationSearchReadPort as port } from '../src/client/conversation-search-port.js'
import type { ArkmeSearchRecordItem } from '../src/types.js'

const call = vi.hoisted(() => vi.fn())
vi.mock('../src/client/api.js', () => ({ callArkme: call }))
const hit = { sourceKind: 3, recordUid: 'record', recordOwnerUserId: 77,
  targetSource: { sourceRef: 'viewer-42-signed-chat', kind: 'group_chat' } } as ArkmeSearchRecordItem
beforeEach(() => call.mockReset())

describe('conversation search read boundary', () => {
  it('keeps keyword and category protocols distinct and forwards cancellation and scope', async () => {
    const signal = new AbortController().signal
    call.mockResolvedValue({ items: [] })
    await port.search({ kind: 'conversation', sourceRef: 'signed' }, { kind: 'keyword', text: '原文' }, 'cursor', signal)
    expect(call).toHaveBeenLastCalledWith('search.records', { sourceRef: 'signed', query: '原文', limit: 50, cursor: 'cursor' }, signal)
    await port.search({ kind: 'global' }, { kind: 'scene', scene: 'audio' }, undefined, signal)
    expect(call).toHaveBeenLastCalledWith('search.scene', { scene: 'audio', limit: 30 }, signal)
  })
  it('reads the exact chat anchor with its content owner and ignores neighboring messages', async () => {
    const signal = new AbortController().signal
    const target = { itemUid: 'record', textContent: '原文' }
    call.mockResolvedValue({ items: [{ itemUid: 'neighbor' }, target] })
    expect(await port.readChatMessage(hit, signal)).toBe(target)
    expect(call).toHaveBeenCalledExactlyOnceWith('source.timeline-around', {
      sourceRef: 'viewer-42-signed-chat', itemUid: 'record', recordOwnerUserId: 77, beforeLimit: 1, afterLimit: 1,
    }, signal)
  })
  it('rejects non-chat records and missing identity without falling back to asset or timeline scans', async () => {
    const signal = new AbortController().signal
    await expect(port.readChatMessage({ ...hit, sourceKind: 2 }, signal)).rejects.toThrow('仅聊天')
    const { recordOwnerUserId: _, ...missingOwner } = hit
    await expect(port.readChatMessage(missingOwner, signal)).rejects.toThrow('消息归属')
    expect(call).not.toHaveBeenCalled()
    call.mockResolvedValue({ items: [{ itemUid: 'neighbor' }] })
    await expect(port.readChatMessage(hit, signal)).rejects.toThrow('原消息已删除')
  })
  it('batches unique own assets and keeps optional thumbnail failure separate from search failure', async () => {
    const uids = Array.from({ length: 51 }, (_, index) => String(index))
    const signal = new AbortController().signal
    call.mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce([{ fileAssetUid: '50' }])
    const onBatch = vi.fn()
    await port.readOwnAssetDisplays([...uids, '50'], signal, onBatch)
    expect(onBatch).toHaveBeenCalledExactlyOnceWith([{ fileAssetUid: '50' }])
    expect(call.mock.calls.map(args => args[1].fileAssetUids.length)).toEqual([50, 1])
    expect(call.mock.calls.every(args => args[0] === 'files.assets' && args[2] === signal)).toBe(true)
  })
  it('stops subsequent asset batches when the caller cancels', async () => {
    const controller = new AbortController()
    call.mockImplementationOnce(async () => { controller.abort(); throw new Error('cancelled') })
    await expect(port.readOwnAssetDisplays(Array.from({ length: 51 }, (_, index) => String(index)), controller.signal, vi.fn())).rejects.toThrow('cancelled')
    expect(call).toHaveBeenCalledTimes(1)
  })
  it('publishes a successful batch before the next finishes and discards late cancelled batches', async () => {
    const controller = new AbortController()
    const onBatch = vi.fn()
    let finish!: (value: unknown) => void
    call.mockResolvedValueOnce([{ fileAssetUid: 'first' }])
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = port.readOwnAssetDisplays(Array.from({ length: 51 }, (_, index) => String(index)), controller.signal, onBatch)
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(2))
    expect(onBatch).toHaveBeenCalledExactlyOnceWith([{ fileAssetUid: 'first' }])
    controller.abort()
    finish([{ fileAssetUid: 'late' }])
    await rejected
    expect(onBatch).toHaveBeenCalledTimes(1)
  })

})

it('recovers missing received attachments through the signed message owner instead of private asset lookup', async () => {
 const signal = new AbortController().signal
 const target = { itemUid: 'record', recordOwnerUserId: 77, messageActionRef: 'signed-relation', contentBlocks: [] }
 const block = { kind: 'image', fileAssetUid: 'photo', mediaRef: 'authorized-grant' }
 call.mockResolvedValueOnce({ items: [target] }).mockResolvedValueOnce({ itemUid: 'record', contentBlocks: [block] })
 expect(await port.readChatMessage({ ...hit, media: [{ fileAssetUid: 'photo' }], files: [] }, signal)).toMatchObject({ ...target, contentBlocks: [block] })
 expect(call.mock.calls.map(([operation]) => operation)).toEqual(['source.timeline-around', 'source.message-snapshot.detail'])
 expect(call).toHaveBeenLastCalledWith('source.message-snapshot.detail', { sourceRef: hit.targetSource!.sourceRef, actionRef: 'signed-relation', includeAttachments: true }, signal)
})
it('recognizes an already authorized dynamic-photo motion without a redundant detail read', async () => {
 const target = { itemUid: 'record', contentBlocks: [{ kind: 'image', fileAssetUid: 'cover', mediaRef: 'cover-ref', dynamicPhoto: { logicalUid: 'pair', motion: { kind: 'video', fileAssetUid: 'motion', mediaRef: 'motion-ref' } } }] }
 call.mockResolvedValue({ items: [target] })
 expect(await port.readChatMessage({ ...hit, media: [{ fileAssetUid: 'motion' }], files: [] }, new AbortController().signal)).toBe(target)
 expect(call).toHaveBeenCalledOnce()
})
it('rejects mismatched owner or snapshot identity instead of previewing a neighboring attachment', async () => {
 const signal = new AbortController().signal
 call.mockResolvedValueOnce({ items: [{ itemUid: 'record', recordOwnerUserId: 88, contentBlocks: [] }] })
 await expect(port.readChatMessage(hit, signal)).rejects.toThrow('原消息')
 call.mockResolvedValueOnce({ items: [{ itemUid: 'record', recordOwnerUserId: 77, messageActionRef: 'signed', contentBlocks: [] }] })
  .mockResolvedValueOnce({ itemUid: 'other-record', contentBlocks: [{kind:'image',fileAssetUid:'photo',mediaRef:'wrong'}] })
 await expect(port.readChatMessage({ ...hit, media: [{fileAssetUid:'photo'}],files:[] }, signal)).rejects.toThrow('身份')
})
it('does not start attachment hydration after cancellation of the anchor read', async () => {
 const controller = new AbortController()
 call.mockImplementationOnce(async () => { controller.abort(); return {items:[{itemUid:'record',messageActionRef:'signed',contentBlocks:[]}]} })
 await expect(port.readChatMessage({...hit,media:[{fileAssetUid:'photo'}]},controller.signal)).rejects.toMatchObject({name:'AbortError'})
 expect(call).toHaveBeenCalledOnce()
})
it('keeps a rejected relation read retryable without trying another owner or attachment API', async () => {
 call.mockResolvedValueOnce({items:[{itemUid:'record',messageActionRef:'signed',contentBlocks:[]}]})
  .mockRejectedValueOnce(new Error('message-snapshot-detail-unavailable'))
 await expect(port.readChatMessage({...hit,media:[{fileAssetUid:'photo'}]},new AbortController().signal)).rejects.toThrow('message-snapshot-detail-unavailable')
 expect(call.mock.calls.map(([op])=>op)).toEqual(['source.timeline-around','source.message-snapshot.detail'])
})
it('does not identify a forward child by matching its filename to a source asset', async () => {
 const blocks=[{kind:'image',mediaRef:'forward-local-ref',fileName:'same.png'}]
 call.mockResolvedValueOnce({items:[{itemUid:'record',messageActionRef:'signed',contentBlocks:blocks}]})
  .mockResolvedValueOnce({itemUid:'record',contentBlocks:blocks})
 const value=await port.readChatMessage({...hit,media:[{fileAssetUid:'source-photo',fileName:'same.png'}]},new AbortController().signal)
 expect(value.contentBlocks).toEqual(blocks)
 expect(value.contentBlocks?.[0]).not.toHaveProperty('fileAssetUid')
})
