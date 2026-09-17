import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer'
import { afterEach, expect, it } from 'vitest'
import { CodexDispatchEntry } from '../src/client/redesign/contacts/CodexDispatchEntry.js'
import { connectArkmeLocale } from '../src/client/locale.js'
let renderer: ReactTestRenderer | undefined
afterEach(() => { act(() => renderer?.unmount()); connectArkmeLocale({ getLocale: () => ({ active: 'zh' }), subscribe: () => () => {} })() })
const text = (node: ReactTestInstance): string => node.children.map(child => typeof child === 'string' ? child : text(child)).join('')
const mount = (mode: 'local' | 'remote' | 'readonly' = 'local') => act(() => { renderer = create(<CodexDispatchEntry scopeKey="account/team/source/task" mode={mode}/>) })
const open = () => act(() => renderer!.root.findByType('textarea').props.onClick())
it('opens an honest standalone-helper explanation without install, permission or send actions', () => {
  mount(); open()
  const dialog = renderer!.root.findByProps({ role: 'dialog' })
  expect(text(dialog)).toContain('无需修改 Arkme 客户端')
  expect(text(dialog)).toContain('当前验证版尚未接通 Arkme 接单')
  expect(dialog.props['aria-modal']).toBe('true')
  expect(dialog.findAllByType('button').map(node => text(node))).toEqual(['×', '知道了'])
  expect(dialog.findAllByType('a')).toHaveLength(0)
  act(() => dialog.props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} }))
  expect(renderer!.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
})
it.each(['remote', 'readonly'] as const)('does not present a send action for %s tasks', mode => {
  mount(mode)
  expect(renderer!.root.findAllByType('textarea')).toHaveLength(0)
  expect(renderer!.root.findAllByType('button')).toHaveLength(0)
  expect(text(renderer!.root)).toContain(mode === 'remote' ? '云端派发尚未接通' : '不开放操作对方电脑')
})
it('closes setup immediately when task scope changes', () => {
  mount(); open()
  act(() => renderer!.update(<CodexDispatchEntry scopeKey="other-account/team/source/task" mode="local"/>))
  expect(renderer!.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
})
it('closes from the backdrop but not from clicks inside the dialog', () => {
  mount(); open()
  const backdrop = renderer!.root.findByProps({ className: 'arkme-contact-remark-backdrop' })
  act(() => backdrop.props.onMouseDown({ target: {}, currentTarget: {} }))
  expect(renderer!.root.findAllByProps({ role: 'dialog' })).toHaveLength(1)
  const target = {}
  act(() => backdrop.props.onMouseDown({ target, currentTarget: target }))
  expect(renderer!.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
})
it('translates the composer and setup guide into English', () => {
  connectArkmeLocale({ getLocale: () => ({ active: 'en' }), subscribe: () => () => {} })()
  mount(); open()
  expect(text(renderer!.root)).toContain('Connect Codex helper')
  expect(text(renderer!.root)).not.toMatch(/[\u4e00-\u9fff]/)
})
