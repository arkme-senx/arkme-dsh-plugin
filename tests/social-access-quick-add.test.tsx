import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { ArkmeQuickAddButton } from '../src/client/ArkmeQuickAdd.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { socialAccessStore } from '../src/client/social-access-store.js'

const api = vi.hoisted(() => ({ bound: true }))
vi.mock('../src/client/api.js', async original => ({
  ...await original<typeof import('../src/client/api.js')>(),
  callArkme: async () => ({ profile: { userId: 42, contact: { phoneMasked: api.bound ? '138****0000' : undefined } } }),
}))
// Keep the call business owner outside this test; the real group form below
// additionally verifies that a entered draft survives presentation changes.
vi.mock('../src/client/ArkmeCallSurface.js', () => ({
  ArkmeCallSurface: ({ onClose }: { onClose(): void }) => <section role="dialog"><input defaultValue="通话参与人" /><button aria-label="关闭" onClick={onClose}>关闭</button></section>,
}))
let renderer: ReactTestRenderer | undefined
afterEach(() => {
  act(() => renderer?.unmount()); renderer = undefined
  socialAccessStore.activate(undefined)
  arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' })
  api.bound = true
})
it.each(['创建群聊', '发起通话'])('keeps an already opened %s dialog while hiding new social actions', async label => {
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
  await act(async () => { renderer = create(<ArkmeQuickAddButton onContactAdd={vi.fn()} onSourceCreated={vi.fn()} />) })
  const openMenu = async () => { await act(async () => { renderer!.root.findByProps({ 'aria-haspopup': 'menu' }).props.onClick() }) }
  await openMenu()
  const action = renderer!.root.findAllByProps({ role: 'menuitem' }).find(item => item.findAll(node => node.children.includes(label)).length > 0)!
  await act(async () => { action.props.onClick() })
  const dialog = renderer!.root.findByProps({ role: 'dialog' })
  const draft = renderer!.root.findByType('input')
  if (label === '创建群聊') await act(async () => { draft.props.onChange({ target: { value: '保留群聊草稿' } }) })
  api.bound = false
  await act(async () => { await socialAccessStore.refresh() })
  expect(renderer!.root.findByProps({ role: 'dialog' })).toBe(dialog)
  expect(renderer!.root.findByType('input')).toBe(draft)
  if (label === '创建群聊') expect(draft.props.value).toBe('保留群聊草稿')
  await act(async () => { dialog.findByProps({ 'aria-label': '关闭' }).props.onClick() })
  await openMenu()
  const text = JSON.stringify(renderer!.toJSON())
  for (const hidden of ['添加联系人', '创建群聊', '发起通话']) expect(text).not.toContain(hidden)
  expect(text).toContain('添加 Bot')
})
