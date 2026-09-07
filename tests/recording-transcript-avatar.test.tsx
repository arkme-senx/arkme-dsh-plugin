import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeRecordingWorkbenchItem } from '../src/types.js'

const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', async original => ({
  ...await original<typeof import('../src/client/api.js')>(), callArkme: mocks.call,
}))
import { ArkmeRecordingTranscriptRow } from '../src/client/ArkmeRecordingSurface.js'
import { ArkmeRecordingTimeline } from '../src/client/recordings/ArkmeRecordingTimeline.js'
import { arkmeAvatarImages } from '../src/client/avatar-image-runtime.js'

const item: ArkmeRecordingWorkbenchItem = {
  itemId: 'self', itemRef: 'sealed-self', startAtMillis: 1_000, endAtMillis: 2_000,
  speakerNumber: 636, speakerKey: 'speaker:self', speakerColorIndex: 0,
  speakerLabel: 'HooXi', speakerAvatarRef: 'avatar-self', sameSpeakerItemCount: 88,
  isSelf: true, isBackground: false, text: '转写内容',
}
let renderer: ReactTestRenderer | undefined
beforeEach(() => {
  mocks.call.mockReset()
  arkmeAvatarImages.activateScope('recording-avatar-test')
})
afterEach(async () => {
  await act(async () => { renderer?.unmount() })
  renderer = undefined
  arkmeAvatarImages.activateScope(undefined)
})

describe('recording transcript avatar lifecycle', () => {
  it('shares one image request across 88 transcript rows and keeps their actions usable while loading', async () => {
    let resolve!: (payload: { mediaType: string; dataBase64: string }) => void
    mocks.call.mockReturnValue(new Promise(done => { resolve = done }))
    const edit = vi.fn()
    const play = vi.fn()
    await act(async () => {
      renderer = create(<>{Array.from({ length: 88 }, (_, index) => <ArkmeRecordingTranscriptRow
        key={index} item={{ ...item, itemId: String(index) }} selected={false}
        onEditSpeaker={edit} onSelect={play}
      />)}</>)
    })
    expect(mocks.call).toHaveBeenCalledTimes(1)
    expect(mocks.call).toHaveBeenCalledWith('image.read', { imageRef: 'avatar-self' })
    expect(renderer!.root.findAllByType('img')).toHaveLength(0)
    const stopPropagation = vi.fn()
    act(() => {
      renderer!.root.findAllByType('button')[0]!.props.onClick({ stopPropagation })
      renderer!.root.findAllByType('li')[0]!.props.onDoubleClick()
    })
    expect(stopPropagation).toHaveBeenCalledOnce()
    expect(edit).toHaveBeenCalledOnce()
    expect(play).toHaveBeenCalledOnce()
    await act(async () => { resolve({ mediaType: 'image/png', dataBase64: 'YXZhdGFy' }) })
    expect(renderer!.root.findAllByType('img')).toHaveLength(88)
    expect(mocks.call).toHaveBeenCalledTimes(1)
  })

  it.each([0, 1, 17])('matches the real timeline color for avatar and unlinked speakers at index %s', async colorIndex => {
    mocks.call.mockResolvedValue({ mediaType: 'image/png', dataBase64: 'YXZhdGFy' })
    for (const avatarRef of ['avatar-self', undefined]) {
      const speaker = { ...item, speakerColorIndex: colorIndex, speakerAvatarRef: avatarRef }
      await act(async () => {
        renderer = create(<>
          <ArkmeRecordingTranscriptRow item={speaker} selected={false} onEditSpeaker={() => {}} onSelect={() => {}} />
          <ArkmeRecordingTimeline items={[speaker]} dayStartMillis={0} isPlaying={false}
            onSelectAtMillis={() => {}} onTogglePlayback={() => {}} />
        </>)
      })
      const row = renderer!.root.findByType('li')
      const segment = renderer!.root.findByProps({ 'aria-label': 'HooXi，选择该片段' })
      const legend = renderer!.root.findByProps({ 'aria-label': '当前窗口说话人图例' })
      if (avatarRef !== undefined) {
        const rowName = row.findAllByType('span').find(node => node.children[0] === 'HooXi')!
        const legendName = legend.findAllByType('span').find(node => node.children[0] === 'HooXi')!
        expect(rowName.props.style.color).toBe(segment.props.style.background)
        expect(rowName.props.style.color).toBe(legendName.props.style.color)
      } else {
        const dot = row.findAllByType('span').find(node => node.props.style?.borderRadius === 999)!
        const legendDot = legend.findAllByType('span').find(node => node.props.style?.borderRadius === '50%')!
        expect(dot.props.style.background).toBe(segment.props.style.background)
        expect(dot.props.style.background).toBe(legendDot.props.style.background)
      }
      await act(async () => { renderer!.unmount() })
      renderer = undefined
    }
  })

  it('keeps avatar failure out of selection and speaker editing, and unsubscribes on exit', async () => {
    mocks.call.mockRejectedValue(new Error('image unavailable'))
    const edit = vi.fn()
    const select = vi.fn()
    await act(async () => {
      renderer = create(<ArkmeRecordingTranscriptRow item={item} selected={false}
        onEditSpeaker={edit} onSelect={vi.fn()} onToggleSelection={select}
        selectionControl={<input type="checkbox" aria-label="选择片段" />} />)
    })
    expect(renderer!.root.findAllByType('img')).toHaveLength(0)
    expect(renderer!.root.findByProps({ 'aria-label': 'HooXi头像' })).toBeDefined()
    const row = renderer!.root.findByType('li')
    expect(row.props.onDoubleClick).toBeUndefined()
    act(() => {
      row.props.onClick()
      renderer!.root.findByType('button').props.onClick({ stopPropagation() {} })
    })
    expect(select).toHaveBeenCalledOnce()
    expect(edit).toHaveBeenCalledOnce()
    await act(async () => { renderer!.unmount() })
    renderer = undefined
    await arkmeAvatarImages.revalidateActive()
    expect(mocks.call).toHaveBeenCalledTimes(1)
  })
})
