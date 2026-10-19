import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeCallRecordContent } from '../src/client/ArkmeCallRecordContent.js'
import { ArkmeCallDetailDrawer } from '../src/client/ArkmeCallDetailDrawer.js'
import { ArkmeMessageContent } from '../src/client/ArkmeRichContent.js'
import { callArkme } from '../src/client/api.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
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
beforeEach(() => {
  vi.mocked(callArkme).mockReset()
  arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'prod' })
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'prod', userId: 42 })
})
afterEach(() => { act(() => { view?.unmount() }); view = undefined; vi.unstubAllGlobals(); vi.useRealTimers() })

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

  it.each([true, false])('omits visible perspective captions and their row spacing (interactive: %s)', async interactive => {
    vi.mocked(callArkme).mockResolvedValue(detail)
    const open = vi.fn()
    await act(async () => { view = create(<ArkmeCallRecordContent call={call} {...(interactive ? { onOpenDetail: open } : {})} />) })
    const previews = view!.root.findByProps({ 'aria-label': '通话视频预览' })
    expect(previews.findAll(node => node.type === 'span' && node.props.role !== 'status' && node.children.some(child => typeof child === 'string'))).toHaveLength(0)
    const frames = previews.findAll(node => node.type === 'span' && node.props.style?.aspectRatio === '9 / 16')
    expect(frames).toHaveLength(2)
    for (const frame of frames) {
      const wrapper = interactive ? frame.parent!.parent! : frame.parent!
      expect(frame.props.style).toMatchObject({ aspectRatio: '9 / 16' })
      expect(wrapper.props.style).toMatchObject({ display: 'block', width: 64 })
      expect(wrapper.props.style.gap).toBeUndefined()
      expect(wrapper.children).toHaveLength(1)
    }
    expect(previews.findByProps({ alt: '我的视角' })).toBeDefined()
    expect(previews.findByProps({ alt: '对方视角' })).toBeDefined()
    if (interactive) {
      act(() => { previews.findByProps({ 'aria-label': '查看对方视角通话详情' }).props.onClick({ stopPropagation() {} }) })
      expect(open).toHaveBeenCalledWith('https://example.com/peer.mp4')
    }
  })

  it('uses metadata-only video fallback after a poster fails, and a placeholder after video fails', async () => {
    vi.mocked(callArkme).mockResolvedValue(detail)
    await act(async () => { view = create(<ArkmeCallRecordContent call={call} />) })
    act(() => { view!.root.findAllByType('img')[0]!.props.onError() })
    const video = view!.root.findByType('video')
    expect(video.props).toMatchObject({ muted: true, preload: 'metadata' })
    expect(video.props.autoPlay).toBeUndefined()
    expect(video.parent!.findAllByProps({ role: 'status' })).toHaveLength(1)
    act(() => { video.props.onLoadedData() })
    expect(video.parent!.findAllByProps({ role: 'status' })).toHaveLength(0)
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
    expect(view!.root.findByType('button').children).toContain('预览未加载 · 重试')
    vi.mocked(callArkme).mockResolvedValue(detail)
    await act(async () => { view!.update(<ArkmeCallRecordContent call={{ ...call, mediaType: 'audio' }} revision={2} />) })
    expect(view!.root.findAllByProps({ 'aria-label': '通话视频预览' })).toHaveLength(0)
  })

  it('retains both previews across rotating call references and background revision refreshes', async () => {
    let resolveRefresh!: (value: ArkmeCallDetail) => void
    vi.mocked(callArkme).mockResolvedValueOnce(detail).mockImplementationOnce(() => new Promise(resolve => { resolveRefresh = resolve as typeof resolveRefresh }))
    const stable = { ...call, stableId: 'stable-call' }
    await act(async () => { view = create(<ArkmeCallRecordContent call={stable} revision={1} />) })
    await act(async () => { view!.update(<ArkmeCallRecordContent call={{ ...stable, callRef: 'rotated' }} revision={1} />) })
    expect(callArkme).toHaveBeenCalledTimes(1)
    expect(view!.root.findAllByType('img')).toHaveLength(2)
    await act(async () => { view!.update(<ArkmeCallRecordContent call={{ ...stable, callRef: 'rotated' }} revision={2} />) })
    expect(vi.mocked(callArkme).mock.calls[1]![1]).toEqual({ callRef: 'rotated' })
    expect(view!.root.findAllByType('img')).toHaveLength(2)
    await act(async () => { resolveRefresh({ ...detail, summaryText: '更新后的摘要' }) })
    expect(JSON.stringify(view!.toJSON())).toContain('更新后的摘要')
  })

  it('reuses recent previews when returning to a conversation but clears them on account changes', async () => {
    vi.mocked(callArkme).mockResolvedValue(detail)
    const stable = { ...call, stableId: 'stable-call' }
    await act(async () => { view = create(<ArkmeCallRecordContent call={stable} />) })
    act(() => { view!.unmount() })
    await act(async () => { view = create(<ArkmeCallRecordContent call={{ ...stable, callRef: 'rotated' }} />) })
    expect(callArkme).toHaveBeenCalledTimes(1)
    expect(view!.root.findAllByType('img')).toHaveLength(2)
    vi.mocked(callArkme).mockImplementation(() => new Promise(() => {}))
    await act(async () => { arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'prod', userId: 77 }) })
    expect(view!.root.findAllByType('img')).toHaveLength(0)
    act(() => { arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'prod', userId: 42 }) })
    expect(view!.root.findAllByType('img')).toHaveLength(0)
  })

  it('bounds automatic retries, preserves old media, and lets a manual retry use the latest reference', async () => {
    vi.useFakeTimers()
    vi.mocked(callArkme).mockResolvedValueOnce(detail).mockRejectedValue(new Error('temporary network failure'))
    const stable = { ...call, stableId: 'stable-call' }
    await act(async () => { view = create(<ArkmeCallRecordContent call={stable} revision={1} />) })
    await act(async () => { view!.update(<ArkmeCallRecordContent call={stable} revision={2} />) })
    expect(view!.root.findAllByType('img')).toHaveLength(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(5500) })
    expect(callArkme).toHaveBeenCalledTimes(4) // initial success + three attempts
    await act(async () => { await vi.advanceTimersByTimeAsync(60000) })
    expect(callArkme).toHaveBeenCalledTimes(4)
    await act(async () => { view!.update(<ArkmeCallRecordContent call={{ ...stable, callRef: 'fresh-reference' }} revision={2} />) })
    vi.mocked(callArkme).mockResolvedValue(detail)
    await act(async () => { view!.root.findByType('button').props.onClick({ stopPropagation() {} }) })
    expect(vi.mocked(callArkme).mock.lastCall?.[1]).toEqual({ callRef: 'fresh-reference' })
    expect(JSON.stringify(view!.toJSON())).not.toContain('预览未加载')
  })

  it('removes cached media when the server confirms it is unavailable or access is denied', async () => {
    vi.mocked(callArkme).mockResolvedValueOnce(detail).mockResolvedValueOnce({ ...detail, videoRecord: { available: false, source: 'real' } })
    const stable = { ...call, stableId: 'stable-call' }
    await act(async () => { view = create(<ArkmeCallRecordContent call={stable} revision={1} />) })
    await act(async () => { view!.update(<ArkmeCallRecordContent call={stable} revision={2} />) })
    expect(view!.root.findAllByType('img')).toHaveLength(0)
    vi.mocked(callArkme).mockResolvedValueOnce(detail)
    await act(async () => { view!.update(<ArkmeCallRecordContent call={stable} revision={3} />) })
    vi.mocked(callArkme).mockRejectedValueOnce({ body: { code: 'forbidden', retryable: false } })
    await act(async () => { view!.update(<ArkmeCallRecordContent call={stable} revision={4} />) })
    expect(view!.root.findAllByType('img')).toHaveLength(0)
  })

  it('does not keep exposing a preview after its access reference is removed or the account logs out', async () => {
    vi.mocked(callArkme).mockResolvedValue(detail)
    const stable = { ...call, stableId: 'stable-call' }
    await act(async () => { view = create(<ArkmeCallRecordContent call={stable} />) })
    expect(view!.root.findAllByType('img')).toHaveLength(2)
    await act(async () => { view!.update(<ArkmeCallRecordContent call={{ stableId: stable.stableId, mediaType: 'video', text: call.text }} />) })
    expect(view!.root.findAllByType('img')).toHaveLength(0)
    await act(async () => { view!.update(<ArkmeCallRecordContent call={stable} />) })
    expect(view!.root.findAllByType('img')).toHaveLength(2)
    await act(async () => { arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'prod' }) })
    expect(view!.root.findAllByType('img')).toHaveLength(0)
    expect(callArkme).toHaveBeenCalledTimes(1)
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
