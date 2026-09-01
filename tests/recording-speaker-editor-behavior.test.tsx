import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.callArkme }))

import { ArkmeRecordingSpeakerEditor } from '../src/client/recordings/ArkmeRecordingSpeakerEditor.js'

const tick = async () => { await Promise.resolve(); await Promise.resolve() }

describe('recording speaker editor failure recovery', () => {
  let renderer: ReactTestRenderer

  beforeEach(() => {
    mocks.callArkme.mockReset()
    vi.stubGlobal('document', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
  })
  afterEach(async () => {
    await act(async () => { renderer?.unmount(); await tick() })
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('fails closed when candidate loading fails and allows an explicit retry', async () => {
    mocks.callArkme.mockRejectedValueOnce(new Error('候选不可用')).mockResolvedValueOnce([])
    await act(async () => {
      renderer = create(<ArkmeRecordingSpeakerEditor item={{
        itemId: 'item-1', itemRef: 'sealed-item', speakerLabel: '说话人 1', speakerColorIndex: 1,
        speakerNumber: 1, speakerKey: 'speaker-opaque', sameSpeakerItemCount: 3,
        text: '内容', startAtMillis: 1_000, endAtMillis: 2_000, isBackground: false, isSelf: false,
      }} onUpdated={() => {}} onClose={() => {}} />)
      await tick()
    })

    const input = renderer.root.findByProps({ 'aria-label': '说话人名称' })
    await act(async () => { input.props.onChange({ target: { value: '新说话人' } }); await tick() })
    const add = renderer.root.findByProps({ 'aria-label': '添加新说话人' })
    expect(add.props.disabled).toBe(true)
    expect(renderer.root.findByProps({ 'aria-label': '重试读取说话人候选' })).toBeDefined()
    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'recordings.speaker.assign-item'))
      .toHaveLength(0)

    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '重试读取说话人候选' }).props.onClick()
      await tick()
    })

    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'recordings.speaker.options'))
      .toHaveLength(2)
    expect(renderer.root.findAllByProps({ 'aria-label': '重试读取说话人候选' })).toHaveLength(0)
  })

  it('does not create a duplicate speaker when the typed name already belongs to a candidate', async () => {
    mocks.callArkme.mockResolvedValueOnce([{
      speakerRef: 'speaker-existing', label: '已有说话人', kind: 'speaker',
      currentAssignment: false, isCurrentUser: false, recommended: false,
    }])
    await act(async () => {
      renderer = create(<ArkmeRecordingSpeakerEditor item={{
        itemId: 'item-1', itemRef: 'sealed-item', speakerLabel: '说话人 1', speakerColorIndex: 1,
        speakerNumber: 1, speakerKey: 'speaker-opaque', sameSpeakerItemCount: 3,
        text: '内容', startAtMillis: 1_000, endAtMillis: 2_000, isBackground: false, isSelf: false,
      }} onUpdated={() => {}} onClose={() => {}} />)
      await tick()
    })

    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '说话人名称' }).props.onChange({ target: { value: '已有说话人' } })
      await tick()
    })
    const confirm = renderer.root.findAllByType('button').find(button => button.children.join('') === '确认')
    expect(confirm?.props.disabled).toBe(true)
    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'recordings.speaker.assign-item'))
      .toHaveLength(0)
  })
})
