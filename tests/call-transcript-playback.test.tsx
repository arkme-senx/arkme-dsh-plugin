import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeCallDetailContent } from '../src/client/ArkmeCallDetailContent.js'
import { ArkmeCallDetailDrawer } from '../src/client/ArkmeCallDetailDrawer.js'
import { callArkme } from '../src/client/api.js'
import type { ArkmeCallDetail, ArkmeTimelineItem } from '../src/types.js'

vi.mock('../src/client/api.js', () => ({ callArkme: vi.fn() }))
class FakeAudio {
  static instances: FakeAudio[] = []
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  onplaying: (() => void) | null = null
  onwaiting: (() => void) | null = null
  resolve!: () => void
  reject!: (reason: Error) => void
  play = vi.fn(() => new Promise<void>((resolve, reject) => { this.resolve = resolve; this.reject = reject }))
  pause = vi.fn()
  load = vi.fn()
  removeAttribute = vi.fn()
  constructor(public src: string) { FakeAudio.instances.push(this) }
}
const detail: ArkmeCallDetail = {
  callRef: 'call', title: '通话详情', mediaType: 'video', startedAtMillis: 1000, acceptedAtMillis: 1000, endedAtMillis: 9000,
  durationSeconds: 8, callResult: 'NormalEnd', resultLabel: '已接通', summaryStatus: 'done', summaryText: '摘要保持不变',
  transcriptPending: false, transcriptFailed: false, participants: [], transcriptSegments: [
    { segmentId: 'a', speakerDisplayName: '鹏', text: '第一段', startMillis: 2000, endMillis: 3000, audioUrl: 'https://example.com/a.wav' },
    { segmentId: 'b', speakerDisplayName: '我', text: '第二段', startMillis: 4000, endMillis: 5000, audioUrl: 'https://example.com/b.wav' },
    { segmentId: 'c', speakerDisplayName: '我', text: '没有录音', startMillis: 6000, endMillis: 7000 },
  ], videoRecord: { available: true, source: 'real', perspectives: [{ perspective: 'peer', videoUrl: 'https://example.com/video.mp4' }] },
}
const selected = { callRef: 'call', peerDisplayName: '鹏', mediaType: 'video' as const, acceptedAtMillis: 1000, durationSeconds: 8 }
const item: ArkmeTimelineItem = { itemUid: 'note', senderName: '我', isMe: true, title: '', textContent: '', status: 1, sendAtMillis: 1000, callRecord: { callRef: 'call', mediaType: 'video', text: '视频通话' } }
let view: ReactTestRenderer
const clickSegment = (text: string) => view.root.findAllByType('button').find(button => String(button.props['aria-label']).endsWith(`录音片段：${text}`))!.props.onClick()
beforeEach(() => { FakeAudio.instances = []; vi.stubGlobal('Audio', FakeAudio); vi.mocked(callArkme).mockResolvedValue(detail) })
afterEach(() => { act(() => { view?.unmount() }); vi.unstubAllGlobals() })

describe('shared call transcript playback', () => {
  it.each(['pane', 'drawer'])('plays a whole utterance and toggles stop in the %s', async mode => {
    await act(async () => { view = create(mode === 'drawer' ? <ArkmeCallDetailDrawer item={item} onClose={() => {}} /> : <ArkmeCallDetailContent selectedItem={selected} detail={detail} detailState="ready" />) })
    expect(FakeAudio.instances).toHaveLength(0)
    act(() => { clickSegment('第一段') })
    const audio = FakeAudio.instances[0]!
    expect(audio.src).toBe('https://example.com/a.wav')
    expect('currentTime' in audio).toBe(false)
    expect(JSON.stringify(view.toJSON())).toContain('正在加载')
    await act(async () => { audio.resolve() })
    expect(JSON.stringify(view.toJSON())).toContain('正在播放')
    act(() => { clickSegment('第一段') })
    expect(audio.pause).toHaveBeenCalledOnce()
    expect(audio.removeAttribute).toHaveBeenCalledWith('src')
    expect(JSON.stringify(view.toJSON())).not.toContain('正在播放')
    expect(view.root.findAllByType('button').filter(button => String(button.props['aria-label']).includes('没有录音'))).toHaveLength(0)
  })

  it('ignores stale completion/failure while rapidly switching, and cleans up on end/unmount', async () => {
    await act(async () => { view = create(<ArkmeCallDetailContent selectedItem={selected} detail={detail} detailState="ready" />) })
    act(() => { clickSegment('第一段') })
    const old = FakeAudio.instances[0]!
    const oldEnd = old.onended!
    act(() => { clickSegment('第二段') })
    expect(old.pause).toHaveBeenCalledOnce()
    await act(async () => { old.reject(new Error('late')); oldEnd(); FakeAudio.instances[1]!.resolve() })
    expect(view.root.findByProps({ 'aria-label': '停止我的录音片段：第二段' }).props['aria-pressed']).toBe(true)
    act(() => { FakeAudio.instances[1]!.onended!() })
    expect(JSON.stringify(view.toJSON())).not.toContain('正在播放')
    act(() => { clickSegment('第一段'); view.unmount() })
    expect(FakeAudio.instances[2]!.pause).toHaveBeenCalledOnce()
    await act(async () => { FakeAudio.instances[2]!.resolve() })
  })

  it('allows retry after playback rejects or the media reports an error', async () => {
    await act(async () => { view = create(<ArkmeCallDetailContent selectedItem={selected} detail={detail} detailState="ready" />) })
    act(() => { clickSegment('第一段') })
    await act(async () => { FakeAudio.instances[0]!.reject(new Error('network')) })
    expect(JSON.stringify(view.toJSON())).toContain('播放失败，点击重试')
    act(() => { clickSegment('第一段') })
    await act(async () => { FakeAudio.instances[1]!.resolve() })
    act(() => { FakeAudio.instances[1]!.onerror!() })
    expect(JSON.stringify(view.toJSON())).toContain('播放失败，点击重试')
    expect(FakeAudio.instances[1]!.pause).toHaveBeenCalledOnce()
  })

  it('stops clips when switching calls', async () => {
    await act(async () => { view = create(<ArkmeCallDetailContent selectedItem={selected} detail={detail} detailState="ready" />) })
    act(() => { clickSegment('第一段') })
    await act(async () => { view.update(<ArkmeCallDetailContent selectedItem={{ ...selected, callRef: 'other' }} detail={{ ...detail, callRef: 'other' }} detailState="ready" />) })
    expect(FakeAudio.instances[0]!.pause).toHaveBeenCalledOnce()
    await act(async () => { FakeAudio.instances[0]!.resolve() })
    expect(JSON.stringify(view.toJSON())).not.toContain('正在播放')
  })

  it.each([false, true])('enforces video/audio exclusivity (standalone video: %s)', async standalone => {
    const video = { pause: vi.fn(), play: vi.fn(async () => {}), currentTime: 0 }
    const call = standalone ? { ...detail, videoRecord: { available: true, source: 'real' as const, videoUrl: 'https://example.com/video.mp4' } } : detail
    await act(async () => { view = create(<ArkmeCallDetailContent selectedItem={selected} detail={call} detailState="ready" />, { createNodeMock: node => node.type === 'video' ? video : null }) })
    if (!standalone) act(() => { view.root.findByProps({ 'aria-label': '播放视频记录' }).props.onClick() })
    act(() => { clickSegment('第一段') })
    expect(video.pause).toHaveBeenCalled()
    const audio = FakeAudio.instances[0]!
    await act(async () => { audio.resolve() })
    act(() => {
      if (standalone) view.root.findByType('video').props.onPlay()
      else view.root.findByProps({ 'aria-label': '继续播放视频记录' }).props.onClick()
    })
    expect(audio.pause).toHaveBeenCalledOnce()
    expect(JSON.stringify(view.toJSON())).not.toContain('■ 正在播放')
  })
})
