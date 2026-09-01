import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readClient = (name: string) => readFileSync(new URL(`../src/client/${name}`, import.meta.url), 'utf8')

describe('notification activation overlay contract', () => {
  it('closes navigation-owned overlays for every activation revision', () => {
    const source = readClient('ArkmeVirtualWorkspace.tsx')
    expect(source).toMatch(/const source = notificationActivation\.source[\s\S]*?setGlobalSearchOpen\(false\)[\s\S]*?setDirectoryContextMenu\(undefined\)/)
    expect(source).toMatch(/const source = notificationActivation\.source[\s\S]*?setTopicCreateParent\(undefined\)[\s\S]*?setTopicCreateParentLevel\(undefined\)[\s\S]*?setTopicCreateError\(''\)/)
    expect(source).toContain('notificationActivationRevision={ui.notificationActivationRevision ?? 0}')
    expect(source).toContain('onBlockingOverlayChange={setQuickAddBlockingOpen}')
    expect(source).toContain('topicCreateParent === undefined')
    expect(source).toContain('&& !quickAddBlockingOpen')
    expect(source).toContain('arkmeUi.activateNotificationSource(source)')
    expect(source).toContain('markNavigationApplied(notificationActivation.revision)')
  })

  it('closes or marks every cross-surface blocking overlay', () => {
    const search = readClient('ArkmeSearchSurface.tsx')
    const productNavigation = readClient('ArkmeProductNavigation.tsx')
    const startupGate = readClient('ArkmeStartupAuthGate.tsx')
    const conversation = readClient('ArkmeSidebar.tsx')

    expect(search).toContain('data-arkme-notification-blocking-overlay="true"')
    expect(productNavigation).toContain('setProfileOpen(false)')
    expect(productNavigation).toContain('data-arkme-notification-blocking-overlay="true"')
    expect(startupGate).toContain('data-arkme-notification-blocking-overlay="true"')
    expect(conversation).toContain('data-arkme-notification-blocking-overlay="true"')
    expect(conversation).toContain('[data-arkme-web-login-dialog="true"]')
  })
})
