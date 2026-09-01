import { describe, expect, it } from 'vitest'
import { arkmeNotificationPermissionPrompt } from '../src/client/ArkmeNotificationPermissionBanner.js'

describe('Arkme desktop notification permission prompt', () => {
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
