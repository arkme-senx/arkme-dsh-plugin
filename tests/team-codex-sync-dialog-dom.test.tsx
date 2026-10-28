// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TeamCodexSyncDialog } from '../src/client/redesign/contacts/TeamCodexSyncDialog.js'

vi.mock('../src/client/redesign/contacts/TeamCodexActivity.js', () => ({
  TeamCodexActivity: () => <section>
    <input aria-label="筛选" />
    <textarea aria-label="指令" readOnly value="同步指令" />
    <button disabled>不可用</button>
    <details><summary>说明</summary><button>收起的说明内按钮</button></details>
  </section>,
}))
const view = vi.fn()
const team = { teamRef:'team-a', name:'测试团队', jotmoId:'team_a', currentUserRole:'member' as const, createdAtMillis:1, updatedAtMillis:2 }
let host: HTMLDivElement, root: Root
function Harness() {
  const [open, setOpen] = useState(false)
  return <><button onClick={() => setOpen(true)}>Codex 同步</button><div data-members>成员列表</div>
    {open && <TeamCodexSyncDialog team={team} onClose={() => setOpen(false)} onViewConversations={view} />}</>
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  view.mockReset()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  act(() => root.render(<Harness />))
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!
function open() { host.querySelector('button')!.focus(); act(() => host.querySelector('button')!.click()) }
function key(target: HTMLElement, name: string, shiftKey = false) {
  act(() => target.dispatchEvent(new KeyboardEvent('keydown', { key:name, shiftKey, bubbles:true, cancelable:true })))
}
it('renders a named portal, restores entry focus and preserves member scroll on close', () => {
  const members = host.querySelector<HTMLElement>('[data-members]')!
  members.scrollTop = 172
  open()
  expect(host.contains(dialog())).toBe(false)
  expect(document.getElementById(dialog().getAttribute('aria-labelledby')!)?.textContent).toBe('Codex 同步 · 测试团队')
  expect(dialog().getAttribute('aria-modal')).toBe('true')
  expect(document.activeElement).toBe(dialog().querySelector('button'))
  act(() => dialog().querySelector('button')!.click())
  expect(dialog()).toBeNull()
  expect(document.activeElement).toBe(host.querySelector('button'))
  expect(host.querySelector('[data-members]')).toBe(members)
  expect(members.scrollTop).toBe(172)
})
it('includes text controls and summary in the focus boundary and closes on Escape', () => {
  open()
  const first = dialog().querySelector('button')!, last = dialog().querySelector<HTMLElement>('footer button')!
  key(first, 'Tab', true)
  expect(document.activeElement).toBe(last)
  key(last, 'Tab')
  expect(document.activeElement).toBe(first)
  const textarea = dialog().querySelector('textarea')!
  textarea.focus()
  expect(document.activeElement).toBe(textarea)
  key(textarea, 'Tab')
  expect(document.activeElement).toBe(textarea) // interior controls retain native Tab behavior
  dialog().querySelector('summary')!.focus()
  expect(document.activeElement?.tagName).toBe('SUMMARY')
  key(dialog().querySelector('summary')!, 'Escape')
  expect(dialog()).toBeNull()
})
it('dismisses only on the backdrop itself, not on content clicks', () => {
  open()
  act(() => dialog().dispatchEvent(new MouseEvent('mousedown', { bubbles:true })))
  expect(dialog()).not.toBeNull()
  act(() => dialog().parentElement!.dispatchEvent(new MouseEvent('mousedown', { bubbles:true })))
  expect(dialog()).toBeNull()
})
it('contains accidental background focus and does not leak that listener after unmount', () => {
  open()
  host.querySelector('button')!.focus()
  expect(document.activeElement).toBe(dialog().querySelector('button'))
  act(() => root.render(<button>另一个团队</button>))
  host.querySelector('button')!.focus()
  expect(dialog()).toBeNull()
  expect(document.activeElement).toBe(host.querySelector('button'))
})
it('only opens conversations on the explicit footer action', () => {
  open()
  expect(view).not.toHaveBeenCalled()
  act(() => dialog().querySelector<HTMLButtonElement>('footer button')!.click())
  expect(view).toHaveBeenCalledTimes(1)
})
