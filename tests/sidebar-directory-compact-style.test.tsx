import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ArkmeSourceItem } from '../src/types.js'
import { ArkmeNavigation } from '../src/client/ArkmeVirtualWorkspace.js'
import { ArkmeProductNavigation } from '../src/client/ArkmeProductNavigation.js'
import { ArkmePinnedCorner } from '../src/client/ArkmePinnedCorner.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeChatDirectory } from '../src/client/chat-directory-store.js'
import { arkmeUi } from '../src/client/ui-controller.js'

const css = readFileSync(new URL('../src/client/redesign/arkme-redesign.css', import.meta.url), 'utf8')
const compactRules = css.match(/[^{}]*\[data-arkme-directory-compact="true"\][^{}]*\{[^{}]*\}/g) ?? []
const accentRules = css.match(/[^{}]*\{[^{}]*--arkme-directory-accent:[^{}]*\}/g) ?? []
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
  it.each([false, true])('shares the rail marker and follows only the selected conversation (compact=%s)', compactDirectory => {
    const markerRules = css.match(/[^{}]*\[data-arkme-selection-marker\][^{}]*\{[^{}]*\}/g) ?? []
    for (const [label, select] of [
      ['DeepSeek Harness', () => arkmeUi.showHarness()],
      ['发给自己', () => arkmeUi.focusSendToSelf()],
      ['Arko', () => arkmeUi.showArko()],
      ['普通私聊', () => arkmeUi.selectSource(privateChat)],
      ['免打扰群聊', () => arkmeUi.selectSource(groupChat)],
    ] as const) {
      select()
      const markup = renderToStaticMarkup(<>
        <ArkmeProductNavigation compact={false} hosted />
        <ArkmeNavigation compactDirectory={compactDirectory} showHarnessEntry embeddedProductShell />
      </>)
      const dom = new JSDOM(`<style>${[...accentRules, ...markerRules].join('\n')}</style>${markup}`)
      try {
        const { document } = dom.window
        const rules = Array.from(document.styleSheets[0]!.cssRules) as CSSStyleRule[]
        const shared = rules.find(rule => rule.style.position === 'absolute')!
        expect(shared, 'navigation and conversation rows must use one marker rule').toBeDefined()
        const railMarker = document.querySelector('[data-arkme-selection-marker]')!
        const selectors = shared.selectorText.split(',').map(selector => selector.trim())
        expect(selectors.some(selector => railMarker.matches(selector))).toBe(true)
        expect(shared.style.width).toBe('2px')
        expect(shared.style.height).toBe('33px')
        expect(shared.style.getPropertyValue('border-radius')).toBe('2px')
        expect(shared.style.left).toBe('0')
        expect(shared.style.top).toBe('50%')
        expect(shared.style.transform).toBe('translateY(-50%)')
        expect(shared.style.getPropertyValue('pointer-events')).toBe('none')
        expect(shared.style.background).toBe('var(--arkme-directory-accent)')
        expect(rules.find(rule => rule.selectorText === ':root')!.style.getPropertyValue('--arkme-directory-accent')).toBe('#9eadff')
        const rows = [...document.querySelectorAll('button[role="treeitem"]')]
        // jsdom cannot compute pseudo-elements; match their originating rows.
        const marked = rows.filter(row => selectors.some(selector => selector.endsWith('::before')
          && row.matches(selector.replace(/::before$/, ''))))
        expect(marked).toHaveLength(1)
        expect(marked[0]!.textContent).toContain(label)
        expect(marked[0]!.getAttribute('aria-selected')).toBe('true')
        const selected = marked[0] as HTMLElement
        expect(selected.style.borderRadius).toBe('12.5px')
        expect(2 * Number.parseFloat(selected.style.borderRadius) + Number.parseFloat(shared.style.height))
          .toBe(Number.parseFloat(selected.style.height))
        expect(selectors.every(selector => !selector.includes(':hover'))).toBe(true)
        document.body.setAttribute('data-ds-dark-theme', '')
        const dark = rules.find(rule => rule.selectorText.startsWith('body[data-ds-dark-theme]'))!
        expect(dark.style.getPropertyValue('--arkme-directory-accent')).toBe('var(--dsw-alias-state-business-primary)')
        expect(document.body.matches(dark.selectorText)).toBe(true)
        expect(document.body.contains(railMarker) && document.body.contains(marked[0]!)).toBe(true)
      } finally { dom.window.close() }
    }
  })

  it('keeps pinned corners on the same light and dark accent as selection markers', () => {
    const markerRules = css.match(/[^{}]*\[data-arkme-selection-marker\][^{}]*\{[^{}]*\}/g) ?? []
    const dom = new JSDOM(`<style>${[...accentRules, ...markerRules].join('\n')}</style>${renderToStaticMarkup(<ArkmePinnedCorner />)}`)
    try {
      const { document } = dom.window
      const rules = Array.from(document.styleSheets[0]!.cssRules) as CSSStyleRule[]
      const marker = rules.find(rule => rule.style.position === 'absolute')!
      const corner = document.querySelector('svg')!
      expect(corner.style.fill).toBe(marker.style.background)
      expect(corner.style.fill).toBe('var(--arkme-directory-accent)')
      expect(rules.find(rule => rule.selectorText === ':root')!.style.getPropertyValue('--arkme-directory-accent')).toBe('#9eadff')
      const dark = rules.find(rule => rule.selectorText === 'body[data-ds-dark-theme]')!
      expect(dark.style.getPropertyValue('--arkme-directory-accent')).toBe('var(--dsw-alias-state-business-primary)')
      document.body.setAttribute('data-ds-dark-theme', '')
      expect(document.body.matches(dark.selectorText)).toBe(true)
      expect(document.body.contains(corner)).toBe(true)
      document.body.removeAttribute('data-ds-dark-theme')
      expect(document.body.matches(dark.selectorText)).toBe(false)
    } finally { dom.window.close() }
  })

  it.each([false, true])('keeps the entire rail selection marker inside the scroll viewport (hosted=%s)', hosted => {
    const markup = renderToStaticMarkup(<ArkmeProductNavigation compact={false} hosted={hosted} />)
    const dom = new JSDOM(markup)
    try {
      const marker = dom.window.document.querySelector<HTMLElement>('[data-arkme-selection-marker]')!
      const scroll = marker.parentElement!.parentElement!
      expect(Number.parseFloat(marker.style.left) + Number.parseFloat(scroll.style.paddingLeft)).toBe(0)
    } finally { dom.window.close() }
  })

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
        expect(row.style.paddingLeft).toBe('10px')
        expect(row.style.paddingTop).toBe('10px')
        expect(row.style.paddingBottom).toBe('10px')
        expect(row.style.gap).toBe('10px')
        expect(row.style.overflow).toBe('visible') // Preserve the independent corner badge.
        const content = row.querySelector('[data-arkme-conversation-content]')!
        expect(content).not.toBeNull()
        expect((content as HTMLElement).style.overflow).toBe('hidden')
        const titleLine = content.firstElementChild as HTMLElement
        const title = titleLine.firstElementChild as HTMLElement
        expect(titleLine.style.overflow).toBe('hidden')
        expect(title.style.flexShrink).toBe('0')
        expect(title.style.maxWidth).toBe('100%')
        expect(title.style.textOverflow).toBe('ellipsis')
        expect(title.style.fontSize).toBe('13px')
        expect(title.style.lineHeight).toBe('18px')
        expect((content as HTMLElement).style.gap).toBe('4px')
        const avatar = content.previousElementSibling as HTMLElement
        expect(avatar.style.width).toBe('38px')
        expect(avatar.style.height).toBe('38px')
        expect(avatar.style.flexShrink).toBe('0')
        expect(row.style.height).toBe('58px')
        expect(row.style.minHeight).toBe('58px')
        expect(row.getAttribute('aria-label')).toBeTruthy()
        // Check matching important rules as well: jsdom does not consistently
        // prioritize stylesheet !important over React's inline declarations.
        const rules = Array.from(document.styleSheets[0]!.cssRules) as CSSStyleRule[]
        expect(dom.window.getComputedStyle(row).justifyContent).not.toBe('center')
        expect(rules.filter(rule => row.matches(rule.selectorText))
          .some(rule => rule.style.getPropertyValue('justify-content') === 'center'
            || rule.style.getPropertyValue('gap') === '0')).toBe(false)
        for (const element of [row, content, ...Array.from(content.querySelectorAll('*'))]) {
          // Only the available text width changes; no avatar-only layout switch.
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
      const search = directory.querySelector('button[aria-label="搜索对话或消息"]')!
      expect(search.getAttribute('aria-haspopup')).toBe('dialog')
      const toolbar = search.parentElement!
      // Match the contacts toolbar's shared grid while retaining the scroll
      // viewport and full-width conversation-card layout from master.
      expect((toolbar as HTMLElement).style.margin).toBe('24px 16px 16px')
      // macOS replaces the margins with padding for its window drag region.
      // A fixed wrapper height would collapse the content and overlap row 1.
      expect((toolbar as HTMLElement).style.height).toBe('auto')
      expect(toolbar.hasAttribute('data-arkme-window-drag-directory')).toBe(true)
      expect((search as HTMLElement).style.height).toBe('40px')
      const viewport = directory.querySelector<HTMLElement>('[role="tree"]')!
      expect(viewport.style.paddingLeft).toBe('0px')
      expect(viewport.style.paddingRight).toBe('0px')
      expect(viewport.style.paddingBottom).toBe('18px')
      expect(viewport.style.scrollbarWidth).toBe('none')
      expect(viewport.parentElement!.hasAttribute('data-arkme-overlay-scroll-area')).toBe(true)
      expect(ordinary.style.borderRadius).toBe('12.5px')
      const rules = Array.from(document.styleSheets[0]!.cssRules) as CSSStyleRule[]
      for (const element of [toolbar, search, directory.querySelector('[role="tree"]')!]) {
        expect(rules.some(rule => element.matches(rule.selectorText)
          && rule.style.getPropertyValue('display') === 'none')).toBe(false)
      }
      const label = search.querySelector('span')!
      expect(rules.some(rule => label.matches(rule.selectorText)
        && rule.style.getPropertyValue('display') === 'none')).toBe(compactDirectory)
      expect(directory.querySelector('button[title="添加"]')).not.toBeNull()
    } finally { dom.window.close() }
  })
})
