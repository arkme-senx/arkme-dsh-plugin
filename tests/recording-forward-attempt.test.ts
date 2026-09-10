import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeRecordingWorkbenchItem, ArkmeSourceItem } from '../src/types.js'
import type { RecordingForwardReceipt } from '../src/recording-forward-contract.js'
import { RecordingForwardAttempt, type RecordingForwardSender } from '../src/client/recordings/recording-forward-attempt.js'

const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
import { recordingForwardClient } from '../src/client/recordings/recording-forward-client.js'

const item: ArkmeRecordingWorkbenchItem = {
  itemId: 'display-id', itemRef: 'authorized-item', sessionKey: 'audio-session', transcriptSource: 'system',
  startAtMillis: 1_000, endAtMillis: 5_000, speakerNumber: 0, speakerKey: 'speaker', speakerColorIndex: 0,
  speakerLabel: '说话人 0', sameSpeakerItemCount: 1, isSelf: false, isBackground: false, text: '转写',
}
const target = (key: string): ArkmeSourceItem => ({ sourceKey: key, sourceRef: `ref-${key}`, displayName: key, kind: 'private_chat', activeAtMillis: 0, unreadCount: 0 })
const signal = () => new AbortController().signal

beforeEach(() => { vi.useFakeTimers(); mocks.call.mockReset() })
afterEach(() => { vi.useRealTimers() })

describe('recording forward business', () => {
  it('keeps distinct owner IDs, the original comment and only retries unconfirmed destinations', async () => {
    const forward = vi.fn<RecordingForwardSender['forward']>()
      .mockResolvedValueOnce({ recordUid: 'a', warningText: '录音已转发，附言发送失败' })
      .mockRejectedValueOnce(new Error('响应超时'))
      .mockResolvedValueOnce({ recordUid: 'b' })
    const attempt = new RecordingForwardAttempt([item], { forward })
    const result = vi.fn()
    expect(await attempt.send([target('a'), target('b')], ' 原附言 ', signal(), result)).toBeUndefined()
    const first = forward.mock.calls[1]![0]
    const rotated = { ...target('b'), sourceRef: 'new-capability', displayName: '新名称' }
    expect(await attempt.send([target('a'), rotated], '新的文字', signal(), result)).toBe('录音已转发，附言发送失败')
    expect(forward).toHaveBeenCalledTimes(3)
    expect(forward.mock.calls[2]![0]).toEqual({ ...first, targetSourceRef: 'new-capability' })
    expect(first.itemRefs).toEqual(['authorized-item'])
    expect(new Set([first.requestId, first.recordUid, first.commentRecordUid]).size).toBe(3)
    expect(first.commentText).toBe('原附言')
    expect(attempt.hasSent('a')).toBe(true)
    expect(attempt.hasSent('b')).toBe(true)
    expect(result.mock.calls).toEqual([['a', '录音已转发，附言发送失败'], ['b', '响应超时'], ['b', '已转发']])
  })

  it('retains a confirmed late receipt after close, without notifying the closed view or sending remaining targets', async () => {
    let resolve!: (receipt: RecordingForwardReceipt) => void
    const forward = vi.fn<RecordingForwardSender['forward']>().mockImplementationOnce(async () => await new Promise(done => { resolve = done }))
    const attempt = new RecordingForwardAttempt([item], { forward })
    const controller = new AbortController()
    const result = vi.fn()
    const pending = attempt.send([target('a'), target('b')], '', controller.signal, result)
    controller.abort()
    resolve({ recordUid: 'confirmed' })
    expect(await pending).toBeUndefined()
    expect(attempt.hasSent('a')).toBe(true)
    expect(attempt.hasSent('b')).toBe(false)
    expect(result).not.toHaveBeenCalled()
    expect(await attempt.send([target('a')], '', signal(), result)).toBe('转发成功')
    expect(forward).toHaveBeenCalledTimes(1)
  })

  it('preserves retry identity when close cancels an unconfirmed request', async () => {
    const controller = new AbortController()
    const forward = vi.fn<RecordingForwardSender['forward']>().mockImplementationOnce(async () => {
      controller.abort()
      throw new Error('cancelled')
    }).mockResolvedValue({ recordUid: 'confirmed' })
    const attempt = new RecordingForwardAttempt([item], { forward })
    const result = vi.fn()
    expect(await attempt.send([target('a'), target('b')], '', controller.signal, result)).toBeUndefined()
    expect(result).not.toHaveBeenCalled()
    expect(attempt.hasSent('a')).toBe(false)
    await attempt.send([target('a')], '不能替换原始空附言', signal(), result)
    expect(forward).toHaveBeenCalledTimes(2)
    expect(forward.mock.calls[1]![0]).toEqual(forward.mock.calls[0]![0])
    expect(forward.mock.calls[1]![0]).not.toHaveProperty('commentRecordUid')
    expect(attempt.commentText).toBe('')
  })

  it('keeps different selections independent and does not freeze an empty or cancelled operation', async () => {
    const forward = vi.fn<RecordingForwardSender['forward']>().mockResolvedValue({ recordUid: 'confirmed' })
    const attempt = new RecordingForwardAttempt([item], { forward })
    expect(await attempt.send([], '不应冻结', signal(), vi.fn())).toBeUndefined()
    const controller = new AbortController(); controller.abort()
    expect(await attempt.send([target('a')], '不应冻结', controller.signal, vi.fn())).toBeUndefined()
    expect(attempt.commentText).toBeUndefined()
    expect(forward).not.toHaveBeenCalled()
    await attempt.send([target('a')], '', signal(), vi.fn())
    const another = new RecordingForwardAttempt([{ ...item, itemRef: 'other-item' }], { forward })
    await another.send([target('a')], '', signal(), vi.fn())
    expect(forward.mock.calls[1]![0].recordUid).not.toBe(forward.mock.calls[0]![0].recordUid)
    expect(forward.mock.calls[1]![0].itemRefs).toEqual(['other-item'])
  })
})

describe('recording forward client boundary', () => {
  const input = { itemRefs: ['item'], targetSourceRef: 'target', requestId: 'request', recordUid: 'record', sendAtMillis: 1 }

  it.each([undefined, null, {}, { recordUid: '' }, { recordUid: ' ' }])('rejects an unconfirmed owner response: %j', async receipt => {
    mocks.call.mockResolvedValue(receipt)
    await expect(recordingForwardClient.forward(input, signal())).rejects.toThrow('转发结果未确认')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('times out one destination and leaves the overall operation usable', async () => {
    const controller = new AbortController()
    mocks.call.mockImplementationOnce(async (_operation, _input, requestSignal: AbortSignal) => await new Promise((_, reject) => {
      requestSignal.addEventListener('abort', () => { reject(new Error('timeout')) }, { once: true })
    })).mockResolvedValue({ recordUid: 'confirmed' })
    const result = expect(recordingForwardClient.forward(input, controller.signal)).rejects.toThrow('timeout')
    await vi.advanceTimersByTimeAsync(30_000)
    await result
    expect(controller.signal.aborted).toBe(false)
    await expect(recordingForwardClient.forward(input, controller.signal)).resolves.toEqual({ recordUid: 'confirmed' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('propagates cancellation, removes its listener, and never dispatches a pre-cancelled request', async () => {
    const controller = new AbortController()
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener')
    mocks.call.mockImplementation(async (_operation, _input, requestSignal: AbortSignal) => await new Promise((_, reject) => {
      requestSignal.addEventListener('abort', () => { reject(new Error('cancelled')) }, { once: true })
    }))
    const result = expect(recordingForwardClient.forward(input, controller.signal)).rejects.toThrow('cancelled')
    controller.abort()
    await result
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
    await expect(recordingForwardClient.forward(input, controller.signal)).rejects.toThrow()
    expect(mocks.call).toHaveBeenCalledTimes(1)
  })
})
