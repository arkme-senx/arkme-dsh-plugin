import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ArkmeFooterAction, type ArkmeFooterActionProps } from '../src/client/ArkmeFooterAction.js'
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
    activate: () => undefined,
    useSessions: ((selector: (state: { current: string }) => unknown) => selector({ current: 'session-1' })),
    ...patch,
  } as ArkmeFooterActionProps
  return renderToStaticMarkup(<ArkmeFooterAction {...props} />)
}

describe('ArkmeFooterAction', () => {
  it('does not restore the legacy plugin update entry from stale update state', () => {
    const html = renderFooter({
      updateSnapshot: {
        checked: true,
        busy: false,
        error: '',
        installError: '安装失败',
        installWarning: '长时间没有进展',
        installStatusError: '状态查询不可用',
      },
      onUpdate: () => undefined,
    } as Partial<ArkmeFooterActionProps>)

    expect(html).not.toContain('查看进度')
    expect(html).not.toContain('查看状态')
    expect(html).not.toContain('查看结果')
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

  it('does not expose a plugin update marker alongside Chat unread', () => {
    const html = renderFooter({ authenticated: true, unreadCount: 12, updateStatus: availableUpdate })

    expect(html).toContain('Arkme · 12 条未读')
    expect(html).not.toContain('插件有可用更新')
    expect(html).not.toContain('data-arkme-update-level')
    expect(html).toContain('>12</span>')
  })

  it('does not raise critical plugin updates in the wide sidebar', () => {
    const html = renderFooter({
      authenticated: true,
      updateStatus: { ...availableUpdate, level: 'critical' },
    })
    expect(html).not.toContain('插件有重要更新')
    expect(html).not.toContain('data-arkme-update-level')
  })

  it('does not project an available plugin update as a sibling action', () => {
    const html = renderFooter({
      authenticated: true,
      updateStatus: { ...availableUpdate, canInstallInApp: true },
      onUpdate: () => undefined,
    })
    expect(html).not.toContain('aria-label="更新 Arkme 插件到 0.1.4"')
    expect(html).not.toContain('>更新</button>')

    const busy = renderFooter({
      authenticated: true,
      updateStatus: { ...availableUpdate, canInstallInApp: true },
      updateBusy: true,
      onUpdate: () => undefined,
    })
    expect(busy).not.toContain('>更新中…</button>')
  })
})
