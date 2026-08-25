import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildArkmePluginUpdateRow, updateVersionText } from '../src/client/ArkmeSettingsSurface.js'

describe('Arkme settings policy', () => {
  it('hides the latest version label when current and latest versions match', () => {
    expect(updateVersionText('v0.1.10', 'v0.1.10')).toBe('当前 v0.1.10 · 已是最新版本')
    expect(updateVersionText('v0.1.10', 'v0.1.11')).toBe('当前 v0.1.10 → 最新 v0.1.11')
    expect(updateVersionText('v0.1.10', 'v…')).toBe('当前 v0.1.10')
    expect(updateVersionText('v…', 'v…')).toBe('当前版本读取中…')
  })

  it('projects an available core-plugin update without APP update state', () => {
    expect(buildArkmePluginUpdateRow({
      plugin: { availability: 'available', installedVersion: '0.1.10', latestVersion: '0.1.11' },
    })).toEqual({
      label: '核心插件', current: 'v0.1.10', latest: 'v0.1.11',
      action: 'install', feedback: '发现新版本，可以立即更新',
    })
  })

  it('keeps plugin checks actionable when no update is known', () => {
    expect(buildArkmePluginUpdateRow({
      plugin: { availability: 'current', installedVersion: '0.1.10' },
    })).toEqual({
      label: '核心插件', current: 'v0.1.10', latest: 'v…',
      action: 'check', feedback: '已检查 · 当前已是最新版本',
    })
  })

  it('keeps notification permission activity separate from logout activity', () => {
    const source = readFileSync(new URL('../src/client/ArkmeSettingsSurface.tsx', import.meta.url), 'utf8')

    expect(source).toContain('const [logoutBusy, setLogoutBusy] = useState(false)')
    expect(source).toContain('const [notificationBusy, setNotificationBusy] = useState(false)')
    expect(source).toContain("title={logoutBusy ? '正在退出…' : '退出登录'}")
    expect(source).toContain('disabled={notificationBusy}')
    expect(source).not.toContain('const [busy, setBusy] = useState(false)')
  })

  it('reuses the existing core-plugin check state without adding an install state contract', () => {
    const source = readFileSync(new URL('../src/client/ArkmeSettingsSurface.tsx', import.meta.url), 'utf8')

    expect(buildArkmePluginUpdateRow({
      plugin: { availability: 'current', installedVersion: '0.1.10' },
      pluginBusy: true,
    })).toMatchObject({ action: 'busy', feedback: '正在检查更新…' })

    expect(buildArkmePluginUpdateRow({
      plugin: { availability: 'unknown', installedVersion: '0.1.10' },
      pluginError: '无法连接更新服务',
    }).feedback).toBe('检查失败：无法连接更新服务')
    expect(source).not.toContain('isArkmePluginInstallBusy')
    expect(source).not.toContain('pluginInstallError')
    expect(source).not.toContain('pluginInstallBusy?:')
  })

  it('surfaces a remote plugin failure even with a cached current version', () => {
    expect(buildArkmePluginUpdateRow({
      plugin: { availability: 'current', installedVersion: '0.1.10', checkFailed: true },
    }).feedback).toBe('检查失败：请稍后重试')
  })

  it('keeps legacy update paths out of the account settings surface', () => {
    const source = readFileSync(new URL('../src/client/ArkmeSettingsSurface.tsx', import.meta.url), 'utf8')
    expect(source).not.toContain('复制更新命令')
    expect(source).not.toContain('arkmeAppUpdateStore')
    expect(source).not.toContain('ArkmeAppUpdateSnapshot')
  })
})
