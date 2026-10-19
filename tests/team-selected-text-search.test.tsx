// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TeamSelectedTextSearch } from '../src/client/TeamSelectedTextSearch.js'
import type { TeamMessage, TeamTimeline } from '../src/team-app-contract.js'

const { call } = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: call }))
vi.mock('../src/client/ArkmeDetailShell.js', () => ({ ArkmeDetailShell: ({ children }: { children: React.ReactNode }) => <section>{children}</section> }))
const message = (key: string, seq: number): TeamMessage => ({ key, seq, ref: key, revision: 1, version: 1, own: false,
  side: 'team', state: 'published', contentStatus: 'available', canEdit: false, canDelete: false,
  sender: { nickname: '成员' }, createdAt: 1, media: [], content: { text_content: `关键词 ${key}`, template_kind: 1 } })
const page = (messages: TeamMessage[], hasMore = false, beforeSeq = 0) => ({ messages, hasMore, beforeSeq } as TeamTimeline)
let host: HTMLDivElement, root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); call.mockReset()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
const render = () => root.render(<TeamSelectedTextSearch conversationRef="team-ref" accountKey="prod:11" queryRequest={{ text: '关键词' }} onClose={() => {}} />)
it('shows matching first-page messages before older pages finish and deduplicates overlaps', async () => {
  let finish!: (value: TeamTimeline) => void
  call.mockResolvedValueOnce(page([message('new', 20)], true, 20))
    .mockImplementationOnce(() => new Promise<TeamTimeline>(resolve => { finish = resolve }))
  await act(async () => render())
  expect(host.textContent).toContain('关键词 new')
  expect(host.textContent).toContain('正在查找 · 已读取 1 条 · 1 条匹配')
  expect(call.mock.calls[1]).toEqual(['team.app.timeline', { conversationRef: 'team-ref', expectedAccountKey: 'prod:11', beforeSeq: 20 }, expect.any(AbortSignal)])
  await act(async () => finish(page([message('new', 20), message('old', 10)])))
  expect(host.textContent).toContain('查找完成 · 已读取 2 条 · 2 条匹配')
  expect(host.textContent?.match(/关键词 new/g)).toHaveLength(1)
})
it('keeps partial results but does not claim completeness when pagination repeats', async () => {
  call.mockResolvedValue(page([message('new', 20)], true, 20))
  await act(async () => render())
  expect(call).toHaveBeenCalledTimes(2)
  expect(host.textContent).toContain('结果尚不完整')
  expect(host.textContent).toContain('历史消息分页异常')
  expect(host.textContent).toContain('关键词 new')
})
it('aborts the history read when search closes and never issues a write', async () => {
  call.mockImplementation(() => new Promise(() => {}))
  await act(async () => render())
  const signal = call.mock.calls[0]![2] as AbortSignal
  await act(async () => root.render(null))
  expect(signal.aborted).toBe(true)
  expect(call.mock.calls.map(([operation]) => operation)).toEqual(['team.app.timeline'])
})
