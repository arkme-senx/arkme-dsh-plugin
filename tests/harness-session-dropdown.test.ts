// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { installHarnessSessionDropdown } from '../src/client/harness-session-dropdown.js'
import { CONVERSATION_MENU_LAYOUT } from '../src/client/conversation-selector-style.js'

let cleanup: (() => void) | undefined
afterEach(() => { cleanup?.(); cleanup = undefined; document.body.replaceChildren(); vi.restoreAllMocks() })
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }
function mount() {
  document.body.innerHTML = `<div style="display:grid;grid-template-columns:280px minmax(0px, 1fr) 0px">
    <div><div data-slot="sidebar"><div>
      <div><button aria-label="新建会话">brand</button><button aria-label="收起侧边栏">toggle</button></div>
      <button aria-label="新建会话">新会话</button>
      <div><div data-slot="sidebar.workspaces"><div><div><span>会话</span><div><button aria-label="搜索会话">搜索</button><input /></div><div><span><button aria-label="视图选项">视图</button></span><button aria-label="添加工作区">添加</button></div><div data-slot="sidebar.workspaces.directoryFlow"></div></div><div role="tree"><div role="treeitem" aria-selected="true">会话 A<button aria-label="会话操作">…</button></div><div role="treeitem" aria-selected="false">会话 B</div></div></div></div></div>
      <div data-slot="sidebar.settings"></div>
    </div></div></div>
    <div><div data-slot="conversation.session.header"><header><nav><span><button disabled>会话 A</button></span></nav></header></div><textarea>未发送草稿</textarea></div>
    <div data-rightbar-col></div><div data-shell-overlay></div><div data-side="sidebar"></div>
  </div>`
  const frame = document.body.firstElementChild as HTMLElement
  const column = frame.firstElementChild as HTMLElement
  const header = document.querySelector('header')!
  const nativeTitle = header.querySelector('button')!
  const rows = [...document.querySelectorAll<HTMLElement>('[role="treeitem"]')]
  const create = document.querySelector<HTMLButtonElement>('[data-slot="sidebar"] > div > button')!
  const draft = document.querySelector('textarea')!
  cleanup = installHarnessSessionDropdown(document)
  const trigger = document.querySelector<HTMLButtonElement>('[data-arkme-session-trigger]')!
  return { frame, column, header, nativeTitle, rows, create, draft, trigger }
}

it('keeps native components, actions and draft identity; closes after native session selection', async () => {
  const { trigger, column, rows, nativeTitle, draft, frame } = mount()
  const select = vi.fn(() => { nativeTitle.textContent = '会话 B' })
  rows[1]!.addEventListener('click', select)
  expect(column.inert).toBe(true)
  expect(frame.style.gridTemplateColumns).toContain('280px') // Never overwrites native preferences.
  trigger.click()
  expect(column.inert).toBe(false)
  rows[1]!.click()
  await flush()
  expect(select).toHaveBeenCalledOnce()
  expect(trigger.textContent).toContain('会话 B')
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  expect(document.querySelector('textarea')).toBe(draft)
  expect(draft.value).toBe('未发送草稿')
  expect(document.querySelectorAll('[role="treeitem"]')[1]).toBe(rows[1])
})

it('shares its menu dimensions and inner padding with the topic selector', () => {
  const { trigger, column } = mount()
  trigger.click()
  expect(column.style.getPropertyValue('--arkme-session-width')).toBe(`${CONVERSATION_MENU_LAYOUT.width}px`)
  expect(column.style.getPropertyValue('--arkme-session-height')).toBe(`${CONVERSATION_MENU_LAYOUT.maxHeight}px`)
  const menu = column.querySelector<HTMLElement>('[data-arkme-session-root]')!
  expect(getComputedStyle(menu).padding).toBe(`${CONVERSATION_MENU_LAYOUT.paddingY}px ${CONVERSATION_MENU_LAYOUT.paddingX}px`)
  expect(menu.hasAttribute('data-arkme-menu-scrollbars')).toBe(true)
  expect(menu.querySelector('[role="tree"]')?.hasAttribute('data-arkme-menu-scroll')).toBe(true)
  expect(getComputedStyle(menu.querySelector('[data-arkme-session-tools-actions] button')!).backgroundColor).toBe('rgba(0, 0, 0, 0)')
  cleanup!(); cleanup = undefined
  expect(menu.hasAttribute('data-arkme-menu-scrollbars')).toBe(false)
  expect(menu.querySelector('[data-arkme-menu-scroll]')).toBeNull()
})

it('preserves session actions and portalled menus, then allows outside and Escape dismissal', () => {
  const { trigger, column, rows } = mount()
  trigger.click()
  rows[0]!.querySelector('button')!.click()
  expect(column.inert).toBe(false)
  const menu = document.createElement('div'); menu.setAttribute('role', 'menu'); document.body.append(menu)
  menu.dispatchEvent(new Event('pointerdown', { bubbles: true }))
  menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  expect(column.inert).toBe(false)
  menu.remove()
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  expect(column.inert).toBe(true)
  expect(document.activeElement).toBe(trigger)
  trigger.click()
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
  expect(column.inert).toBe(true)
})

it('provides a blank-session entry and follows native right-panel geometry and header remounts', async () => {
  const { trigger, header, frame, create } = mount()
  const newSession = vi.fn(() => { header.setAttribute('aria-hidden', 'true'); header.replaceChildren() })
  create.addEventListener('click', newSession)
  trigger.click(); create.click(); await flush()
  expect(newSession).toHaveBeenCalledOnce()
  expect(trigger.textContent).toContain('新会话')
  expect(trigger.closest('[data-arkme-session-fallback]')).not.toBeNull()
  expect(getComputedStyle(trigger.closest('[data-arkme-session-fallback]')!).left).toBe('20px')
  frame.style.gridTemplateColumns = '280px minmax(0px, 1fr) 420px'
  await flush()
  expect(frame.style.getPropertyValue('--arkme-session-rightbar')).toBe('420px')
  header.removeAttribute('aria-hidden')
  header.innerHTML = '<nav><span><button disabled>恢复的会话</button></span></nav>'
  await flush()
  expect(trigger.textContent).toContain('恢复的会话')
  expect(trigger.closest('header')).toBe(header)
})

it('restores native navigation on unsupported upstream geometry and on disposal', async () => {
  const { frame, nativeTitle, column } = mount()
  frame.style.gridTemplateColumns = '1fr 1fr'
  await flush()
  expect(document.querySelector('[data-arkme-session-trigger]')).toBeNull()
  expect(nativeTitle.hasAttribute('data-arkme-session-native-title')).toBe(false)
  expect(column.inert).toBe(false)
  expect(frame.hasAttribute('data-arkme-session-frame')).toBe(false)
  frame.style.gridTemplateColumns = '300px minmax(0px, 1fr) 0px'
  await flush()
  expect(document.querySelector('[data-arkme-session-trigger]')).not.toBeNull()
  cleanup?.(); cleanup = undefined
  expect(document.querySelector('[data-arkme-session-trigger]')).toBeNull()
  expect(frame.style.gridTemplateColumns).toBe('300px minmax(0px, 1fr) 0px')
  expect(document.querySelector('[data-arkme-session-style]')).toBeNull()
})

it('preserves rich subagent lineage instead of replacing it with a blank-session title', async () => {
  const { header, trigger } = mount()
  header.innerHTML = '<nav><span>父会话</span><span><div data-slot="conversation.session.header.lineage"><button>子任务</button></div></span></nav>'
  const lineage = header.querySelector('[data-slot]')!
  await flush()
  expect(trigger.textContent).toContain('会话')
  expect(trigger.textContent).not.toContain('新会话')
  expect(trigger.closest('nav')).toBe(header.querySelector('nav'))
  expect(header.querySelector('[data-slot]')).toBe(lineage)
  expect(lineage.hasAttribute('data-arkme-session-native-title')).toBe(false)
})

it('lets the keyboard choose the last session with ArrowUp and restores temporary row focus attributes', () => {
  const { trigger, rows } = mount()
  for (const row of rows) {
    vi.spyOn(row, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
    row.scrollIntoView = vi.fn()
  }
  const select = vi.fn()
  rows[1]!.addEventListener('click', select)
  trigger.click()
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
  expect(document.activeElement).toBe(rows[1])
  rows[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  expect(select).toHaveBeenCalledOnce()
  expect(document.activeElement).toBe(trigger)
  expect(rows[1]!.hasAttribute('tabindex')).toBe(false)
})

it('keeps native toolbar nodes and callbacks while presenting them in the compact footer, then restores them', () => {
  const { trigger, column } = mount()
  const view = column.querySelector<HTMLButtonElement>('[aria-label="视图选项"]')!
  const add = column.querySelector<HTMLButtonElement>('[aria-label="添加工作区"]')!
  const searchArea = column.querySelector<HTMLElement>('[data-arkme-session-tools-search]')!
  const nativeParent = view.parentElement
  const nativeViewAction = vi.fn()
  const nativeAddAction = vi.fn()
  view.addEventListener('click', nativeViewAction)
  add.addEventListener('click', nativeAddAction)
  expect(getComputedStyle(searchArea).display).toBe('none')
  trigger.click(); view.click(); add.click()
  expect(nativeViewAction).toHaveBeenCalledOnce()
  expect(nativeAddAction).toHaveBeenCalledOnce()
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  expect(view.parentElement).toBe(nativeParent)
  cleanup?.(); cleanup = undefined
  expect(view.parentElement).toBe(nativeParent)
  expect(searchArea.hasAttribute('data-arkme-session-tools-search')).toBe(false)
  expect(getComputedStyle(searchArea).display).not.toBe('none')
})

it('stacks the native header action slot below the title and restores it when the header changes or the adapter unloads', async () => {
  const { header, trigger } = mount()
  header.innerHTML = '<div><div><nav><span><button disabled>很长的会话标题</button></span></nav><div><div data-slot="conversation.session.header.actions"><span title="原模式说明">标准模式</span><span data-arkme-session-turn-count>12 次对话</span></div></div></div><div data-slot="conversation.session.header.utilities"><button>更多操作</button></div></div>'
  const nativeMode = header.querySelector('[title="原模式说明"]')!
  const nativeParent = nativeMode.parentElement
  await flush()
  expect(header.querySelector('[data-arkme-session-summary]')?.textContent).toBe('标准模式12 次对话')
  expect(getComputedStyle(header.querySelector('[data-arkme-session-title-cluster]')!).flexDirection).toBe('column')
  expect(trigger.title).toBe('很长的会话标题')
  expect(nativeMode.parentElement).toBe(nativeParent)
  header.setAttribute('aria-hidden', 'true')
  await flush()
  expect(header.querySelector('[data-arkme-session-summary]')).toBeNull()
  header.removeAttribute('aria-hidden')
  await flush()
  expect(header.querySelector('[data-arkme-session-summary]')).not.toBeNull()
  cleanup?.(); cleanup = undefined
  expect(nativeMode.parentElement).toBe(nativeParent)
  expect(header.querySelector('[data-arkme-session-title-cluster]')).toBeNull()
  expect(header.querySelector('[data-arkme-session-summary]')).toBeNull()
})
