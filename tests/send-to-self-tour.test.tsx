// @vitest-environment jsdom
import { act, StrictMode, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ArkmeSourceItem } from '../src/types.js'
import { ArkmeSourceBreadcrumb } from '../src/client/ArkmeSourceBreadcrumb.js'
import { ArkmeRichComposerInput, type ArkmeRichComposerHandle } from '../src/client/ArkmeRichComposerInput.js'
import { useSendToSelfTour, type SendToSelfTourOptions } from '../src/client/ArkmeSendToSelfTour.js'
import { ArkmeSendToSelfTourSession } from '../src/client/send-to-self-tour-session.js'

vi.mock('../src/client/api.js', () => ({ callArkme: async () => ({ profile: {
  userId: options.auth?.userId, createdAt: registeredAt,
} }) }))
const self: ArkmeSourceItem = { sourceRef: 'self', kind: 'send_to_self', displayName: '发给自己', activeAtMillis: 0, unreadCount: 0 }
const topic: ArkmeSourceItem = { ...self, sourceRef: 'work', kind: 'topic', displayName: '工作' }
let root: Root, host: HTMLDivElement, storage: Map<string, string>, registeredAt: number
let options: Omit<SendToSelfTourOptions, 'root' | 'composer'>
function Fixture() {
  const owner = useRef<HTMLDivElement>(null)
  const composer = useRef<ArkmeRichComposerHandle>(null)
  const tour = useSendToSelfTour({ ...options, root: owner, composer })
  const [selected, setSelected] = useState(self)
  const [creating, setCreating] = useState(false)
  const [text, setText] = useState('已有草稿')
  return <div ref={owner} data-owner>
    <ArkmeSourceBreadcrumb selectedSource={selected} sources={[self, topic]}
      tourOpen={tour.topicMenuOpen}
      onSelect={setSelected} onSelectAggregate={() => setSelected(self)} onCreateTopic={() => setCreating(true)}
      onCreateChildTopic={() => setCreating(true)} />
    <output>{selected.displayName}</output>
    {creating && <div role="dialog"><input aria-label="新主题名称" autoFocus /></div>}
    <div data-arkme-primary-composer="true">
      <ArkmeRichComposerInput ref={composer} value={text} onTextChange={setText} mentions={[]} emojis={[]}
        maxLength={20000} placeholder="输入" ariaLabel="输入" disabled={false} style={{}} />
      <button>＋</button><button>发送</button>
    </div>
    {tour.panel}
  </div>
}
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)) }) }
async function render(changes: Partial<typeof options> = {}) {
  options = { ...options, ...changes }
  await act(async () => root.render(<StrictMode><Fixture /></StrictMode>))
  await settle()
}
async function click(label: string) {
  const button = [...document.querySelectorAll('button')].find(node => node.textContent === label
    || node.getAttribute('aria-label') === label || node.querySelector('span')?.textContent === label)
  expect(button).toBeDefined()
  await act(async () => {
    button!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    button!.focus()
    button!.click()
  })
  await settle()
}
const panel = () => document.querySelector<HTMLElement>('[data-arkme-self-tour-panel]')
const menu = () => document.querySelector<HTMLElement>('[role="tree"][aria-label="主题"]')
const editor = () => host.querySelector<HTMLElement>('[contenteditable]')!
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    if (this.hidden) return new DOMRect()
    if (this.hasAttribute('data-owner')) return new DOMRect(100, 20, 800, 720)
    if (this.hasAttribute('data-arkme-primary-composer')) return new DOMRect(120, 560, 740, 160)
    if (this.getAttribute('role') === 'tree') return new DOMRect(120, 80, 260, 320)
    if (this.getAttribute('aria-label') === '发给自己主题') return new DOMRect(120, 30, 600, 30)
    return new DOMRect(120, 30, 120, 30)
  })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(320)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(220)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  HTMLElement.prototype.scrollIntoView = vi.fn()
  HTMLElement.prototype.scrollTo = vi.fn()
  storage = new Map()
  registeredAt = Date.parse('2026-09-10T00:00:00+08:00')
  options = { auth: { status: 'authenticated', environment: 'prod', userId: 1 }, active: true,
    blocked: false, deepLink: false, notificationRevision: 0,
    session: new ArkmeSendToSelfTourSession(() => ({ getItem: key => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value) } })),
  }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  document.body.innerHTML = ''; document.body.removeAttribute('data-arkme-home-tour-running')
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})

it('spotlights the input and menu while keeping keyboard focus in the guide', async () => {
  await render()
  expect(panel()?.textContent).toContain('1 / 2')
  expect(document.activeElement).toBe(panel()?.querySelector('.arkme-home-tour-primary'))
  expect(editor().textContent).toBe('已有草稿')
  expect(menu()).toBeNull()
  expect(document.querySelector('[data-arkme-self-tour-spotlight="composer"]')?.getAttribute('height')).toBe('172')
  await click('下一步')
  expect(panel()?.textContent).toContain('2 / 2')
  expect(menu()?.textContent).toContain('创建主题')
  expect(document.activeElement).toBe(panel()?.querySelector('.arkme-home-tour-primary'))
  expect(document.querySelector('[data-arkme-self-tour-spotlight="topics"]')?.getAttribute('height')).toBe('382')
  await click('上一步')
  expect(menu()).toBeNull()
  expect(document.activeElement).toBe(panel()?.querySelector('.arkme-home-tour-primary'))
  expect(editor().textContent).toBe('已有草稿')
})

it.each(['开始使用', '跳过引导', '关闭发给自己引导'])('persists %s and does not replay in a fresh page session', async action => {
  await render(); await click('下一步'); await click(action)
  expect(panel()).toBeNull(); expect(menu()).toBeNull()
  expect(storage.get('dsh-arkme:send-to-self-tour:v1:prod:1')).toBe('done')
  await render({ active: false })
  await render({ active: true, session: new ArkmeSendToSelfTourSession(() => ({ getItem: key => storage.get(key) ?? null, setItem: () => {} })) })
  expect(panel()).toBeNull()
})

it('blocks topic selection and creation until the two-step guide is completed', async () => {
  await render(); await click('下一步')
  for (const label of ['工作', '创建主题', '选择主题']) {
    await click(label)
    expect(panel()?.textContent).toContain('2 / 2')
    expect(menu()).not.toBeNull()
    expect(host.querySelector('output')?.textContent).toBe('发给自己')
    expect(host.querySelector('[aria-label="新主题名称"]')).toBeNull()
    expect(storage.size).toBe(0)
  }
  await click('开始使用')
  await click('选择主题'); await click('工作')
  expect(host.querySelector('output')?.textContent).toBe('工作')
  await click('选择主题'); await click('创建主题')
  expect(document.activeElement?.getAttribute('aria-label')).toBe('新主题名称')
})

it('blocks background and highlighted input clicks without ending the first step', async () => {
  await render()
  const businessAction = vi.fn()
  const input = editor()
  input.addEventListener('click', businessAction)
  const outside = document.createElement('button')
  outside.addEventListener('click', businessAction); document.body.append(outside)
  for (const element of [input, outside]) {
    await act(async () => {
      element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
      element.focus()
      element.click()
    })
    await settle()
    expect(panel()?.textContent).toContain('1 / 2')
    expect(panel()?.contains(document.activeElement)).toBe(true)
  }
  expect(businessAction).not.toHaveBeenCalled()
  expect(editor().textContent).toBe('已有草稿')
  expect(storage.size).toBe(0)
  await click('下一步'); expect(panel()?.textContent).toContain('2 / 2')
  await click('开始使用')
  outside.click(); expect(businessAction).toHaveBeenCalledOnce()
})

it('contains Tab navigation and prevents keyboard and file actions behind the guide', async () => {
  await render()
  const buttons = panel()!.querySelectorAll('button')
  const first = buttons[0]!, last = buttons[buttons.length - 1]!
  await act(async () => {
    last.focus(); last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
  })
  expect(document.activeElement).toBe(first)
  await act(async () => {
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
  })
  expect(document.activeElement).toBe(last)
  const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
  const drop = new Event('drop', { bubbles: true, cancelable: true })
  const input = editor(), businessAction = vi.fn()
  input.addEventListener('keydown', businessAction); input.addEventListener('drop', businessAction)
  await act(async () => { input.dispatchEvent(enter); input.dispatchEvent(drop) })
  expect(enter.defaultPrevented).toBe(true); expect(drop.defaultPrevented).toBe(true)
  expect(businessAction).not.toHaveBeenCalled(); expect(panel()).not.toBeNull()
})

it('waits for the home tour and visible composer without consuming the visit', async () => {
  document.body.setAttribute('data-arkme-home-tour-running', 'true')
  await render(); expect(panel()).toBeNull()
  const composer = host.querySelector<HTMLElement>('[data-arkme-primary-composer]')!
  composer.hidden = true; document.body.removeAttribute('data-arkme-home-tour-running')
  await settle(); expect(panel()).toBeNull()
  composer.hidden = false; await settle(); expect(panel()).not.toBeNull()
})

it('does not start for an old account, inactive surface, or a deep link visit', async () => {
  registeredAt = 1; await render(); expect(panel()).toBeNull()
  registeredAt = Date.parse('2026-09-10T00:00:00+08:00')
  await render({ auth: { ...options.auth!, userId: 2 }, active: false }); expect(panel()).toBeNull()
  await render({ active: true, deepLink: true }); expect(panel()).toBeNull()
  await render({ deepLink: false }); expect(panel()).toBeNull()
  await render({ active: false }); await render({ active: true }); expect(panel()).not.toBeNull()
})

it.each(['navigation', 'notification', 'dialog'] as const)('withdraws on %s, closing its menu without persisting completion', async reason => {
  await render(); await click('下一步')
  if (reason === 'navigation') await render({ active: false })
  if (reason === 'notification') await render({ notificationRevision: 1 })
  if (reason === 'dialog') {
    const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog'); document.body.append(dialog); await settle()
  }
  expect(panel()).toBeNull(); expect(menu()).toBeNull(); expect(storage.size).toBe(0)
})

it('Escape closes the menu and tour, and remembers completion', async () => {
  await render(); await click('下一步')
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  await settle(); expect(panel()).toBeNull(); expect(menu()).toBeNull(); expect(storage.size).toBe(1)
})

it('keeps completion isolated between environments and accounts', async () => {
  await render(); await click('跳过引导')
  await render({ auth: { status: 'authenticated', environment: 'test', userId: 1 } })
  expect(panel()).not.toBeNull(); await click('跳过引导')
  await render({ auth: { status: 'authenticated', environment: 'prod', userId: 2 } })
  expect(panel()).not.toBeNull(); await click('跳过引导')
  expect([...storage.keys()]).toEqual([
    'dsh-arkme:send-to-self-tour:v1:prod:1', 'dsh-arkme:send-to-self-tour:v1:test:1', 'dsh-arkme:send-to-self-tour:v1:prod:2',
  ])
})

it('remeasures the spotlight after input resizing without stealing focus again', async () => {
  await render()
  const composer = host.querySelector<HTMLElement>('[data-arkme-primary-composer]')!
  composer.getBoundingClientRect = () => new DOMRect(120, 500, 740, 220)
  const next = panel()!.querySelector<HTMLButtonElement>('.arkme-home-tour-primary')!
  next.focus()
  await act(async () => window.dispatchEvent(new Event('resize'))); await settle()
  expect(document.querySelector('[data-arkme-self-tour-spotlight="composer"]')?.getAttribute('height')).toBe('232')
  expect(document.activeElement).toBe(next)
})

it('releases interaction when layout moves the highlighted target entirely outside the viewport', async () => {
  await render()
  const composer = host.querySelector<HTMLElement>('[data-arkme-primary-composer]')!
  composer.getBoundingClientRect = () => new DOMRect(120, 9000, 740, 220)
  await act(async () => window.dispatchEvent(new Event('resize'))); await settle()
  expect(panel()).toBeNull(); expect(storage.size).toBe(0)
  const action = document.createElement('button'), clicked = vi.fn()
  action.addEventListener('click', clicked); document.body.append(action)
  action.click(); expect(clicked).toHaveBeenCalledOnce()
})
