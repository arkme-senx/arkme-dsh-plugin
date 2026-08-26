import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ArkmeCallSurface } from '../src/client/ArkmeCallSurface.js'
import { ArkmeProductNavigation } from '../src/client/ArkmeProductNavigation.js'
import { ArkmeSurface } from '../src/client/ArkmeSidebar.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeChatDirectory } from '../src/client/chat-directory-store.js'
import { arkmeUi } from '../src/client/ui-controller.js'

const productNavigationSource = readFileSync(
  new URL('../src/client/ArkmeProductNavigation.tsx', import.meta.url),
  'utf8',
)
const persistentShellSource = readFileSync(
  new URL('../src/client/ArkmePersistentShell.tsx', import.meta.url),
  'utf8',
)
const realtimeClientEventsSource = readFileSync(
  new URL('../src/client/realtime-client-events.ts', import.meta.url),
  'utf8',
)
const redesignCss = readFileSync(
  new URL('../src/client/redesign/arkme-redesign.css', import.meta.url),
  'utf8',
)

describe('Arkme product navigation', () => {
  it('opens voiceprint management while the account entry lives in DSH settings', () => {
    expect(productNavigationSource).toContain('arkmeUi.showVoiceprint()')
    expect(productNavigationSource).toContain('<strong>声纹管理</strong>')
    expect(productNavigationSource).not.toContain('<strong>我的账户</strong>')
    expect(productNavigationSource).toContain('arkmeUi.openDshSettings()')
  })

  it('dismisses the profile menu when pressing Escape or clicking outside it in every desktop layout', () => {
    expect(productNavigationSource).toContain("document.addEventListener('pointerdown', dismiss, true)")
    expect(productNavigationSource).toContain("document.addEventListener('keydown', dismissOnEscape)")
    expect(productNavigationSource).toContain('profileTriggerRef.current?.contains(event.target)')
    expect(productNavigationSource).toContain('profilePopoverRef.current?.contains(event.target)')
  })

  it('keeps the persistent client runtime subscribed to record projection invalidations', () => {
    expect(persistentShellSource).toContain('useArkmeRealtimeClientEvents(auth, ui.authRevision, true)')
    expect(realtimeClientEventsSource).toContain("if (update.type === 'projection-invalidated')")
    expect(realtimeClientEventsSource).toContain('arkmeUi.recordChanged()')
    expect(realtimeClientEventsSource).toContain("if (update.projection !== 'record') return")
    expect(realtimeClientEventsSource).toContain('arkmeUi.chatChanged()')
  })

  it('does not imply an account presence state without real presence data', () => {
    expect(redesignCss).not.toContain('.arkme-redesign-profile::after')
  })

  it('renders only inside an explicitly Arkme-owned boundary', () => {
    arkmeUi.showConversations()
    const markup = renderToStaticMarkup(<ArkmeProductNavigation compact={false} currentSessionId="session-1" />)

    expect(markup).toContain('data-arkme-owned="product-navigation"')
    expect(markup).toContain('data-arkme-owned="product-brand"')
    expect(markup).toContain('alt="Arkme"')
    expect(markup).toContain('data-arkme-theme-image="light"')
    expect(markup).toContain('data-arkme-theme-image="dark"')
    expect(markup).toContain('width:48px;height:28px;object-fit:cover')
    expect(markup).toContain('min-height:44px')
    expect(markup.indexOf('data-arkme-owned="product-brand"')).toBeLessThan(markup.indexOf('>对话<'))
    expect(markup).toContain('background:#9eadff')
    expect(markup).toContain('aria-label="Arkme 功能导航"')
    expect(markup).toContain('>对话<')
    expect(markup).toContain('>通话<')
    expect(markup).toContain('>录音<')
    expect(markup).not.toContain('>搜索<')
    expect(markup).toContain('>日历<')
    expect(markup).toContain('>世界<')
    expect(markup).toContain('>市集<')
    expect(markup).toContain('aria-current="page"')
    expect(markup).toContain('background:#f1f2f6')
    expect(markup).not.toContain('outline:0')
    expect(markup).toContain('height:33px')
    expect(markup).not.toContain('data-slot="conversation"')
    expect(markup).not.toContain('data-slot="sidebar.footer.action"')
  })

  it('removes the standalone Search tab from product navigation', () => {
    expect(productNavigationSource).not.toContain("{ id: 'search', label: '搜索'")
    expect(productNavigationSource).not.toContain("else if (id === 'search')")
  })

  it('uses a horizontal layout contract for compact surfaces', () => {
    const markup = renderToStaticMarkup(<ArkmeProductNavigation compact currentSessionId={undefined} />)
    expect(markup).toContain('flex-direction:row')
    expect(markup).toContain('border-bottom:1px solid #e7e7e9')
    expect(markup).not.toContain('data-arkme-owned="product-brand"')
  })

  it('shows the conversation unread indicator from the existing account-scoped directory state', () => {
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 901 })
    arkmeChatDirectory.activateAccount(901)
    arkmeChatDirectory.publish([{
      sourceRef: 'private-chat-1', kind: 'private_chat', displayName: '小林',
      activeAtMillis: 1, unreadCount: 60,
    }, {
      sourceRef: 'group-chat-1', kind: 'group_chat', displayName: '产品群',
      activeAtMillis: 2, unreadCount: 50,
    }, {
      sourceRef: 'muted-group-chat-1', kind: 'group_chat', displayName: '免打扰群',
      activeAtMillis: 3, unreadCount: 80, isMuted: true,
    }])

    const unreadMarkup = renderToStaticMarkup(<ArkmeProductNavigation compact={false} />)
    expect(unreadMarkup).toContain('aria-label="对话，110 条未读"')
    expect(unreadMarkup).toContain('data-arkme-conversation-unread="110"')
    expect(unreadMarkup.match(/data-arkme-unread-indicator/g)).toHaveLength(1)
    expect(unreadMarkup).toContain('data-arkme-unread-count="110"')
    expect(unreadMarkup).toMatch(/data-arkme-unread-count="110"[^>]*>99\+<\/span>/)
    expect(unreadMarkup).toContain('background:#ff5a52')

    arkmeChatDirectory.publish([])
    const readMarkup = renderToStaticMarkup(<ArkmeProductNavigation compact={false} />)
    expect(readMarkup).not.toContain('data-arkme-unread-indicator')

    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'prod', userId: 1 })
    arkmeChatDirectory.activateAccount(1)
  })

  it('fits the permanent DSH sidebar seat without rendering official sidebar chrome', () => {
    const markup = renderToStaticMarkup(<ArkmeProductNavigation hosted compact={false} currentSessionId="session-1" />)
    expect(markup).toContain('width:100%')
    expect(markup).toContain('padding:28px 4px 12px')
    expect(markup).toContain('min-height:52px')
    expect(markup).toContain('aria-label="Arkme 功能导航"')
    expect(markup).not.toContain('DSH')
  })

  it('composes the desktop client as navigation, directory, and main content inside one plugin surface', () => {
    arkmeUi.showConversations()
    const markup = renderToStaticMarkup(<ArkmeSurface
      floating
      initialAuth={{ status: 'authenticated', environment: 'prod', userId: 1 }}
      currentSessionId="session-1"
    />)

    const productNavigation = markup.indexOf('data-arkme-owned="product-navigation"')
    const directoryPane = markup.indexOf('data-arkme-owned="directory-pane"')
    const mainRegion = markup.indexOf('role="region"')
    expect(productNavigation).toBeGreaterThanOrEqual(0)
    expect(directoryPane).toBeGreaterThan(productNavigation)
    expect(mainRegion).toBeGreaterThan(directoryPane)
    expect(markup).toContain('data-arkme-layout="product-directory"')
    expect(markup).not.toContain('id="arkme-footer-directory"')

    arkmeUi.showArko()
    const arkoMarkup = renderToStaticMarkup(<ArkmeSurface
      floating
      initialAuth={{ status: 'authenticated', environment: 'prod', userId: 1 }}
      currentSessionId="session-1"
    />)
    expect(arkoMarkup).toContain('data-arkme-owned="directory-pane"')
    expect(arkoMarkup).toContain('aria-label="Arkme 会话列表"')
  })

  it('lets the permanent conversation owner render directory and content without duplicating the product rail', () => {
    arkmeUi.showConversations()
    const markup = renderToStaticMarkup(<ArkmeSurface
      productNavigation={false}
      initialAuth={{ status: 'authenticated', environment: 'prod', userId: 1 }}
      currentSessionId="session-1"
    />)
    expect(markup).not.toContain('data-arkme-owned="product-navigation"')
    expect(markup).toContain('data-arkme-owned="directory-pane"')
    expect(markup).toContain('role="region"')
  })

  it('keeps the conversation visible under the calendar overlay and removes it from standalone utility pages', () => {
    arkmeUi.showSearch()
    const searchMarkup = renderToStaticMarkup(<ArkmeSurface
      initialAuth={{ status: 'authenticated', environment: 'prod', userId: 1 }}
    />)
    expect(searchMarkup).not.toContain('data-arkme-owned="directory-pane"')
    expect(searchMarkup).toContain('>一句话，找到所有内容<')

    arkmeUi.showConversations()
    arkmeUi.showCalendar()
    const calendarMarkup = renderToStaticMarkup(<ArkmeSurface
      initialAuth={{ status: 'authenticated', environment: 'prod', userId: 1 }}
    />)
    expect(calendarMarkup).toContain('data-arkme-owned="directory-pane"')
    expect(arkmeUi.getSnapshot()).toMatchObject({ mode: 'source', calendarOpen: true })

    arkmeUi.showExtensions()
    const pluginMarkup = renderToStaticMarkup(<ArkmeSurface
      initialAuth={{ status: 'authenticated', environment: 'prod', userId: 1 }}
    />)
    expect(pluginMarkup).not.toContain('data-arkme-owned="directory-pane"')
    expect(pluginMarkup).toContain('aria-label="Arkme 市集"')
    expect(pluginMarkup).toContain('>市集<')

    arkmeUi.showWorld()
    const worldMarkup = renderToStaticMarkup(<ArkmeSurface
      initialAuth={{ status: 'authenticated', environment: 'prod', userId: 1 }}
    />)
    expect(worldMarkup).toContain('data-arkme-owned="world-surface"')
    expect(worldMarkup).not.toContain('data-arkme-owned="directory-pane"')
    expect(worldMarkup).not.toContain('aria-label="发送消息"')

    arkmeUi.showVoiceprint()
    const voiceprintMarkup = renderToStaticMarkup(<ArkmeSurface
      initialAuth={{ status: 'authenticated', environment: 'prod', userId: 1 }}
    />)
    expect(voiceprintMarkup).toContain('data-arkme-owned="voiceprint-surface"')
    expect(voiceprintMarkup).not.toContain('data-arkme-owned="directory-pane"')
  })

  it('renders the call surface empty state and call browser controls', () => {
    const markup = renderToStaticMarkup(<ArkmeCallSurface />)

    expect(markup).toContain('aria-label="通话"')
    expect(markup).toContain('>通话<')
    expect(markup).toContain('让每一次重要的声音与相见，都能被好好记住。')
    expect(markup).toContain('placeholder="搜索通话记录"')
    expect(markup).toContain('>最近联系人<')
    expect(markup).toContain('>从一次问候开始<')
    expect(markup).toContain('找一位想联系的人，聊过的声音和画面会留在这里。')
    expect(markup).toContain('>发起通话<')
  })

  it('renders the call contact picker as the start-call recovery path', () => {
    const markup = renderToStaticMarkup(<ArkmeCallSurface initialPickerOpen />)

    expect(markup).toContain('aria-label="选择通话联系人"')
    expect(markup).toContain('aria-label="搜索私聊联系人"')
    expect(markup).toContain('placeholder="输入即我号或昵称"')
    expect(markup).toContain('>最近联系人<')
    expect(markup).toContain('没有可呼叫联系人')
    expect(markup).toContain('先在对话里建立私聊后，就可以从这里发起通话。')
    expect(markup).not.toContain('和阿森语音通话')
    expect(markup).not.toContain('和阿森视频通话')
  })
})
