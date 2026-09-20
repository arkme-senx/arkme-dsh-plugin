// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import { ArkmeActionMenu, ArkmeDshMenu } from '../src/client/ArkmeDshMenu.js'
import { readFileSync } from 'node:fs'

let host: HTMLDivElement, root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(218)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(128)
  Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  expect(document.querySelector('[role="menu"]')).toBeNull()
})

it('uses the real native Menu and retains its viewport fitting for pointer anchors', async () => {
  expect(typeof Menu).toBe('function')
  const select = vi.fn(), disabled = vi.fn(), close = vi.fn()
  await act(async () => root.render(<ArkmeActionMenu label="统一菜单" point={{ x: 1199, y: 799 }} onClose={close} actions={[
    { id: 'copy', label: '复制', onSelect: select },
    { id: 'disabled', label: '不可用', disabled: true, onSelect: disabled },
    { id: 'delete', label: '删除', danger: true, onSelect: vi.fn() },
  ]} />))
  const menu = document.querySelector<HTMLElement>('[role="menu"]')!
  expect(menu.getAttribute('aria-label')).toBe('统一菜单')
  expect(host.contains(menu)).toBe(false)
  expect(menu.style.left).toBe('970px'); expect(menu.style.top).toBe('660px')
  const buttons = [...menu.querySelectorAll('button')]
  await act(async () => buttons[0]!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })))
  expect(close).not.toHaveBeenCalled()
  await act(async () => buttons[0]!.click()); expect(select).toHaveBeenCalledOnce()
  await act(async () => buttons[1]!.click()); expect(disabled).not.toHaveBeenCalled()
  await act(async () => document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })))
  expect(close).toHaveBeenCalledOnce()
})

it('navigates enabled items by keyboard and restores focus on Escape', async () => {
  const close = vi.fn()
  await act(async () => root.render(<ArkmeActionMenu label="键盘菜单" autoFocus onClose={close}
    anchor={<button>打开菜单</button>} actions={[
      { id: 'one', label: '第一项', onSelect: vi.fn() },
      { id: 'disabled', label: '禁用', disabled: true, onSelect: vi.fn() },
      { id: 'last', label: '末项', onSelect: vi.fn() },
    ]} />))
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
  expect(document.activeElement).toBe(buttons[0])
  host.querySelector('button')!.focus()
  await act(async () => host.querySelector('button')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })))
  expect(document.activeElement).toBe(buttons[2])
  await act(async () => buttons[2]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })))
  await act(async () => buttons[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
  expect(document.activeElement).toBe(buttons[2])
  await act(async () => buttons[2]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })))
  expect(document.activeElement).toBe(buttons[0])
  await act(async () => buttons[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(close).toHaveBeenCalledOnce(); expect(document.activeElement).toBe(host.querySelector('button'))
})

it('passes native danger, disabled, selected and full-sized configuration through one adapter', async () => {
  await act(async () => root.render(<ArkmeDshMenu label="原生菜单" open anchor={<button>菜单</button>}
    portal selectedIds={['selected']} onClose={vi.fn()} onSelect={vi.fn()} items={[
      { id: 'selected', label: '选中' }, { id: 'danger', label: '删除', danger: true },
      { id: 'disabled', label: '禁用', disabled: true },
    ]} />))
  expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(3)
  expect(document.querySelectorAll('[role="menuitem"]:disabled')).toHaveLength(1)
  const source = readFileSync('src/client/ArkmeDshMenu.tsx', 'utf8')
  expect(source).toContain('<Menu')
  expect(source).toContain('danger: action.danger')
  expect(source.slice(source.indexOf('export function ArkmeActionMenu('))).not.toMatch(/boxShadow|borderRadius|background:|fontSize|zIndex/)
  expect(document.querySelector('.arkme-conversation-actions-menu')).toBeNull()
  expect(document.querySelector('style')).toBeNull()
})

it('applies conversation styling only to the explicitly opted-in settings menu', async () => {
  const renderMenu = (conversationAppearance: boolean) => <ArkmeDshMenu label="会话设置" open
    conversationAppearance={conversationAppearance} anchor={<button>设置</button>}
    portal onClose={vi.fn()} onSelect={vi.fn()} items={[{ id: 'export', label: '导出' }]} />
  await act(async () => root.render(renderMenu(true)))
  const menu = document.querySelector('[role="menu"]')!
  expect(host.contains(menu)).toBe(false)
  expect(menu.matches('[role="menu"]:has(.arkme-conversation-actions-menu-label)')).toBe(true)
  expect(document.querySelector('style')?.textContent).toContain('.arkme-conversation-actions-menu')
  await act(async () => root.render(renderMenu(false)))
  expect(document.querySelector('.arkme-conversation-actions-menu')).toBeNull()
  expect(document.querySelector('.arkme-conversation-actions-menu-label')).toBeNull()
  expect(document.querySelector('style')).toBeNull()
  expect(document.querySelector('[role="menuitem"]')?.textContent).toBe('导出')
})

it('dismisses when clicking inside the embedded Harness document', async () => {
  const frame = document.createElement('iframe'); document.body.append(frame)
  const close = vi.fn()
  await act(async () => root.render(<ArkmeActionMenu label="跨页面菜单" point={{ x: 30, y: 40 }} onClose={close}
    actions={[{ id: 'one', label: '第一项', onSelect: vi.fn() }]} />))
  await act(async () => frame.contentDocument!.body.dispatchEvent(new frame.contentWindow!.MouseEvent('pointerdown', { bubbles: true })))
  expect(close).toHaveBeenCalledOnce(); frame.remove()
})
