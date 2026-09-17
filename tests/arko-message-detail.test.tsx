// @vitest-environment jsdom
import { arkoModelCache } from '../src/client/arko-model-cache.js'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeArkoSurface } from '../src/client/ArkmeArkoSurface.js'
import { callArkme } from '../src/client/api.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeComposerDraftStore, arkmeArkoComposerDraftKey } from '../src/client/composer-draft-store.js'
import { arkmeArkoProfileStore } from '../src/client/arko-profile-store.js'

vi.mock('../src/client/api.js', async original => ({ ...await original<typeof import('../src/client/api.js')>(), callArkme: vi.fn() }))
let root: Root
let host: HTMLDivElement
const click = async (element: Element) => { await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })) }) }
const bubble = (text: string) => [...host.querySelectorAll('p')].find(p => p.textContent === text)!.parentElement!
const detail = () => host.querySelector('[role="dialog"][aria-label="消息详情"]')
beforeEach(async () => {
  arkoModelCache.clear()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  arkmeArkoProfileStore.activateUser(undefined)
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 10001 })
  vi.mocked(callArkme).mockImplementation(async method => {
    if (method === 'arko.session') return { sessionId: 88 } as never
    if (method === 'arko.history') return { items: [
      { messageId: 1, sessionId: 88, role: 'user', messageActionRef: 'user-action', messageActionConversationRef: 'conversation', text: '我的问题', reasoning: '', createdAtMillis: 1786000000000, status: 1, createdRecordUids: [] },
      { messageId: 2, sessionId: 88, role: 'assistant', messageActionRef: 'assistant-action', messageActionConversationRef: 'conversation', text: '完整回答', reasoning: '已有思考内容', createdAtMillis: 1786000001000, status: 1, createdRecordUids: [] },
    ] } as never
    if (method === 'arko.models') return { options: [] } as never
    if (method === 'arko.profile') return { displayName: '小助', version: 2 } as never
    if (method === 'user.profile') return { profile: {} } as never
    throw new Error(`unexpected ${method}`)
  })
  host = document.createElement('div'); document.body.append(host)
  root = createRoot(host)
  await act(async () => { root.render(<ArkmeArkoSurface />) })
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  window.getSelection()?.removeAllRanges()
  arkmeArkoProfileStore.activateUser(undefined)
  arkmeComposerDraftStore.clearAccount(10001)
  vi.unstubAllGlobals(); vi.clearAllMocks()
})
it('opens both message roles without requests and switches content without duplicating drawers', async () => {
  const calls = vi.mocked(callArkme).mock.calls.length
  await click(bubble('我的问题'))
  expect(detail()).not.toBeNull()
  expect(detail()!.textContent).toContain('我的问题')
  await click(bubble('完整回答'))
  expect(detail()!.textContent).toContain('完整回答')
  expect(detail()!.textContent).toContain('已有思考内容')
  expect(detail()!.textContent).toContain('小助')
  expect(host.querySelectorAll('[aria-label="消息详情"]')).toHaveLength(1)
  expect(vi.mocked(callArkme).mock.calls).toHaveLength(calls)
})
it('does not open when selecting message text or toggling thinking', async () => {
  const text = bubble('完整回答').querySelector('p')!
  const range = document.createRange(); range.selectNodeContents(text)
  window.getSelection()!.addRange(range)
  await click(text)
  expect(detail()).toBeNull()
  window.getSelection()!.removeAllRanges()
  await click(host.querySelector('[aria-expanded]')!)
  expect(detail()).toBeNull()
})
it('closes with Escape and restores keyboard focus to the message', async () => {
  const trigger = bubble('我的问题')
  trigger.focus()
  await act(async () => { trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  expect(detail()).not.toBeNull()
  expect(document.activeElement?.getAttribute('aria-label')).toBe('关闭详情')
  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
  expect(detail()).toBeNull()
  expect(document.activeElement).toBe(trigger)
})
it('discards selection on account change and does not resurrect it on return', async () => {
  await click(bubble('完整回答'))
  expect(detail()).not.toBeNull()
  await act(async () => { arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 10002 }) })
  expect(detail()).toBeNull()
  await act(async () => { arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 10001 }) })
  expect(detail()).toBeNull()
})

it('keeps multi-select semantics and never reopens detail after exiting selection', async () => {
  await click(bubble('完整回答'))
  await act(async () => { bubble('我的问题').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })) })
  await click(document.querySelector('[aria-label="多选"]')!)
  expect(detail()).toBeNull()
  await click(bubble('完整回答'))
  expect(detail()).toBeNull()
  await click(document.querySelector('[aria-label="退出多选"]')!)
  expect(detail()).toBeNull()
})
it('reserves Escape for a higher modal and closes with the close button', async () => {
  await click(bubble('完整回答'))
  const modal = document.createElement('div'); modal.setAttribute('aria-modal', 'true'); document.body.append(modal)
  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  expect(detail()).not.toBeNull()
  modal.remove()
  await click(detail()!.querySelector('[aria-label="关闭详情"]')!)
  expect(detail()).toBeNull()
})
it.each([false, true])('reconciles an optimistic question without resurrecting a closed detail: %s', async closeBeforeResult => {
  let finish!: (value: unknown) => void
  const original = vi.mocked(callArkme).getMockImplementation()!
  vi.mocked(callArkme).mockImplementation((method, input, signal) => method === 'arko.ask'
    ? new Promise(resolve => { finish = resolve }) as never : original(method, input, signal))
  await click(host.querySelector('[aria-label="小助 能干什么"]')!)
  await click(bubble('你能帮我干什么'))
  expect(detail()!.textContent).toContain('你能帮我干什么')
  if (closeBeforeResult) await click(detail()!.querySelector('[aria-label="关闭详情"]')!)
  await act(async () => { finish({ sessionId: 88, userMsgId: 3, assistantMsgId: 4, status: 'completed', text: '新的回答', reasoning: '', createdRecordUids: [] }) })
  if (closeBeforeResult) expect(detail()).toBeNull()
  else {
    expect(detail()!.textContent).toContain('你能帮我干什么')
    await click(detail()!.querySelector('[aria-label="关闭详情"]')!)
    expect(document.activeElement).toBe(bubble('你能帮我干什么'))
  }
})
it('updates an open running reply from the existing history polling and displays failure', async () => {
  vi.useFakeTimers()
  const original = vi.mocked(callArkme).getMockImplementation()!
  vi.mocked(callArkme).mockImplementation(async (method, input, signal) => {
    if (method === 'arko.ask') return { sessionId: 88, userMsgId: 3, assistantMsgId: 4, status: 'running', runUid: 'run-detail', text: '生成中的回答', reasoning: '已有推理', createdRecordUids: [] } as never
    if (method === 'arko.run.status') return { status: 'failed' } as never
    if (method === 'arko.history') return { items: [{ messageId: 4, sessionId: 88, role: 'assistant', text: '任务执行失败', reasoning: '已有推理', createdAtMillis: 1786000001000, status: 2, runUid: 'run-detail', runStatus: 'failed', createdRecordUids: [] }] } as never
    return original(method, input, signal)
  })
  try {
    await click(host.querySelector('[aria-label="小助 能干什么"]')!)
    await click(bubble('生成中的回答'))
    expect(detail()!.textContent).toContain('生成中的回答')
    await act(async () => { await vi.advanceTimersByTimeAsync(1200) })
    expect(detail()!.textContent).toContain('任务执行失败')
    expect(detail()!.textContent).not.toContain('生成中的回答')
  } finally { vi.useRealTimers() }
})
it('keeps an embedded control click from opening detail', async () => {
  const link = document.createElement('a'); link.textContent = '测试链接'
  bubble('完整回答').append(link)
  await click(link)
  expect(detail()).toBeNull()
})
it('supports Space and ignores repeated keyboard activation', async () => {
  const trigger = bubble('我的问题'); trigger.focus()
  await act(async () => { trigger.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', repeat: true, bubbles: true })) })
  expect(detail()).toBeNull()
  await act(async () => { trigger.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })) })
  expect(detail()).not.toBeNull()
})
it('does not remount or steal focus when a local message receives its server identity', async () => {
  let finish!: (value: unknown) => void
  const original = vi.mocked(callArkme).getMockImplementation()!
  vi.mocked(callArkme).mockImplementation((method, input, signal) => method === 'arko.ask'
    ? new Promise(resolve => { finish = resolve }) as never : original(method, input, signal))
  await click(host.querySelector('[aria-label="小助 能干什么"]')!)
  await click(bubble('你能帮我干什么'))
  const panel = detail()
  const body = panel!.lastElementChild as HTMLElement
  body.scrollTop = 80
  const elsewhere = document.createElement('input'); document.body.append(elsewhere); elsewhere.focus()
  try {
    await act(async () => { finish({ sessionId: 88, userMsgId: 3, assistantMsgId: 4, status: 'completed', text: '新的回答', reasoning: '', createdRecordUids: [] }) })
    expect(detail()).toBe(panel)
    expect(body.scrollTop).toBe(80)
    expect(document.activeElement).toBe(elsewhere)
  } finally { elsewhere.remove() }
})
it('keeps the message text as the accessible button name', () => {
  expect(bubble('完整回答').hasAttribute('aria-label')).toBe(false)
  expect(bubble('完整回答').getAttribute('aria-description')).toBe('查看回复详情')
})
it('restores focus to the latest selected message after switching details', async () => {
  await click(bubble('我的问题'))
  await click(bubble('完整回答'))
  await click(detail()!.querySelector('[aria-label="关闭详情"]')!)
  expect(document.activeElement).toBe(bubble('完整回答'))
})
it('keeps detail open when a foreground context menu owns the interaction', async () => {
  await click(bubble('完整回答'))
  await act(async () => { bubble('我的问题').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })) })
  expect(document.querySelector('[role="menu"]')).not.toBeNull()
  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
  expect(detail()).not.toBeNull()
})

it.each([false, true])('preserves history and handles clear-context outcome with detail open: failure=%s', async failed => {
  const original = vi.mocked(callArkme).getMockImplementation()!
  vi.mocked(callArkme).mockImplementation(async (method, input, signal) => {
    if (method === 'arko.new-session') {
      if (failed) throw new Error('清除失败，请重试')
      return { sessionId: 99 } as never
    }
    return original(method, input, signal)
  })
  await click(bubble('完整回答'))
  await click(host.querySelector('[title="清除上下文"]')!)
  const confirm = [...host.querySelectorAll('button')].find(b => b.textContent === '确认')!
  await click(confirm)
  expect(host.textContent).toContain('完整回答')
  if (failed) {
    expect(detail()).not.toBeNull()
    expect(host.textContent).toContain('清除失败，请重试')
    expect((host.querySelector('[title="清除上下文"]') as HTMLButtonElement).disabled).toBe(false)
  } else {
    expect(detail()).toBeNull()
    expect(host.textContent).toContain('新的对话')
    const divider = [...host.querySelectorAll('li')].find(li => li.textContent === '新的对话')!
    await click(divider)
    expect(detail()).toBeNull()
    await click(bubble('完整回答'))
    expect(detail()!.textContent).toContain('完整回答')
  }
})
it('keeps draft and ordinary sending available while inspecting history', async () => {
  const original = vi.mocked(callArkme).getMockImplementation()!
  vi.mocked(callArkme).mockImplementation(async (method, input, signal) => method === 'arko.ask'
    ? { sessionId: 88, userMsgId: 3, assistantMsgId: 4, status: 'completed', text: '新的回答', reasoning: '', createdRecordUids: [] } as never
    : original(method, input, signal))
  const key = arkmeArkoComposerDraftKey(10001)
  await act(async () => { arkmeComposerDraftStore.setText(key, '继续提问') })
  await click(bubble('完整回答'))
  expect(arkmeComposerDraftStore.get(key).text).toBe('继续提问')
  expect(host.querySelector('[role="textbox"]')!.getAttribute('contenteditable')).toBe('true')
  const send = host.querySelector('[title="发送"]') as HTMLButtonElement
  expect(send.disabled).toBe(false)
  await click(send)
  expect(vi.mocked(callArkme)).toHaveBeenCalledWith('arko.ask', expect.objectContaining({ text: '继续提问', sessionId: 88 }))
  expect(detail()!.textContent).toContain('完整回答')
  expect(arkmeComposerDraftStore.get(key).text).toBe('')
})
it('keeps stop-task failure retryable while detail stays open', async () => {
  vi.useFakeTimers()
  const original = vi.mocked(callArkme).getMockImplementation()!
  vi.mocked(callArkme).mockImplementation(async (method, input, signal) => {
    if (method === 'arko.ask') return { sessionId: 88, userMsgId: 3, assistantMsgId: 4, status: 'running', runUid: 'running', text: '生成中', reasoning: '', createdRecordUids: [] } as never
    if (method === 'arko.cancel') throw new Error('网络失败')
    return original(method, input, signal)
  })
  try {
    await click(host.querySelector('[aria-label="小助 能干什么"]')!)
    await click(bubble('生成中'))
    const stop = host.querySelector('[aria-label="停止当前 Arko 任务"]') as HTMLButtonElement
    expect(stop.disabled).toBe(false)
    await click(stop)
    expect(stop.disabled).toBe(false)
    expect(detail()!.textContent).toContain('生成中')
    expect(host.textContent).toContain('停止 Arko 任务失败：网络失败')
    expect(vi.mocked(callArkme)).toHaveBeenCalledWith('arko.cancel', { sessionId: 88, assistantMsgId: 4, runUid: 'running' })
  } finally { vi.useRealTimers() }
})
it('closes details on logout and environment change without resurrecting selection', async () => {
  await click(bubble('完整回答'))
  await act(async () => { arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'prod', userId: 10001 }) })
  expect(detail()).toBeNull()
  await click(bubble('完整回答'))
  await act(async () => { arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'prod' }) })
  expect(detail()).toBeNull()
})
it('does not parse message text as markup or fabricate missing timestamps', async () => {
  const original = vi.mocked(callArkme).getMockImplementation()!
  const unsafe = '<img src=x onerror="alert(1)">'
  vi.mocked(callArkme).mockImplementation(async (method, input, signal) => method === 'arko.history'
    ? { items: [{ messageId: 9, sessionId: 88, role: 'assistant', text: unsafe, reasoning: '', createdAtMillis: 0, status: 1, createdRecordUids: [] }] } as never
    : original(method, input, signal))
  await act(async () => { root.render(<ArkmeArkoSurface key="new-mount" />) })
  await click(bubble(unsafe))
  expect(detail()!.textContent).toContain(unsafe)
  expect(detail()!.querySelector('img')).toBeNull()
  expect(detail()!.textContent).not.toMatch(/1970|Invalid Date/)
})
it('keeps model switching isolated from the open detail and preserves the draft', async () => {
  const models = { options: [
    { routeKey: 'a', displayName: '模型A', description: '', selected: true },
    { routeKey: 'b', displayName: '模型B', description: '', selected: false },
  ], effectiveRouteKey: 'a' }
  let finish!: (value: unknown) => void
  const original = vi.mocked(callArkme).getMockImplementation()!
  vi.mocked(callArkme).mockImplementation((method, input, signal) => {
    if (method === 'arko.models') return Promise.resolve(models) as never
    if (method === 'arko.model.activate') return new Promise(resolve => { finish = resolve }) as never
    return original(method, input, signal)
  })
  await act(async () => { arkoModelCache.clear(); root.render(<ArkmeArkoSurface key="models" />) })
  const key = arkmeArkoComposerDraftKey(10001)
  await act(async () => { arkmeComposerDraftStore.setText(key, '已有草稿') })
  await click(bubble('完整回答'))
  const originalPanel = detail()
  await click(host.querySelector('footer [aria-label="选择模型"]')!)
  const modal = document.querySelector('[role="menu"]')!
  await click([...modal.querySelectorAll('button')].find(b => b.textContent?.includes('模型B'))!)
  expect((host.querySelector('[title="发送"]') as HTMLButtonElement).disabled).toBe(true)
  await act(async () => { finish({ ...models, effectiveRouteKey: 'b' }) })
  expect(detail()).toBe(originalPanel)
  expect((host.querySelector('[title="发送"]') as HTMLButtonElement).disabled).toBe(false)
  expect(arkmeComposerDraftStore.get(key).text).toBe('已有草稿')
  expect(vi.mocked(callArkme)).toHaveBeenCalledWith('arko.model.activate', { routeKey: 'b' })
})
it('reopening after unmount starts without a retained drawer or modal state', async () => {
  await click(bubble('完整回答'))
  await act(async () => { root.render(null) })
  await act(async () => { root.render(<ArkmeArkoSurface />) })
  expect(detail()).toBeNull()
  await click(bubble('我的问题'))
  expect(detail()!.textContent).toContain('我的问题')
})
it('distinguishes an unconfirmed send from failure and retries the same turn with detail open', async () => {
  let calls = 0
  const original = vi.mocked(callArkme).getMockImplementation()!
  vi.mocked(callArkme).mockImplementation(async (method, input, signal) => {
    if (method === 'arko.ask') {
      if (++calls === 1) throw new Error('connection lost')
      return { sessionId: 88, userMsgId: 3, assistantMsgId: 4, status: 'completed', text: '已确认回复', reasoning: '', createdRecordUids: [] } as never
    }
    return original(method, input, signal)
  })
  await click(host.querySelector('[aria-label="小助 能干什么"]')!)
  await click([...host.querySelectorAll('[aria-description="查看回复详情"]')].at(-1)!)
  const retry = [...host.querySelectorAll('button')].find(b => b.textContent === '重试确认')!
  try {
    expect(detail()!.textContent).toContain('发送结果待确认')
    expect(detail()!.textContent).not.toContain('消息处理失败')
  } finally { await click(retry) }
  expect(detail()!.textContent).toContain('已确认回复')
  const requests = vi.mocked(callArkme).mock.calls.filter(([method]) => method === 'arko.ask')
  expect(requests).toHaveLength(2)
  expect(requests[1]![1]).toEqual(requests[0]![1])
})
