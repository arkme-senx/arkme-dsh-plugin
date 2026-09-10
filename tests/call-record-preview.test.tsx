import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeCallRecordContent } from '../src/client/ArkmeCallRecordContent.js'
import { ArkmeCallDetailDrawer } from '../src/client/ArkmeCallDetailDrawer.js'
import { ArkmeMessageContent } from '../src/client/ArkmeRichContent.js'
import { callArkme } from '../src/client/api.js'
import { callVideoPerspectiveLabel } from '../src/client/call-detail-presentation.js'
import type { ArkmeCallDetail, ArkmeTimelineItem } from '../src/types.js'

vi.mock('../src/client/api.js', () => ({ callArkme: vi.fn() }))
const detail: ArkmeCallDetail = {
  callRef: 'sealed-call', title: '通话详情', mediaType: 'video', startedAtMillis: 1, acceptedAtMillis: 1, endedAtMillis: 65001,
  durationSeconds: 65, callResult: 'NormalEnd', resultLabel: '已接通', summaryStatus: 'done', summaryText: '确认周五上线',
  transcriptPending: false, transcriptFailed: false, transcriptSegments: [], participants: [],
  videoRecord: { available: true, source: 'real', perspectives: [
    { perspective: 'peer', videoUrl: 'https://example.com/peer.mp4', posterUrl: 'https://example.com/peer.jpg' },
    { perspective: 'self', videoUrl: 'https://example.com/self.mp4', posterUrl: 'https://example.com/self.jpg' },
  ] },
}
const call = { callRef: 'sealed-call', mediaType: 'video' as const, text: '视频通话 01:05' }
let view: ReactTestRenderer | undefined
beforeEach(() => { vi.mocked(callArkme).mockReset() })
afterEach(() => { act(() => { view?.unmount() }); view = undefined; vi.unstubAllGlobals() })

describe('call quick note previews', () => {
  it('resolves omitted peer flags and video owners without using the page title', () => {
    const participants = [{ userId: 1, displayName: '我', isCurrentUser: true }, { userId: 2, displayName: '鹏' }]
    expect(callVideoPerspectiveLabel({ perspective: 'peer' }, participants, '通话详情')).toBe('鹏的视角')
    expect(callVideoPerspectiveLabel({ perspective: 'peer', userId: 1 }, participants)).toBe('我的视角')
    expect(callVideoPerspectiveLabel({ perspective: 'peer' }, [], '通话详情')).toBe('对方视角')
    expect(callVideoPerspectiveLabel({ perspective: 'peer', userId: 2, label: '旧名称' }, participants)).toBe('鹏的视角')
    expect(callVideoPerspectiveLabel({ perspective: 'self', label: '你的视角' }, participants)).toBe('我的视角')
  })

  it('renders the peer label with the real service shape and has no participant footer', async () => {
    vi.mocked(callArkme).mockResolvedValue({ ...detail, participants: [{ userId: 1, displayName: '我', isCurrentUser: true }, { userId: 2, displayName: '鹏' }] })
    const item: ArkmeTimelineItem = { itemUid: 'message', isMe: true, senderName: '我', sendAtMillis: 1, title: '', textContent: '', status: 1, callRecord: call }
    await act(async () => { view = create(<ArkmeCallDetailDrawer item={item} onClose={() => {}} />) })
    expect(view!.root.findByProps({ alt: '鹏的视角视频通话记录画面' })).toBeTruthy()
    expect(JSON.stringify(view!.toJSON())).not.toContain('通话详情的视角')
    expect(view!.root.findAllByType('footer')).toHaveLength(0)
    expect(view!.root.findAllByProps({ 'aria-label': '收起参与者' })).toHaveLength(0)
  })

  it('loads summary and both perspectives, then opens the exact selected perspective', async () => {
    vi.mocked(callArkme).mockResolvedValue(detail)
    const open = vi.fn()
    const item: ArkmeTimelineItem = { itemUid: 'message', isMe: true, senderName: '我', sendAtMillis: 1, title: '', textContent: '', status: 1, callRecord: call }
    await act(async () => { view = create(<ArkmeMessageContent item={item} onCallDetailOpen={open} />) })
    expect(JSON.stringify(view!.toJSON())).toContain('确认周五上线')
    expect(view!.root.findByProps({ 'data-arkme-call-summary': 'preview' }).props.style.WebkitLineClamp).toBe(3)
    expect(view!.root.findAllByType('img')).toHaveLength(2)
    expect(view!.root.findAllByType('video')).toHaveLength(0)
    const stopPropagation = vi.fn()
    act(() => { view!.root.findByProps({ 'aria-label': '查看我的视角通话详情' }).props.onClick({ stopPropagation }) })
    expect(open).toHaveBeenCalledExactlyOnceWith('https://example.com/self.mp4')
    expect(stopPropagation).toHaveBeenCalledOnce()
  })

  it('uses metadata-only video fallback after a poster fails, and a placeholder after video fails', async () => {
    vi.mocked(callArkme).mockResolvedValue(detail)
    await act(async () => { view = create(<ArkmeCallRecordContent call={call} />) })
    act(() => { view!.root.findAllByType('img')[0]!.props.onError() })
    const video = view!.root.findByType('video')
    expect(video.props).toMatchObject({ muted: true, preload: 'metadata' })
    expect(video.props.autoPlay).toBeUndefined()
    act(() => { video.props.onError() })
    expect(JSON.stringify(view!.toJSON())).toContain('预览暂不可用')
  })

  it('defers offscreen records until visible and disconnects/aborts on unmount', async () => {
    let notify: (entries: Array<{ isIntersecting: boolean }>) => void = () => {}
    const disconnect = vi.fn()
    const observe = vi.fn()
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: typeof notify) { notify = callback }
      observe = observe
      disconnect = disconnect
    })
    vi.mocked(callArkme).mockResolvedValue(detail)
    await act(async () => { view = create(<ArkmeCallRecordContent call={call} />, { createNodeMock: () => ({}) }) })
    expect(observe).toHaveBeenCalledOnce()
    expect(callArkme).not.toHaveBeenCalled()
    await act(async () => { notify([{ isIntersecting: true }]) })
    expect(callArkme).toHaveBeenCalledOnce()
    const signal = vi.mocked(callArkme).mock.calls[0]![2] as AbortSignal
    act(() => { view!.unmount(); view = undefined })
    expect(disconnect).toHaveBeenCalled()
    expect(signal.aborted).toBe(true)
  })

  it('ignores stale results when the message changes and refreshes on revision changes', async () => {
    let resolveOld: (value: ArkmeCallDetail) => void = () => {}
    vi.mocked(callArkme).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve as typeof resolveOld }))
      .mockResolvedValue({ ...detail, callRef: 'second', summaryText: '新的通话' })
    await act(async () => { view = create(<ArkmeCallRecordContent call={call} revision={1} />) })
    const signal = vi.mocked(callArkme).mock.calls[0]![2] as AbortSignal
    await act(async () => { view!.update(<ArkmeCallRecordContent call={{ ...call, callRef: 'second' }} revision={1} />) })
    expect(signal.aborted).toBe(true)
    await act(async () => { resolveOld(detail) })
    expect(JSON.stringify(view!.toJSON())).toContain('新的通话')
    expect(JSON.stringify(view!.toJSON())).not.toContain('确认周五上线')
    await act(async () => { view!.update(<ArkmeCallRecordContent call={{ ...call, callRef: 'second' }} revision={2} />) })
    expect(callArkme).toHaveBeenCalledTimes(3)
  })

  it('preserves the local summary on network failure, and hides video for audio calls', async () => {
    vi.mocked(callArkme).mockRejectedValue(new Error('network'))
    await act(async () => { view = create(<ArkmeCallRecordContent call={{ ...call, summaryText: '已有摘要' }} />) })
    expect(JSON.stringify(view!.toJSON())).toContain('已有摘要')
    vi.mocked(callArkme).mockResolvedValue(detail)
    await act(async () => { view!.update(<ArkmeCallRecordContent call={{ ...call, mediaType: 'audio' }} revision={2} />) })
    expect(view!.root.findAllByProps({ 'aria-label': '通话视频预览' })).toHaveLength(0)
  })

  it('keeps pending/failed summaries distinct and never requests missing references', async () => {
    await act(async () => { view = create(<ArkmeCallRecordContent call={{ mediaType: 'audio', text: '语音通话', summaryStatus: 'pending' }} />) })
    expect(callArkme).not.toHaveBeenCalled()
    expect(JSON.stringify(view!.toJSON())).toContain('摘要生成中')
    await act(async () => { view!.update(<ArkmeCallRecordContent call={{ mediaType: 'audio', text: '语音通话', summaryStatus: 'failed' }} />) })
    expect(JSON.stringify(view!.toJSON())).toContain('摘要生成失败')
  })

  it('opens the selected preview as the drawer main perspective without autoplay', async () => {
    vi.mocked(callArkme).mockResolvedValue(detail)
    const item: ArkmeTimelineItem = { itemUid: 'message', isMe: true, senderName: '我', sendAtMillis: 1, title: '', textContent: '', status: 1, callRecord: call }
    await act(async () => { view = create(<ArkmeCallDetailDrawer item={item} initialVideoUrl="https://example.com/self.mp4" onClose={() => {}} />) })
    expect(view!.root.findByProps({ alt: '我的视角视频通话记录画面' }).props.src).toBe('https://example.com/self.jpg')
    expect(view!.root.findAllByProps({ 'aria-label': '视频播放控制' })).toHaveLength(0)
  })
})
