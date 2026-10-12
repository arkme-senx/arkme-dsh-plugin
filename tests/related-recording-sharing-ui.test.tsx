// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => vi.fn())
vi.mock('../src/client/api.js', () => ({ callArkme: api }))
import { RelatedRecordingsPanel, RelatedRecordingDetail } from '../src/client/related-recordings.js'
import { useRelatedRecordingSharing } from '../src/client/use-related-recording-sharing.js'
import type { ArkmeRelatedRecordingItem, ArkmeRelatedRecordingShareResult } from '../src/types.js'

const item: ArkmeRelatedRecordingItem = { recordingRef: 'recording-1', shareActionRef: 'owner-action', shareStateKnown: true, isShared: false,
  startAtMillis: new Date('2026-10-09T09:00:00+08:00').getTime(), endAtMillis: new Date('2026-10-09T09:30:00+08:00').getTime(),
  title: '项目讨论', summary: '讨论开发安排。', transcript: '完整录音文字', transcriptAvailable: true, summaryStatus: 2,
  timeRangeText: '09:00 - 09:30', isSharedByOther: false, speakers: [], participants: [] }
const shared: ArkmeRelatedRecordingShareResult = { recordingRef: item.recordingRef, shareActionRef: 'shared-action', shareStateKnown: true,
  isShared: true, sequence: 8, timelineItemKey: 'timeline-1' }
let root: Root
let host: HTMLDivElement
let lastMutation: ReturnType<typeof useRelatedRecordingSharing>['mutate']

function View({ scope = 'account:peer-1', initial = item, failRefresh = false }: { scope?: string; initial?: ArkmeRelatedRecordingItem; failRefresh?: boolean }) {
  const [current, setCurrent] = useState(initial)
  const [detail, setDetail] = useState(false)
  const sharing = useRelatedRecordingSharing(scope, 'source-ref', result => {
    setCurrent(value => ({ ...value, ...result }))
    if (failRefresh) throw new Error('timeline refresh failed')
  })
  lastMutation = sharing.mutate
  return <><RelatedRecordingsPanel contactName="同事" items={[current]} state="success" stateMessage="" error=""
    hasMore={false} loadingMore={false} monthBuckets={[]} selectedMonth="" onClose={() => undefined} onRetry={() => undefined}
    onLoadMore={() => undefined} onMonthChange={() => undefined} onSelect={() => setDetail(true)}
    shareStatuses={sharing.statuses} onShare={value => sharing.mutate(value, 'share')} />
    {detail && <RelatedRecordingDetail item={current} onClose={() => setDetail(false)}
      {...(sharing.statuses[current.recordingRef] ? { shareStatus: sharing.statuses[current.recordingRef]! } : {})}
      onShare={value => sharing.mutate(value, 'share')} onWithdraw={value => sharing.mutate(value, 'withdraw')} />}</>
}
function button(text: string) {
  const found = [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === text)
  expect(found, `button ${text}`).toBeDefined()
  return found!
}
async function click(node: HTMLElement) { await act(async () => node.click()) }
async function openDetail() { await click([...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.includes(item.title))!) }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  api.mockReset()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })

describe('related recording sharing interactions', () => {
  it('shares from the list without opening detail, and disables duplicate actions in both surfaces', async () => {
    let resolve!: (result: ArkmeRelatedRecordingShareResult) => void
    api.mockReturnValue(new Promise(done => { resolve = done }))
    await act(async () => root.render(<View />))
    expect(document.querySelector('button button')).toBeNull()
    await click(button('共享'))
    expect(document.querySelector('[role=dialog]')).toBeNull()
    expect(button('共享中…').disabled).toBe(true)
    await openDetail()
    expect(document.querySelectorAll('button[disabled]').length).toBe(2)
    await act(async () => { await lastMutation(item, 'share') })
    expect(api).toHaveBeenCalledTimes(1)
    await act(async () => resolve(shared))
    expect(button('已共享').disabled).toBe(true)
    expect(button('撤回共享').disabled).toBe(false)
    expect(api).toHaveBeenCalledWith('related-recordings.share', { sourceRef: 'source-ref', actionRef: 'owner-action' })
  })

  it('withdraws only after confirmation, keeps transcript open, and preserves the original item', async () => {
    api.mockResolvedValue({ ...shared, shareActionRef: 'unshared-action', isShared: false })
    await act(async () => root.render(<View initial={{ ...item, ...shared }} />))
    await openDetail()
    await click(button('查看原文'))
    await click(button('撤回共享'))
    expect(document.body.textContent).toContain('自己的原始录音会保留')
    expect(api).not.toHaveBeenCalled()
    await click(button('取消'))
    expect(api).not.toHaveBeenCalled()
    await click(button('撤回共享'))
    await click(button('确认撤回'))
    expect(api).toHaveBeenCalledWith('related-recordings.withdraw', { sourceRef: 'source-ref', actionRef: 'shared-action' })
    expect(document.querySelector('[data-arkme-confirm-dialog]')).toBeNull()
    expect(button('共享').disabled).toBe(false)
    expect(button('共享给对方').disabled).toBe(false)
    expect(button('收起原文')).toBeDefined()
    expect(document.body.textContent).toContain('完整录音文字')
    expect(document.body.textContent).toContain('项目讨论')
  })

  it('keeps an unsuccessful withdrawal shared and allows a deliberate retry', async () => {
    api.mockRejectedValue(new Error('撤回失败，请重试'))
    await act(async () => root.render(<View initial={{ ...item, ...shared }} />))
    await openDetail(); await click(button('撤回共享')); await click(button('确认撤回'))
    expect(document.querySelector('[data-arkme-confirm-dialog]')).not.toBeNull()
    expect(button('已共享').disabled).toBe(true)
    expect(button('确认撤回').disabled).toBe(false)
    expect(document.body.textContent).toContain('撤回失败，请重试')
    expect(api).toHaveBeenCalledTimes(1)
  })

  it('disables unknown share state and offers no mutation for a received share', async () => {
    await act(async () => root.render(<View key="unknown" initial={{ ...item, shareStateKnown: false }} />))
    expect(button('共享').disabled).toBe(true)
    await click(button('共享'))
    expect(api).not.toHaveBeenCalled()
    await act(async () => root.render(<View key="received" initial={{ ...item, ...shared, isSharedByOther: true }} />))
    expect(document.querySelector('button[aria-label="共享给对方"]')).toBeNull()
    await openDetail()
    expect(document.body.textContent).not.toContain('撤回共享')
    expect(document.body.textContent).not.toContain('共享给对方')
    expect(api).not.toHaveBeenCalled()
  })

  it('ignores an old conversation completion after switching peers', async () => {
    let resolve!: (result: ArkmeRelatedRecordingShareResult) => void
    api.mockReturnValue(new Promise(done => { resolve = done }))
    await act(async () => root.render(<View scope="peer-1" />))
    await click(button('共享'))
    await act(async () => root.render(<View scope="peer-2" />))
    expect(button('共享').disabled).toBe(false)
    await act(async () => resolve(shared))
    expect(document.body.textContent).not.toContain('已共享')
    expect(button('共享').disabled).toBe(false)
  })

  it('never reports a committed share as failed because a later refresh failed', async () => {
    api.mockResolvedValue(shared)
    await act(async () => root.render(<View failRefresh />))
    await click(button('共享'))
    expect(button('已共享').disabled).toBe(true)
    expect(document.querySelector('[role=alert]')).toBeNull()
    expect(api).toHaveBeenCalledTimes(1)
  })
})
