// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.callArkme }))
vi.mock('../src/client/ArkmeRichContent.js', () => ({ ArkmeMessageContent: () => null }))
import { SharePrivateChat } from '../src/client/TeamExternalChats.js'
import { connectArkmeLocale } from '../src/client/locale.js'

const teams = ['设计团队', '销售团队'].map((name, i) => ({key: `team-${i}`, teamRef: `sealed-${i}`, name}))
const share = (i: number) => ({key: `share-${i}`, ref: `grant-${i}`, teamKey: teams[i]!.key, teamRef: `old-sealed-${i}`, own: true})
let host: HTMLDivElement, root: Root, trigger: HTMLButtonElement
const onClose = vi.fn()
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!
const text = () => dialog()?.textContent ?? ''
const inputs = () => [...dialog().querySelectorAll<HTMLInputElement>('input')]
const button = (label: string) => [...dialog().querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === label)!
const writes = () => mocks.callArkme.mock.calls.filter(([op]) => /\.(share|unshare)$/.test(op))
async function open(sourceRef = 'source') {
  await act(async () => { root.render(<SharePrivateChat sourceRef={sourceRef} name="客户甲" onClose={onClose}/>) })
}
async function click(target: HTMLElement) { await act(async () => { target.click() }) }
function key(name: string, shiftKey = false) {
  act(() => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {key: name, shiftKey, bubbles: true, cancelable: true})))
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  onClose.mockReset(); mocks.callArkme.mockReset()
  mocks.callArkme.mockImplementation(async (op, params) => op === 'team.app.teams' ? teams : {items: op.endsWith('.share') ? [share(teams.findIndex(t => t.teamRef === params.teamRef))] : [], hasMore: false})
  host = document.createElement('div'); trigger = document.createElement('button')
  document.body.append(trigger, host); trigger.focus(); root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount()); host.remove(); trigger.remove(); vi.unstubAllGlobals()
})
it('stages selections until explicit confirmation and shows success before finishing', async () => {
  await open()
  expect(dialog().classList.contains('arkme-private-chat-share-dialog')).toBe(true)
  expect(button('保存更改').disabled).toBe(true)
  expect(text()).toContain('团队成员可只读查看全部历史和新消息。')
  await click(inputs()[0]!)
  expect(writes()).toHaveLength(0)
  expect(text()).toContain('待共享')
  await click(button('确认共享'))
  expect(writes()).toHaveLength(1)
  expect(writes()[0]).toEqual(['team.app.external.share', {teamRef: 'sealed-0', sourceRef: 'source'}, expect.any(AbortSignal)])
  expect(text()).toContain('共享设置已更新')
  expect(inputs()[0]!.checked).toBe(true)
  expect(onClose).not.toHaveBeenCalled()
  await click(button('完成'))
  expect(onClose).toHaveBeenCalledOnce()
  // A fresh opening uses the persisted grant, even when its sealed ref differs.
  mocks.callArkme.mockImplementation(async op => op === 'team.app.teams' ? teams : {items: [share(0)]})
  await open('another-source')
  expect(inputs()[0]!.checked).toBe(true)
  expect(button('保存更改').disabled).toBe(true)
})
it('cancels draft edits without writes, contains keyboard focus and restores the entry', async () => {
  await open(); await click(inputs()[0]!)
  const close = dialog().querySelector<HTMLButtonElement>('button')!
  close.focus(); key('Tab', true)
  expect(document.activeElement).toBe(button('确认共享'))
  key('Tab'); expect(document.activeElement).toBe(close)
  key('Escape'); expect(onClose).toHaveBeenCalledOnce()
  await click(button('取消'))
  expect(writes()).toHaveLength(0)
  act(() => root.render(null))
  expect(document.activeElement).toBe(trigger)
})
it('blocks duplicate submissions and dismissal while saving, keeping focus inside', async () => {
  let finish!: (value: unknown) => void
  mocks.callArkme.mockImplementation((op) => op === 'team.app.teams' ? Promise.resolve(teams) : op.endsWith('.share') ? new Promise(resolve => {finish = resolve}) : Promise.resolve({items: []}))
  await open(); await click(inputs()[0]!)
  const confirm = button('确认共享')
  await act(async () => { confirm.click(); confirm.click() })
  expect(writes()).toHaveLength(1)
  expect(dialog().getAttribute('aria-busy')).toBe('true')
  expect(document.activeElement).toBe(dialog())
  expect(inputs()[0]!.matches(':disabled')).toBe(true)
  key('Tab'); expect(document.activeElement).toBe(dialog())
  key('Escape')
  act(() => dialog().parentElement!.dispatchEvent(new MouseEvent('mousedown', {bubbles: true})))
  await click(dialog().querySelector('button')!)
  expect(onClose).not.toHaveBeenCalled()
  await act(async () => finish({items: [share(0)]}))
  expect(button('完成').disabled).toBe(false)
})
it('retains successful results and retries only failed teams', async () => {
  let fail = true
  mocks.callArkme.mockImplementation(async (op, params) => {
    if (op === 'team.app.teams') return teams
    if (op.endsWith('.share')) {
      if (params.teamRef === 'sealed-1' && fail) throw Error('网络异常')
      return {items: [share(params.teamRef === 'sealed-0' ? 0 : 1)]}
    }
    return {items: []}
  })
  await open(); await click(inputs()[0]!); await click(inputs()[1]!)
  await click(button('确认共享'))
  expect(writes()).toHaveLength(2)
  expect(text()).toContain('部分更改已保存')
  expect(text()).toContain('销售团队：网络异常')
  expect(text()).toContain('已共享到 1 个团队')
  expect(inputs().every(input => input.checked)).toBe(true)
  fail = false; await click(button('重试保存'))
  expect(writes()).toHaveLength(3)
  expect(writes()[2]![1]).toEqual({teamRef: 'sealed-1', sourceRef: 'source'})
  expect(text()).toContain('共享设置已更新')
  expect(text()).not.toContain('网络异常')
})
it('saves removal only after confirmation and retains the failed removal for retry', async () => {
  let fail = true
  mocks.callArkme.mockImplementation(async op => {
    if (op === 'team.app.teams') return teams
    if (op.endsWith('.unshare')) { if (fail) throw Error('暂时无法取消'); return null }
    return {items: [share(0)]}
  })
  await open(); await click(inputs()[0]!)
  expect(writes()).toHaveLength(0)
  expect(text()).toContain('待取消')
  await click(button('保存更改'))
  expect(text()).toContain('未能保存更改')
  expect(text()).toContain('已共享到 1 个团队')
  fail = false; await click(button('重试保存'))
  expect(writes()[1]).toEqual(['team.app.external.unshare', {shareRef: 'grant-0'}, expect.any(AbortSignal)])
  expect(text()).toContain('共享设置已更新')
  expect(inputs()[0]!.checked).toBe(false)
})
it('offers a load retry without allowing an incomplete state to overwrite shares', async () => {
  let fail = true
  mocks.callArkme.mockImplementation(async op => {
    if (op === 'team.app.teams') return teams
    if (fail) throw Error('连接失败')
    return {items: [share(0)]}
  })
  await open()
  expect(text()).toContain('连接失败')
  expect(inputs()).toHaveLength(0)
  expect(button('保存更改').disabled).toBe(true)
  fail = false; await click(button('重试'))
  expect(inputs()[0]!.checked).toBe(true)
  expect(writes()).toHaveLength(0)
})
it('handles an empty team list and aborts the old source before accepting another', async () => {
  mocks.callArkme.mockResolvedValueOnce([]).mockResolvedValueOnce({items: []})
  await open()
  expect(text()).toContain('你尚未加入团队')
  expect(button('保存更改').disabled).toBe(true)
  let finish!: (value: unknown) => void
  mocks.callArkme.mockImplementation(op => op === 'team.app.teams' ? Promise.resolve(teams) : new Promise(resolve => {finish = resolve}))
  await open('old-source')
  const oldSignal = mocks.callArkme.mock.calls.at(-1)![2] as AbortSignal
  mocks.callArkme.mockImplementation(async op => op === 'team.app.teams' ? teams : {items: []})
  await open('new-source')
  expect(oldSignal.aborted).toBe(true)
  await act(async () => finish({items: [share(0)]}))
  expect(inputs()[0]!.checked).toBe(false)
})
it('unlocks a stalled save, ignores its late result and reloads authoritative state before editing', async () => {
  vi.useFakeTimers()
  let finish!: (value: unknown) => void
  let persisted = false
  mocks.callArkme.mockImplementation((op) => {
    if (op === 'team.app.teams') return Promise.resolve(teams)
    if (op.endsWith('.share')) return new Promise(resolve => {finish = resolve})
    return Promise.resolve({items: persisted ? [share(0)] : []})
  })
  try {
    await open(); await click(inputs()[0]!); await click(inputs()[1]!)
    await click(button('确认共享'))
    const signal = writes()[0]![2] as AbortSignal
    await act(async () => {await vi.advanceTimersByTimeAsync(30_000)})
    expect(dialog().hasAttribute('aria-busy')).toBe(false)
    expect(text()).toContain('保存结果待核对')
    expect(signal.aborted).toBe(true)
    expect(inputs().every(input => input.matches(':disabled'))).toBe(true)
    expect(writes()).toHaveLength(1)
    // The write may have committed even though the response was lost.
    persisted = true
    await act(async () => finish({items: [share(0)]}))
    expect(text()).not.toContain('共享设置已更新')
    await click(button('重新加载'))
    expect(inputs()[0]!.checked).toBe(true)
    expect(inputs()[1]!.checked).toBe(false)
    expect(inputs()[0]!.matches(':disabled')).toBe(false)
    expect(button('保存更改').disabled).toBe(true)
  } finally {vi.useRealTimers()}
})
it.each(['local-network-unavailable', 'local-response-invalid'])('requires a state reload after an uncertain %s response', async code => {
  let attempted = false
  mocks.callArkme.mockImplementation(async op => {
    if (op === 'team.app.teams') return teams
    if (op.endsWith('.share')) {attempted = true; throw Object.assign(new Error('unconfirmed'), {body: {code}})}
    return {items: attempted ? [share(0)] : []}
  })
  await open(); await click(inputs()[0]!); await click(inputs()[1]!)
  await click(button('确认共享'))
  expect(text()).toContain('保存结果待核对')
  expect(inputs().every(input => input.matches(':disabled'))).toBe(true)
  expect(button('重新加载').disabled).toBe(false)
  await click(button('重新加载'))
  expect(inputs()[0]!.checked).toBe(true)
  expect(inputs()[1]!.checked).toBe(false)
  expect(writes()).toHaveLength(1)
})
it('translates saving feedback without translating team names', async () => {
  let active = 'en', sync!: () => void
  const disconnect = connectArkmeLocale({getLocale: () => ({active}), subscribe: callback => {sync = callback; return () => {}}})
  let finish!: (value: unknown) => void
  mocks.callArkme.mockImplementation(op => op === 'team.app.teams' ? Promise.resolve(teams)
    : op.endsWith('.share') ? new Promise(resolve => {finish = resolve}) : Promise.resolve({items: []}))
  try {
    await open(); await click(inputs()[0]!)
    await click(button('Confirm sharing'))
    expect(text()).toContain('Saving…')
    expect(text()).not.toContain('正在保存')
    expect(text()).toContain('设计团队')
    await act(async () => finish({items: [share(0)]}))
    expect(text()).toContain('Sharing settings updated')
  } finally {
    act(() => {active = 'zh'; sync()}); disconnect()
  }
})
