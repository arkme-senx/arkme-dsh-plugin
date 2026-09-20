import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ArkmeNotificationPermissionBanner, arkmeNotificationPermissionPrompt } from '../src/client/ArkmeNotificationPermissionBanner.js'
import { arkmeDesktopNotifications } from '../src/client/desktop-notification-runtime.js'

describe('Arkme desktop notification permission prompt', () => {
  it('keeps its message on one line during directory compression and retains the full tooltip', () => {
    const snapshot = vi.spyOn(arkmeDesktopNotifications, 'getPermissionSnapshot')
      .mockReturnValue({ revision: 1, permission: 'denied' })
    try {
      const markup = renderToStaticMarkup(<ArkmeNotificationPermissionBanner />)
      expect(markup).toContain('white-space:nowrap')
      expect(markup).toContain('text-overflow:ellipsis')
      expect(markup).toContain('title="系统通知未开启，可能错过新消息"')
      expect(markup).toContain('去开启')
    } finally { snapshot.mockRestore() }
  })
  it('distinguishes first authorization from a denied system permission', () => {
    expect(arkmeNotificationPermissionPrompt('default')).toEqual({
      message: '开启系统通知，及时接收新消息', action: '开启', kind: 'request',
    })
    expect(arkmeNotificationPermissionPrompt('denied')).toEqual({
      message: '系统通知未开启，可能错过新消息', action: '去开启', kind: 'settings',
    })
    expect(arkmeNotificationPermissionPrompt('granted')).toBeUndefined()
    expect(arkmeNotificationPermissionPrompt('unavailable')).toBeUndefined()
    expect(arkmeNotificationPermissionPrompt('system-managed')).toBeUndefined()
  })
})
