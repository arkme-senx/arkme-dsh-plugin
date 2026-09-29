// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeSelfRolePicker } from '../src/client/ArkmeSelfRolePicker.js'
const { call } = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: call }))
vi.mock('../src/client/ArkmeAvatar.js', () => ({ ArkmeUserAvatar: () => <span>头像</span> }))
const roles = [
  { roleId: 'r1', name: '理性我', createdAtMillis: 1, updatedAtMillis: 1 },
  { roleId: 'r2', name: '旅行我', createdAtMillis: 1, updatedAtMillis: 1 },
]
let root: Root, host: HTMLDivElement
const onSelect = vi.fn()
const click = async (selector: string) => {
  const button = document.querySelector<HTMLButtonElement>(selector)!
  expect(button).not.toBeNull()
  await act(async () => button.click())
}
beforeEach(async () => {
  vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  call.mockImplementation(async (method: string) => method === 'self-roles.list' ? roles : undefined)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<ArkmeSelfRolePicker accountKey="test:42" userId={42} selectedRole={roles[0]} onSelect={onSelect} />))
  await click('[data-arkme-self-role-trigger]')
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('separates selection from row management and removes sync copy', async () => {
  expect(document.querySelector('button button')).toBeNull()
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toMatch(/编辑当前|删除当前|同步/)
  expect(document.querySelector('[data-role-action="role:r1"]')?.getAttribute('aria-pressed')).toBe('true')
  await click('[aria-label="管理旅行我"]')
  expect(onSelect).not.toHaveBeenCalled()
  expect(document.querySelector('[role="menu"][aria-label="角色操作"]')).not.toBeNull()
  await click('[role="menuitem"][aria-label="编辑"]')
  expect(document.querySelector('[aria-label="角色名称"]')?.getAttribute('value')).toBe('旅行我')
  expect(document.querySelector('[aria-label="编辑发言角色"]')).not.toBeNull()
})
it('deletes the managed role without clearing a different selection', async () => {
  await click('[aria-label="管理旅行我"]')
  await click('[role="menuitem"][aria-label="删除"]')
  expect(call).toHaveBeenCalledWith('self-roles.delete', { expectedUserId: 42, roleId: 'r2' })
  expect(onSelect).not.toHaveBeenCalled()
})
it('selects a row directly and supports keyboard dismissal', async () => {
  await click('[data-role-action="role:r2"]')
  expect(onSelect).toHaveBeenLastCalledWith(roles[1])
  await click('[data-arkme-self-role-trigger]')
  await act(async () => document.querySelector('[data-role-action="me"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
  expect(document.activeElement?.getAttribute('data-role-action')).toBe('role:r1')
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(document.querySelector('[aria-label="选择发言角色"]')).toBeNull()
  expect(document.activeElement?.hasAttribute('data-arkme-self-role-trigger')).toBe(true)
})
it('closes on outside pointer and does not nest buttons', async () => {
  await act(async () => document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })))
  expect(document.querySelector('[aria-label="选择发言角色"]')).toBeNull()
})
it('Escape dismisses management before the role picker', async () => {
  await click('[aria-label="管理旅行我"]')
  await act(async () => document.querySelector('[role="menuitem"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(document.querySelector('[role="menu"][aria-label="角色操作"]')).toBeNull()
  expect(document.querySelector('[aria-label="选择发言角色"]')).not.toBeNull()
  expect(document.activeElement?.getAttribute('aria-label')).toBe('管理旅行我')
})
it('deleting the current role clears selection through the directory owner', async () => {
  call.mockImplementation(async (method: string) => method === 'self-roles.list' ? [roles[1]] : undefined)
  await click('[aria-label="管理理性我"]')
  await click('[role="menuitem"][aria-label="删除"]')
  expect(onSelect).toHaveBeenCalledWith(undefined)
})
