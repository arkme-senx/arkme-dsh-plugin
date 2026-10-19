import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeCallHistorySummary } from '../src/client/ArkmeCallHistorySummary.js'
import { callArkme } from '../src/client/api.js'
import type { ArkmeCallHistoryItem } from '../src/types.js'

vi.mock('../src/client/api.js', () => ({ callArkme: vi.fn() }))
const item: ArkmeCallHistoryItem = {
  callRef: 'sealed-call', stableId: 'call-one', peerDisplayName: '万宇', peerUserId: 77,
  mediaType: 'audio', startedAtMillis: 1, acceptedAtMillis: 1, endedAtMillis: 65001,
  durationSeconds: 65, callResult: 'NormalEnd', resultLabel: '已接通', summaryStatus: 'done',
  summaryNeedsDetail: true, summaryPreview: '旧昵称方说话人A（s1）确认排期', canOpenDetail: true, canRedial: true,
}
let view: ReactTestRenderer | undefined
beforeEach(() => { vi.mocked(callArkme).mockReset() })
afterEach(() => { act(() => { view?.unmount() }); view = undefined; vi.unstubAllGlobals() })

describe('call history summary hydration', () => {
  it('loads only visible rows, replacing legacy prose with exactly the detail summary', async () => {
    let notify: (entries: Array<{ isIntersecting: boolean }>) => void = () => {}
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: typeof notify) { notify = callback }
      observe() {}
      disconnect() {}
    })
    vi.mocked(callArkme).mockResolvedValue({ summaryStatus: 'done', summaryText: '万宇与你确认排期。' })
    await act(async () => { view = create(<ArkmeCallHistorySummary item={item} />, { createNodeMock: () => ({}) }) })
    expect(callArkme).not.toHaveBeenCalled()
    expect(JSON.stringify(view!.toJSON())).toContain('摘要加载中')
    expect(JSON.stringify(view!.toJSON())).not.toContain('说话人A')
    await act(async () => { notify([{ isIntersecting: true }]) })
    expect(callArkme).toHaveBeenCalledExactlyOnceWith('calls.history.detail', { callRef: 'sealed-call' }, expect.any(AbortSignal))
    expect(JSON.stringify(view!.toJSON())).toContain('万宇与你确认排期。')
    expect(JSON.stringify(view!.toJSON())).not.toContain('说话人A')
  })

  it('keeps resolved list summaries without fetching details', async () => {
    await act(async () => { view = create(<ArkmeCallHistorySummary item={{ ...item, summaryNeedsDetail: false, summaryPreview: '万宇与你确认排期。' }} />) })
    expect(callArkme).not.toHaveBeenCalled()
    expect(JSON.stringify(view!.toJSON())).toContain('万宇与你确认排期。')
  })

  it('does not reintroduce stale names after a failed detail request', async () => {
    vi.mocked(callArkme).mockRejectedValue(new Error('offline'))
    await act(async () => { view = create(<ArkmeCallHistorySummary item={item} />) })
    expect(JSON.stringify(view!.toJSON())).toContain('摘要暂不可用')
    expect(JSON.stringify(view!.toJSON())).not.toContain('旧昵称')
  })

  it('refreshes changed summaries and discards results from an earlier call', async () => {
    let resolve: (value: unknown) => void = () => {}
    vi.mocked(callArkme).mockImplementationOnce(() => new Promise(done => { resolve = done }))
      .mockResolvedValue({ summaryStatus: 'done', summaryText: '新的通话摘要' })
    await act(async () => { view = create(<ArkmeCallHistorySummary item={item} />) })
    const signal = vi.mocked(callArkme).mock.calls[0]![2] as AbortSignal
    await act(async () => { view!.update(<ArkmeCallHistorySummary item={{ ...item, stableId: 'call-two', callRef: 'next-call' }} />) })
    expect(signal.aborted).toBe(true)
    await act(async () => { resolve({ summaryStatus: 'done', summaryText: '过期的摘要' }) })
    expect(JSON.stringify(view!.toJSON())).toContain('新的通话摘要')
    expect(JSON.stringify(view!.toJSON())).not.toContain('过期的摘要')
    await act(async () => { view!.update(<ArkmeCallHistorySummary item={{ ...item, stableId: 'call-two', callRef: 'next-call', summaryUpdatedAtMillis: 2 }} />) })
    expect(callArkme).toHaveBeenCalledTimes(3)
  })
})
