import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { ArkmeCallDetailDrawer, callDetailDuration } from '../src/client/ArkmeCallDetailDrawer.js'
import { callArkme } from '../src/client/api.js'
import type { ArkmeCallDetail, ArkmeTimelineItem } from '../src/types.js'

vi.mock('../src/client/api.js', () => ({ callArkme: vi.fn() }))
const item: ArkmeTimelineItem = { itemUid: 'message', senderName: '我', isMe: true, sendAtMillis: 1788949920000, title: '', textContent: '', status: 1, callRecord: { mediaType: 'video', text: '已取消', callRef: 'sealed-call' } }
const detail: ArkmeCallDetail = { callRef: 'sealed-call', title: '通话详情', mediaType: 'video', startedAtMillis: 1788949920000, acceptedAtMillis: 0, endedAtMillis: 1788949922000, durationSeconds: 2, callResult: 'Cancel', resultLabel: '已取消', summaryStatus: 'idle', transcriptPending: false, transcriptFailed: false, participants: [], transcriptSegments: [] }

describe('call detail drawer', () => {
  it('uses the call surface detail and opens its video controls only after clicking', async () => {
    vi.mocked(callArkme).mockResolvedValue({ ...detail, participants: [{ userId: 2, displayName: 'Peer', isCurrentUser: false }], videoRecord: { available: true, source: 'real', perspectives: [{ perspective: 'peer', userId: 2, videoUrl: 'https://example.com/clip.mp4' }] } })
    let view: ReturnType<typeof create>
    await act(async () => { view = create(<ArkmeCallDetailDrawer item={item} onClose={() => {}} />) })
    expect(view!.root.findAllByType('video').every(video => !video.props.controls)).toBe(true)
    const trigger = view!.root.findByProps({ 'aria-label': '播放视频记录' })
    expect(view!.root.findByProps({ 'data-arkme-call-detail-content': 'true' })).toBeTruthy()
    act(() => { trigger.props.onClick() })
    expect(view!.root.findAllByType('video').every(video => !video.props.controls)).toBe(true)
    expect(view!.root.findByProps({ 'aria-label': '视频播放控制' })).toBeTruthy()
    act(() => { view!.root.findByProps({ 'aria-label': '暂停视频记录' }).props.onClick() })
    expect(view!.root.findByProps({ 'aria-label': '继续播放视频记录' })).toBeTruthy()
    act(() => { view!.unmount() })
  })
  it('loads the exact referenced call and renders the desktop empty state without note controls', async () => {
    vi.mocked(callArkme).mockResolvedValue(detail)
    const onClose = vi.fn()
    let view: ReturnType<typeof create>
    await act(async () => { view = create(<ArkmeCallDetailDrawer item={item} onClose={onClose} />) })
    expect(callArkme).toHaveBeenLastCalledWith('calls.history.detail', { callRef: 'sealed-call' }, expect.any(AbortSignal))
    const rendered = JSON.stringify(view!.toJSON())
    expect(rendered).toContain('通话详情')
    expect(rendered).toContain('视频通话')
    expect(rendered).toContain('video-outgoing-linear.svg')
    expect(rendered).toContain('00:02')
    expect(rendered).toContain('暂无转写内容')
    expect(rendered).not.toContain('快记详情')
    expect(rendered).not.toContain('延展此快记')
    act(() => { view!.root.findByProps({ 'aria-label': '关闭通话详情' }).props.onClick() })
    expect(onClose).toHaveBeenCalledOnce()
    act(() => { view!.unmount() })
  })

  it('shows a retryable request error instead of claiming there is no transcript', async () => {
    vi.mocked(callArkme).mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ ...detail, transcriptSegments: [{ segmentId: 's', speakerDisplayName: '对方', text: '真实转写内容', startMillis: 0, endMillis: 1000 }] })
    let view: ReturnType<typeof create>
    await act(async () => { view = create(<ArkmeCallDetailDrawer item={item} onClose={() => {}} />) })
    expect(JSON.stringify(view!.toJSON())).toContain('通话详情加载失败')
    expect(JSON.stringify(view!.toJSON())).not.toContain('暂无转写内容')
    await act(async () => { view!.root.findAllByType('button').find(button => button.children.includes('重试'))!.props.onClick() })
    expect(JSON.stringify(view!.toJSON())).toContain('真实转写内容')
    act(() => { view!.unmount() })
  })

  it('aborts the previous request when switching messages and ignores its late result', async () => {
    let resolveOld: (value: ArkmeCallDetail) => void = () => {}
    vi.mocked(callArkme).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve as typeof resolveOld })).mockResolvedValueOnce({ ...detail, mediaType: 'audio' })
    let view: ReturnType<typeof create>
    await act(async () => { view = create(<ArkmeCallDetailDrawer item={item} onClose={() => {}} />) })
    const signal = vi.mocked(callArkme).mock.calls.at(-1)![2] as AbortSignal
    await act(async () => { view!.update(<ArkmeCallDetailDrawer item={{ ...item, itemUid: 'second', callRecord: { mediaType: 'audio', text: '已取消', callRef: 'second' } }} onClose={() => {}} />) })
    expect(signal.aborted).toBe(true)
    await act(async () => { resolveOld(detail) })
    expect(JSON.stringify(view!.toJSON())).toContain('语音通话')
    expect(JSON.stringify(view!.toJSON())).not.toContain('视频通话')
    act(() => { view!.unmount() })
  })

  it('formats zero and unknown durations separately', () => {
    expect(callDetailDuration(0)).toBe('00:00')
    expect(callDetailDuration(65)).toBe('01:05')
    expect(callDetailDuration(undefined)).toBe('--:--')
  })

  it('does not fetch or pretend the transcript is empty when the room reference is missing', async () => {
    vi.mocked(callArkme).mockClear()
    let view: ReturnType<typeof create>
    await act(async () => { view = create(<ArkmeCallDetailDrawer item={{ ...item, callRecord: { mediaType: 'audio', text: '已取消' } }} onClose={() => {}} />) })
    expect(callArkme).not.toHaveBeenCalled()
    expect(JSON.stringify(view!.toJSON())).toContain('通话详情暂不可用')
    expect(JSON.stringify(view!.toJSON())).not.toContain('暂无转写内容')
    act(() => { view!.unmount() })
  })
})
