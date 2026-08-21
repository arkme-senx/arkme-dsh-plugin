import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { activateArkmeFromFooter, ArkmeFooterAction, type ArkmeFooterActionProps } from '../src/client/ArkmeFooterAction.js'
import type { ArkmePluginUpdateStatus } from '../src/types.js'

const availableUpdate: ArkmePluginUpdateStatus = {
  enabled: true,
  installedVersion: '0.1.3',
  latestVersion: '0.1.4',
  availability: 'available',
  level: 'important',
  stale: false,
  checkFailed: false,
  checking: false,
  acknowledged: false,
  updateCommand: 'Arkme 应用内更新',
  canInstallInApp: false,
  installBlockedReason: 'runtime-unavailable',
  restartRequired: true,
}

function renderFooter(patch: Partial<ArkmeFooterActionProps> = {}): string {
  const props = {
    wide: true,
    toggle: () => undefined,
    expandSidebar: () => undefined,
    activate: () => undefined,
    useSessions: ((selector: (state: { current: string }) => unknown) => selector({ current: 'session-1' })),
    ...patch,
  } as ArkmeFooterActionProps
  return renderToStaticMarkup(<ArkmeFooterAction {...props} />)
}

describe('ArkmeFooterAction', () => {
  it('expands the compact host sidebar before opening Arkme', () => {
    const calls: string[] = []
    activateArkmeFromFooter(false, () => { calls.push('expand') }, () => { calls.push('toggle') }, 'session-1', true)
    expect(calls).toEqual(['expand', 'toggle'])
  })

  it('does not toggle an already-wide host sidebar', () => {
    const calls: string[] = []
    activateArkmeFromFooter(true, () => { calls.push('expand') }, () => { calls.push('toggle') }, 'session-1', true)
    expect(calls).toEqual(['toggle'])
  })
  it('shows the total Chat unread count on the right', () => {
    const html = renderFooter({ authenticated: true, unreadCount: 12 })

    expect(html).toContain('Arkme · 12 条未读')
    expect(html).toContain('>12</span>')
  })

  it('caps large unread counts and keeps logged-out state authoritative', () => {
    expect(renderFooter({ authenticated: true, unreadCount: 120 })).toContain('>99+</span>')
    expect(renderFooter({ loggedOut: true, unreadCount: 12 })).not.toContain('>12</span>')
  })

  it('shows an independent update marker without replacing Chat unread', () => {
    const html = renderFooter({ authenticated: true, unreadCount: 12, updateStatus: availableUpdate })

    expect(html).toContain('Arkme · 12 条未读 · 插件有可用更新')
    expect(html).toContain('data-arkme-update-level="important"')
    expect(html).toContain('>12</span>')
  })

  it('raises critical updates in the wide sidebar', () => {
    const html = renderFooter({
      authenticated: true,
      updateStatus: { ...availableUpdate, level: 'critical' },
    })
    expect(html).toContain('插件有重要更新')
    expect(html).toContain('data-arkme-update-level="critical"')
  })

  it('projects an available update as one compact sibling action', () => {
    const html = renderFooter({
      authenticated: true,
      updateStatus: { ...availableUpdate, canInstallInApp: true },
      onUpdate: () => undefined,
    })
    expect(html).toContain('aria-label="更新 Arkme 插件到 0.1.4"')
    expect(html).toContain('>更新</button>')
    expect(html).not.toContain('复制更新命令')
    expect(html).not.toContain('稍后提醒')

    const busy = renderFooter({
      authenticated: true,
      updateStatus: { ...availableUpdate, canInstallInApp: true },
      updateBusy: true,
      onUpdate: () => undefined,
    })
    expect(busy).toContain('>更新中…</button>')
  })
})
