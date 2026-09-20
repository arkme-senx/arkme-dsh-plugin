import { readUiSource } from './helpers/ui-source.js'
import { describe, expect, it } from 'vitest'
import {
  arkmeNotificationPermissionLabel,
  buildArkmeAppUpdateRow,
  updateVersionText,
} from '../src/client/ArkmeSettingsSurface.js'

describe('Arkme settings policy', () => {
  it('does not report an Electron bridge without permission introspection as granted', () => {
    expect(arkmeNotificationPermissionLabel('system-managed')).toBe('由系统管理')
    expect(arkmeNotificationPermissionLabel('granted')).toBe('已开启')
    expect(arkmeNotificationPermissionLabel('denied')).toBe('系统通知未开启，点击前往设置')
    expect(arkmeNotificationPermissionLabel('default')).toBe('尚未授权，点击开启')
  })

  it('hides the latest version label when current and latest versions match', () => {
    expect(updateVersionText('v0.1.10', 'v0.1.10')).toBe('当前 v0.1.10 · 已是最新版本')
    expect(updateVersionText('v0.1.10', 'v0.1.11')).toBe('当前 v0.1.10 → 最新 v0.1.11')
    expect(updateVersionText('v0.1.10', 'v…')).toBe('当前 v0.1.10')
    expect(updateVersionText('v…', 'v…')).toBe('当前版本读取中…')
  })

  it('projects an available APP update from the shell-owned state', () => {
    expect(buildArkmeAppUpdateRow({
      app: { status: 'available', currentVersion: '1.2.0', latestVersion: '1.3.0' },
    })).toEqual({
      label: 'APP', current: 'v1.2.0', latest: 'v1.3.0',
      feedback: '发现新版本 v1.3.0',
    })
  })

  it('keeps downloaded APP state read-only in settings', () => {
    expect(buildArkmeAppUpdateRow({
      app: {
        status: 'downloaded',
        currentVersion: '1.2.0',
        latestVersion: '1.3.0',
      },
    })).toEqual({
      label: 'APP', current: 'v1.2.0', latest: 'v1.3.0',
      feedback: '更新已下载，前往 APP 更新继续',
    })
  })

  it('shows the required client-upgrade message when the shell bridge is unavailable', () => {
    expect(buildArkmeAppUpdateRow({
      appError: '请升级 Arkme 客户端',
    })).toEqual({
      label: 'APP', current: 'v…', latest: 'v…',
      feedback: '请升级 Arkme 客户端',
    })
  })

  it('keeps notification permission activity separate from logout activity', () => {
    const source = readUiSource(new URL('../src/client/ArkmeSettingsSurface.tsx', import.meta.url), 'utf8')

    expect(source).toContain('const [logoutBusy, setLogoutBusy] = useState(false)')
    expect(source).toContain('const [notificationBusy, setNotificationBusy] = useState(false)')
    expect(source).toContain("{logoutBusy ? '正在退出…' : '退出登录'}</button>")
    expect(source).toContain('disabled={notificationBusy}')
    expect(source).not.toContain('const [busy, setBusy] = useState(false)')
  })

  it('shows a read-only plugin version without exposing update controls or polling', () => {
    const source = readUiSource(new URL('../src/client/ArkmeSettingsSurface.tsx', import.meta.url), 'utf8')
    expect(source).not.toContain('arkmePluginUpdateStore')
    expect(source).toContain('title="ArkME 插件"')
    expect(source).not.toContain("arkmeUpdateUi.open('plugin')")
  })

  it('keeps one shell-owned APP update entry without restoring plugin actions', () => {
    const source = readUiSource(new URL('../src/client/ArkmeSettingsSurface.tsx', import.meta.url), 'utf8')
    expect(source).not.toContain('复制更新命令')
    expect(source).toContain('arkmeAppUpdateStore')
    expect(source).toContain('ArkmeAppUpdateSnapshot')
    expect(source).toContain('actionLabel="打开 APP 更新"')
    expect(source).toContain('arkmeAppUpdateStore.open()')
    expect(source).not.toContain('arkmeUpdateUi')
    expect(source).not.toContain('arkmeAppUpdateStore.download')
    expect(source).not.toContain('arkmeAppUpdateStore.install')
    expect(source).not.toContain('arkmeAppUpdateStore.retry')
  })
})
