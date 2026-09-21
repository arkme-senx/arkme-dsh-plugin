// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { installSessionOriginHover, sessionOrigin } from '../src/client/harness-session-origin.js'
import type { DshAccountSession } from '../src/dsh-remote/account-session-types.js'
it('only describes other instances, with a computer name for a different physical desktop', () => {
  const row = { local: false, sameDesktop: true, runtimeName: 'work', desktopName: '同名电脑' } as DshAccountSession
  expect(sessionOrigin({ ...row, local: true })).toEqual([])
  expect(sessionOrigin(row)).toEqual(['实例：work'])
  expect(sessionOrigin({ ...row, sameDesktop: false })).toEqual(['实例：work', '电脑：同名电脑'])
})
it('adds source lines using the existing card typography without changing native title, status or copy', async () => {
  document.body.innerHTML = '<section data-slot="sidebar.workspaces"><div role="treeitem" aria-selected="false"><span>会话</span></div></section>'
  const row = document.querySelector<HTMLElement>('[role="treeitem"]')!
  const stop = installSessionOriginHover(document, value => value === row ? { title: '会话', lines: ['实例：web', '电脑：Windows'] } : undefined)
  row.dispatchEvent(new Event('pointerover', { bubbles: true }))
  const card = document.createElement('div'); card.setAttribute('role', 'button'); card.setAttribute('aria-label', '复制: 会话')
  card.innerHTML = '<div><div>会话</div><div class="native-time">1分钟前</div><div><span>空闲</span></div></div>'
  document.body.append(card)
  await new Promise(resolve => setTimeout(resolve, 0))
  const extra = card.querySelector('[data-arkme-session-origin]')!
  expect(extra.textContent).toBe('实例：web电脑：Windows')
  expect([...extra.children].every(node => node.className === 'native-time')).toBe(true)
  expect(card.getAttribute('aria-label')).toBe('复制: 会话')
  expect(row.textContent).toBe('会话')
  expect(card.firstElementChild?.children[2]?.textContent).toBe('空闲')
  stop(); expect(card.querySelector('[data-arkme-session-origin]')).toBeNull()
  document.body.replaceChildren()
})
