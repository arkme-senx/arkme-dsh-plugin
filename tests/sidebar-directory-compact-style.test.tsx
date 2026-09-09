import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ArkmeSourceItem } from '../src/types.js'
import { ArkmeNavigation } from '../src/client/ArkmeVirtualWorkspace.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeChatDirectory } from '../src/client/chat-directory-store.js'
import { arkmeUi } from '../src/client/ui-controller.js'

const css = readFileSync(new URL('../src/client/redesign/arkme-redesign.css', import.meta.url), 'utf8')
const compactRules = css.match(/[^{}]*\[data-arkme-directory-compact="true"\][^{}]*\{[^{}]*\}/g) ?? []
const privateChat = { sourceKey: 'private-key', sourceRef: 'private-ref', kind: 'private_chat' as const,
  displayName: '普通私聊', latestPreview: '私聊摘要', activeAtMillis: 100, unreadCount: 3 } satisfies ArkmeSourceItem
const groupChat = { sourceKey: 'group-key', sourceRef: 'group-ref', kind: 'group_chat' as const,
  displayName: '免打扰群聊', latestPreview: '群聊摘要', activeAtMillis: 200, unreadCount: 2, isMuted: true } satisfies ArkmeSourceItem

beforeEach(() => {
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 7001 })
  arkmeChatDirectory.activateAccount('test:7001')
  arkmeChatDirectory.publish([privateChat, groupChat])
  arkmeChatDirectory.confirmVisibility('source', privateChat.sourceRef, false)
  arkmeChatDirectory.confirmVisibility('source', groupChat.sourceRef, false)
  arkmeUi.selectSource(privateChat)
})
afterEach(() => {
  arkmeChatDirectory.activateAccount(undefined)
  arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' })
  arkmeUi.showLogin()
})

describe('compact conversation directory styles', () => {
  it.each([
    { compactDirectory: false, unreadCount: 3 },
    { compactDirectory: true, unreadCount: 3 },
    { compactDirectory: false, unreadCount: 103 },
    { compactDirectory: true, unreadCount: 103 },
  ])('keeps real rows readable (compact=$compactDirectory, unread=$unreadCount)', ({ compactDirectory, unreadCount }) => {
    arkmeChatDirectory.publish([{ ...privateChat, unreadCount }, groupChat])
    const markup = renderToStaticMarkup(<ArkmeNavigation compactDirectory={compactDirectory} showHarnessEntry embeddedProductShell />)
    const dom = new JSDOM(`<style>${compactRules.join('\n')}</style>${markup}`)
    try {
      const { document } = dom.window
      const directory = document.querySelector('[aria-label="Arkme 会话列表"]')!
      expect(directory.getAttribute('data-arkme-directory-compact')).toBe(compactDirectory ? 'true' : null)
      const rows = Array.from(directory.querySelectorAll<HTMLButtonElement>('button[role="treeitem"]'))
      const ordinary = rows.find(row => row.getAttribute('aria-label')?.startsWith('普通私聊'))!
      expect(ordinary.closest('[data-arkme-directory-chunk]')).not.toBeNull()
      expect(ordinary.getAttribute('aria-selected')).toBe('true')
      expect(ordinary.getAttribute('aria-label')).toContain(`${unreadCount} 条未读`)
      expect(ordinary.textContent).toContain('私聊摘要')
      for (const label of ['DeepSeek Harness', '发给自己', 'Arko', '普通私聊', '免打扰群聊']) {
        const row = rows.find(row => row.textContent?.includes(label))!
        expect(row, label).toBeDefined()
        expect(row.disabled).toBe(false)
        expect(row.style.padding).toBe(ordinary.style.padding)
        expect(row.style.gap).toBe(ordinary.style.gap)
        expect(row.style.overflow).toBe('hidden')
        const content = row.children[1]!
        // Check matching important rules as well: jsdom does not consistently
        // prioritize stylesheet !important over React's inline declarations.
        const rules = Array.from(document.styleSheets[0]!.cssRules) as CSSStyleRule[]
        for (const element of [row, content, ...Array.from(content.querySelectorAll('*'))]) {
          expect(dom.window.getComputedStyle(element).display).not.toBe('none')
          expect(rules.filter(rule => element.matches(rule.selectorText))
            .some(rule => rule.style.getPropertyValue('display') === 'none')).toBe(false)
        }
      }
      const badge = ordinary.firstElementChild!.lastElementChild as HTMLElement
      expect(badge.textContent).toBe(unreadCount > 99 ? '99+' : String(unreadCount))
      expect(badge.style.position).toBe('absolute')
      const muted = rows.find(row => row.getAttribute('aria-label')?.startsWith('免打扰群聊'))!
      expect(muted.getAttribute('aria-label')).toContain('有未读消息，已免打扰')
      expect(muted.textContent).toContain('群聊摘要')
      expect(muted.firstElementChild!.lastElementChild!.textContent).toBe('')
      const search = directory.querySelector('input')!.closest('div')!
      const rules = Array.from(document.styleSheets[0]!.cssRules) as CSSStyleRule[]
      expect(rules.some(rule => search.matches(rule.selectorText)
        && rule.style.getPropertyValue('display') === 'none')).toBe(compactDirectory)
    } finally { dom.window.close() }
  })
})
