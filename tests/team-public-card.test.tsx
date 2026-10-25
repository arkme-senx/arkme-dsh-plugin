// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TeamPublicCardDialog } from '../src/client/TeamPublicCardDialog.js'
const { call, open } = vi.hoisted(() => ({ call: vi.fn(), open: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: call }))
vi.mock('../src/client/team-messaging-events.js', () => ({ openTeamMessages: open }))
let host: HTMLDivElement, root: Root
const close = vi.fn()
const card = { name: '即我', jotmoId: 'our_team', contact: { state: 'available', publicRef: 'public-link' } }
const mount = async (accountKey = 'prod:90') => act(async () => root.render(<TeamPublicCardDialog accountKey={accountKey} jotmoId="our_team" onClose={close} />))
function button(label: string) { return [...document.querySelectorAll('button')].find(node => node.textContent === label)! }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); call.mockReset().mockResolvedValue(card); open.mockReset(); close.mockReset()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('only opens the existing team-link flow on explicit contact, without sending or auto-opening while reading', async () => {
  await mount()
  expect(document.body.textContent).toContain('@our_team')
  expect(open).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled()
  await act(async () => button('联系团队').click())
  expect(close).toHaveBeenCalledTimes(1)
  expect(open).toHaveBeenCalledExactlyOnceWith({ kind: 'link', publicRef: 'public-link' })
  expect(call.mock.calls.map(([op]) => op)).toEqual(['team.app.public-card'])
})

it('distinguishes a closed channel from missing backend support', async () => {
  call.mockResolvedValue({ ...card, contact: { state: 'disabled' } })
  await mount(); expect(button('联系团队').disabled).toBe(true)
  expect(document.body.textContent).toContain('暂未开放消息通道')
  call.mockResolvedValue({ ...card, contact: { state: 'backend_pending' } })
  await mount('prod:91'); await act(async () => button('联系团队').click())
  expect(document.body.textContent).toContain('后端接口开发中，开发完成后此功能完整可用。')
  expect(document.body.textContent).toContain('尚未打开团队通道，也未发送消息')
  expect(open).not.toHaveBeenCalled()
})

it.each([
  { ...card, jotmoId: 'other-team' },
  { ...card, contact: { state: 'available' } },
])('rejects mismatched or incomplete public cards and offers retry: %j', async result => {
  call.mockResolvedValueOnce(result)
  await mount(); expect(button('联系团队').disabled).toBe(true)
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('资料返回异常')
  await act(async () => button('重试').click())
  expect(button('联系团队').disabled).toBe(false)
})

it('ignores an old account response and cancels it on navigation', async () => {
  let resolve!: (value: unknown) => void
  call.mockReturnValueOnce(new Promise(done => { resolve = done }))
  await mount(); const signal = call.mock.calls[0]![2] as AbortSignal
  await mount('prod:91'); expect(signal.aborted).toBe(true)
  await act(async () => resolve({ ...card, name: '旧账号资料' }))
  expect(document.body.textContent).not.toContain('旧账号资料')
  expect(call.mock.calls.at(-1)![1]).toMatchObject({ expectedAccountKey: 'prod:91' })
})
