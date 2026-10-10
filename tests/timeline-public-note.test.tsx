// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeTimelinePublicNote } from '../src/client/ArkmeTimelinePublicNote.js'
import { callArkme } from '../src/client/api.js'
const mocks = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('../src/sdk/index.js', () => ({ createArkmeSdk: () => ({ readWorldRecord: mocks.read }) }))
vi.mock('../src/client/api.js', () => ({ callArkme: vi.fn(), ArkmeClientError: class extends Error {} }))
let host: HTMLDivElement, root: Root
const note = { recordRef: 'world-ref', authorName: '小明', headline: '', textContent: '世界中的完整正文', tags: [], templateKind: 1, createdAtMillis: 10, publishedAtMillis: 20, imageRefs: [], imageCount: 0, videoCount: 0, voiceCount: 0, extendCount: 0 }
const click = async (label: string) => { const button = document.querySelector(`[aria-label="${label}"]`) as HTMLElement; await act(async () => button.click()) }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  mocks.read.mockReset().mockResolvedValue(note)
  vi.mocked(callArkme).mockReset().mockResolvedValue({ items: [], total: 0, hasMore: false } as never)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
it('renders the mobile publication entry and opens the shared World content and comments without navigating away', async () => {
  await act(async () => root.render(<ArkmeTimelinePublicNote recordRef="opaque-timeline-ref" authorName="小明" />))
  expect(document.body.textContent).toContain('对方发布了一条新的公开快记')
  expect(document.body.textContent).not.toContain('世界中的完整正文')
  expect(mocks.read).not.toHaveBeenCalled()
  const opener = document.querySelector('button')!; opener.focus()
  await click('查看小明的公开快记')
  expect(mocks.read).toHaveBeenCalledWith('opaque-timeline-ref', expect.any(AbortSignal))
  expect(document.querySelector('[data-world-record-ref="world-ref"]')).not.toBeNull()
  expect(document.body.textContent).toContain('世界中的完整正文')
  expect(callArkme).toHaveBeenCalledWith('world.interactions.list', expect.objectContaining({ recordRef: 'world-ref' }), expect.any(AbortSignal))
  await click('关闭公开快记详情')
  expect(document.querySelector('[aria-label="公开快记详情"]')).toBeNull()
  expect(document.activeElement).toBe(opener)
  expect(mocks.read.mock.calls[0][1].aborted).toBe(true)
})
it('keeps withdrawn or failed content out of the detail and offers retry', async () => {
  mocks.read.mockRejectedValueOnce(new Error('这条快记已取消公开'))
  await act(async () => root.render(<ArkmeTimelinePublicNote recordRef="ref" authorName="小明" />))
  await click('查看小明的公开快记')
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('已取消公开')
  expect(document.querySelector('[data-world-record-ref]')).toBeNull()
  await act(async () => (document.querySelector('[role="alert"] button') as HTMLElement).click())
  expect(document.body.textContent).toContain('世界中的完整正文')
})
