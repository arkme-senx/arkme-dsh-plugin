import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../src/client/ArkmeSettingsSurface.tsx', import.meta.url), 'utf8')
const rootSource = readFileSync(new URL('../src/client/redesign/ArkmeRootFrame.tsx', import.meta.url), 'utf8')
const redesignCss = readFileSync(new URL('../src/client/redesign/arkme-redesign.css', import.meta.url), 'utf8')

describe('ArkmeSettingsSurface', () => {
  it('keeps the baseline account, general, permissions, and about capabilities', () => {
    expect(source).toContain("callArkme<ArkmeUserProfileSnapshot>('user.profile'")
    expect(source).toContain("callArkme<ArkmeAuthSnapshot>('auth.logout')")
    expect(source).toContain('arkmeDesktopNotifications.requestPermission()')
    expect(source).toContain('个人资料')
    expect(source).toContain('登录与安全')
    expect(source).toContain('执行前确认')
    expect(source).toContain('可读取内容')
    expect(source).toContain('用户协议')
    expect(source).toContain('隐私条款')
    expect(source).toContain('模型与 API Key')
    expect(source).toContain('onOpenModels')
  })

  it('uses the Demo settings groups and widens only the DSH task conversation flow', () => {
    expect(redesignCss).toContain('.arkme-redesign-settings-group')
    expect(redesignCss).toContain('.arkme-redesign-settings-profile')
    expect(redesignCss).toContain('.arkme-redesign-task-conversation [data-chat-flow]')
    expect(redesignCss).toContain('--dsh-composer-card-max-width: calc(100% - 32px)')
    expect(redesignCss).toContain('--dsh-chat-content-width: calc(100% - 64px)')
    expect(redesignCss).toContain('max-width: none !important')
    expect(rootSource).toContain("renderSlot('settings.section'")
    expect(rootSource).toContain("{ only: 'models' }")
    expect(rootSource).toContain("authState.checked && authState.auth?.status !== 'authenticated'")
  })
})
