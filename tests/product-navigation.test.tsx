import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ArkmeProductNavigation } from '../src/client/ArkmeProductNavigation.js'
import { ArkmeSurface } from '../src/client/ArkmeSidebar.js'
import { arkmeUi } from '../src/client/ui-controller.js'

const productNavigationSource = readFileSync(
  new URL('../src/client/ArkmeProductNavigation.tsx', import.meta.url),
  'utf8',
)
const rootFrameSource = readFileSync(
  new URL('../src/client/redesign/ArkmeRootFrame.tsx', import.meta.url),
  'utf8',
)
const redesignCss = readFileSync(
  new URL('../src/client/redesign/arkme-redesign.css', import.meta.url),
  'utf8',
)
const accountMenuSource = readFileSync(
  new URL('../src/client/ArkmeAccountMenu.tsx', import.meta.url),
  'utf8',
)

describe('Arkme product navigation', () => {
  it('opens voiceprint management from the profile menu without removing the account entry', () => {
    expect(productNavigationSource).toContain('arkmeUi.showVoiceprint()')
    expect(productNavigationSource).toContain('<strong>声纹管理</strong>')
    expect(productNavigationSource).toContain('<strong>我的账户</strong>')
  })

  it('dismisses the profile menu when pressing Escape or clicking outside it in every desktop layout', () => {
    for (const source of [productNavigationSource, rootFrameSource]) {
      expect(source).toContain("document.addEventListener('pointerdown', dismiss, true)")
      expect(source).toContain("document.addEventListener('keydown', dismissOnEscape)")
      expect(source).toContain('profileTriggerRef.current?.contains(event.target)')
      expect(source).toContain('profilePopoverRef.current?.contains(event.target)')
    }
  })

  it('does not imply an account presence state without real presence data', () => {
    expect(redesignCss).not.toContain('.arkme-redesign-profile::after')
    expect(accountMenuSource).not.toContain('styles.presence')
  })

  it('renders only inside an explicitly Arkme-owned boundary', () => {
    arkmeUi.showSearch()
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
    expect(markup).toContain('>录音<')
    expect(markup).toContain('>搜索<')
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

  it('uses a horizontal layout contract for compact surfaces', () => {
    const markup = renderToStaticMarkup(<ArkmeProductNavigation compact currentSessionId={undefined} />)
    expect(markup).toContain('flex-direction:row')
    expect(markup).toContain('border-bottom:1px solid #e7e7e9')
    expect(markup).not.toContain('data-arkme-owned="product-brand"')
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
})
