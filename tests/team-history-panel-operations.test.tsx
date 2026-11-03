// @vitest-environment jsdom
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { TeamHistoryPanel } from '../src/client/TeamHistoryPanel.js'
import type { TeamConversation } from '../src/team-app-contract.js'

const { call } = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: call }))
vi.mock('../src/client/use-team-person-names.js', () => ({ useTeamPersonNames: () => (person: unknown) => person }))
let host: HTMLDivElement, root: Root, sequence: number
const conversation = { ref: 'ref', key: 'conversation', side: 'team' } as TeamConversation
function render(account = 'prod:1') {
  root.render(<TeamHistoryPanel conversation={conversation} accountKey={account} kind="analysis" keyword="" onKeywordChange={() => {}} inputRef={createRef()} opening="" onLocate={() => {}} resolveIdentity={p => p} />)
}
async function click(text: string) {
  const button = [...host.querySelectorAll('button')].find(b => b.textContent === text)
  if (!button) throw new Error(`missing button ${text}`)
  await act(async () => button.click())
}
const creates = () => call.mock.calls.filter(c => c[1].action === 'analysis/create').map(c => c[1].options)
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  sequence = 0
  vi.stubGlobal('crypto', { randomUUID: () => `request-${++sequence}` })
  call.mockReset().mockImplementation(async (_method, request) => ({ state: 'ready', resultRef: request.options.resultRef || `result-${request.options.requestId}`, messages: [], words: [], days: [], participants: [], cursor: '', hasMore: false }))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })

it('reuses tab operations while verifying again and renews them on refresh/filter/account change', async () => {
  await act(async () => render())
  await click('词频分析'); await click('活跃时间'); await click('词频分析')
  const ids = creates().map(c => c.requestId)
  expect(ids).toHaveLength(4)
  expect(ids[0]).toBe(ids[2]); expect(ids[1]).toBe(ids[3]); expect(ids[0]).not.toBe(ids[1])
  expect(call.mock.calls.filter(c => c[1].action === 'analysis/result')).toHaveLength(2)
  expect(call.mock.calls.filter(c => c[1].action === 'analysis/words')).toHaveLength(2)
  await click('刷新')
  expect(creates().at(-1)!.requestId).not.toBe(creates()[1]!.requestId)
  const month = host.querySelector('input[type=month]') as HTMLInputElement
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(month, '2026-10')
    month.dispatchEvent(new Event('input', { bubbles: true })); month.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(creates().at(-1)!.fromAt).toBe(new Date(2026,9,1).getTime())
  const previous = creates().at(-1)!.requestId
  await act(async () => render('prod:2'))
  expect(creates().at(-1)!.requestId).not.toBe(previous)
})

it('material invalidation clears all receipts without displaying cached bodies', async () => {
  await act(async () => render())
  const initial = creates()[0]!.requestId
  const { invalidateTeamMessages } = await import('../src/client/team-messaging-events.js')
  await act(async () => invalidateTeamMessages('prod:1', false, { kind: 'team.message.changed', conversationKeys: ['conversation'] }))
  expect(host.textContent).toContain('团队内容已更新')
  await click('词频分析'); await click('活跃时间')
  expect(creates().at(-1)!.requestId).not.toBe(initial)
})
