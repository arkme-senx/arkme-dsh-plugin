import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeRecordingWorkbenchItem } from '../src/types.js'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { ArkmeRecordingSpeakerCorrection, nearbyCorrectionItems } from '../src/client/recordings/ArkmeRecordingSpeakerCorrection.js'

const item = (index: number): ArkmeRecordingWorkbenchItem => ({ itemId: `item-${index}`, itemRef: `ref-${index}`, transcriptSource: 'system', sessionKey: 'session',
  speakerLabel: '周鹏', assignedSpeakerOptionKey: 'person', speakerKey: 'group', speakerColorIndex: 1, speakerNumber: 1, sameSpeakerItemCount: 3,
  text: `转写 ${index}`, startAtMillis: new Date(2026, 9, 14, 18, 46, index * 10).getTime(), endAtMillis: new Date(2026, 9, 14, 18, 46, index * 10 + 5).getTime(), isSelf: false, isBackground: false })
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const target = { label: '周鹏', speakerRef: 'person-ref', optionKey: 'person' }

describe('speaker correction interaction', () => {
  let renderer: ReactTestRenderer
  let supported: boolean
  const onUpdated = vi.fn(), onClose = vi.fn(), onPlay = vi.fn()
  beforeEach(() => {
    supported = true
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
    onUpdated.mockReset(); onClose.mockReset(); onPlay.mockReset()
    mocks.call.mockReset().mockImplementation(async op => {
      if (op === 'recordings.speaker.correction.context') return supported ? { supported: true, version: 'v1', maxItems: 100, soundSource: 'unknown', excludedSpeakers: [] } : { supported: false }
      if (op === 'recordings.speaker.correction.apply') return { affectedCount: 1, version: 'v2', undoRef: 'undo', day: { dateStamp: 1, transcript: { items: [item(0), item(1), item(2)] } } }
      if (op === 'recordings.speaker.correction.undo') return { affectedCount: 1, version: 'v3', day: { dateStamp: 1, transcript: { items: [item(0), item(1), item(2)] } } }
      return []
    })
  })
  afterEach(async () => { await act(async () => { renderer?.unmount(); await tick() }) })
  const mount = async (intent: 'reject' | 'source' | 'review' = 'reject', autoReject = false) => {
    await act(async () => { renderer = create(<ArkmeRecordingSpeakerCorrection item={item(1)} items={[item(0), item(1), item(2)]} target={target} rejectCurrent={false} intent={intent} autoReject={autoReject} onUpdated={onUpdated} onClose={onClose} onPlay={onPlay} />); await tick() })
  }
  const button = (text: string) => renderer.root.findAllByType('button').find(node => node.children.join('') === text)!
  const click = async (text: string) => { await act(async () => { button(text).props.onClick(); await tick() }) }
  const writes = () => mocks.call.mock.calls.filter(([op]) => /correction\.(apply|undo)$/.test(op))

  it('shows an honest unavailable preview without any writes, even with a reject intent', async () => {
    supported = false; await mount('reject', true)
    expect(button('保存纠错').props.disabled).toBe(true)
    expect(renderer.root.findByProps({ role: 'status' }).children.join('')).toContain('尚未保存')
    await click('手机 / 电视播放'); await click('核对附近片段')
    expect(renderer.root.findAllByType('input').filter(node => node.props.type === 'checkbox' && node.props.checked)).toHaveLength(3)
    expect(writes()).toHaveLength(0)
    expect(onUpdated).not.toHaveBeenCalled()
  })

  it('one-click rejection saves exactly the clicked fragment and offers undo', async () => {
    await mount('reject', true)
    expect(writes()).toHaveLength(1)
    expect(writes()[0]![1]).toMatchObject({ itemRef: 'ref-1', itemRefs: ['ref-1'], rejectedSpeakerRef: 'person-ref', detach: true })
    expect(writes()[0]![1]).not.toHaveProperty('soundSource')
    expect(button('撤销这次纠错')).toBeDefined()
    expect(onUpdated).toHaveBeenCalledOnce()
    await click('撤销这次纠错')
    expect(writes()).toHaveLength(2)
    expect(writes()[1]![1]).toMatchObject({ undoRef: 'undo', itemRef: 'ref-1' })
    expect(button('撤销这次纠错')).toBeUndefined()
  })

  it('keeps source-only edits separate, and submits only explicitly checked nearby rows', async () => {
    await mount('source')
    await click('手机 / 电视播放'); await click('核对附近片段')
    const inputs = renderer.root.findAllByType('input').filter(node => String(node.props['aria-label']).startsWith('选择 '))
    expect(inputs.map(node => node.props.checked)).toEqual([false, true, false])
    await act(async () => { inputs[0]!.props.onChange({ target: { checked: true } }); await tick() })
    const listen = renderer.root.findAllByType('button').find(node => String(node.props['aria-label']).startsWith('试听 '))!
    await act(async () => { listen.props.onClick(); await tick() })
    expect(onPlay).toHaveBeenCalledWith(item(0))
    await click('保存纠错')
    expect(writes()[0]![1]).toMatchObject({ itemRefs: ['ref-0', 'ref-1'], soundSource: 'playback', detach: false })
    expect(writes()[0]![1]).not.toHaveProperty('rejectedSpeakerRef')
  })

  it('does not repeat or claim success after an uncertain write', async () => {
    const original = mocks.call.getMockImplementation()!
    mocks.call.mockImplementation((op, ...args) => op === 'recordings.speaker.correction.apply' ? Promise.reject(new Error('连接中断')) : original(op, ...args))
    await mount(); await click('保存纠错')
    expect(button('保存纠错').props.disabled).toBe(true)
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('连接中断')
    expect(writes()).toHaveLength(1)
    expect(onUpdated).not.toHaveBeenCalled()
  })

  it('ignores an in-flight response after account switch', async () => {
    let resolve!: (value: unknown) => void
    const original = mocks.call.getMockImplementation()!
    mocks.call.mockImplementation((op, ...args) => op === 'recordings.speaker.correction.apply' ? new Promise(done => { resolve = done }) : original(op, ...args))
    await mount(); await click('保存纠错')
    await act(async () => { arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 43 }); resolve({ affectedCount: 1, version: 'v2', day: { transcript: { items: [] } } }); await tick() })
    expect(onClose).toHaveBeenCalledOnce(); expect(onUpdated).not.toHaveBeenCalled()
  })
})

it('bounds manual review by time, source and count without merging equal labels', () => {
  const anchor = item(1), far = { ...item(3), startAtMillis: anchor.startAtMillis + 601000 }
  expect(nearbyCorrectionItems([item(0), anchor, far, { ...item(2), transcriptSource: 'doubao' }], anchor).map(row => row.itemId)).toEqual(['item-0', 'item-1'])
  expect(nearbyCorrectionItems(Array.from({ length: 200 }, (_, i) => ({ ...anchor, itemId: `id-${i}` })), anchor)).toHaveLength(100)
})
