import { readFileSync } from 'node:fs'
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

  it('projects an available APP update through the existing desktop update flow', () => {
    expect(buildArkmeAppUpdateRow({
      app: { status: 'available', currentVersion: '1.2.0', latestVersion: '1.3.0' },
    })).toEqual({
      label: 'APP', current: 'v1.2.0', latest: 'v1.3.0',
      action: 'download', feedback: '发现新版本，可以下载更新包',
    })
  })

  it('opens a downloaded APP package from its existing local path', () => {
    expect(buildArkmeAppUpdateRow({
      app: {
        status: 'downloaded',
        currentVersion: '1.2.0',
        latestVersion: '1.3.0',
        downloadedFilePath: '/Users/example/Downloads/arkme-1.3.0-darwin-arm64.zip',
      },
    })).toEqual({
      label: 'APP', current: 'v1.2.0', latest: 'v1.3.0', action: 'open',
      feedback: '下载完成，可打开所在文件夹定位安装包',
      downloadedFilePath: '/Users/example/Downloads/arkme-1.3.0-darwin-arm64.zip',
    })
  })

  it('disables the APP row when the desktop update bridge is unavailable', () => {
    expect(buildArkmeAppUpdateRow({
      appError: 'APP 更新只在 Arkme 桌面端可用',
    })).toMatchObject({
      action: 'busy',
      feedback: '检查失败：APP 更新只在 Arkme 桌面端可用',
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

  it('shows a read-only plugin version without exposing update controls or polling', () => {
    const source = readFileSync(new URL('../src/client/ArkmeSettingsSurface.tsx', import.meta.url), 'utf8')
    expect(source).not.toContain('arkmePluginUpdateStore')
    expect(source).toContain('title="ArkME 插件"')
    expect(source).not.toContain("arkmeUpdateUi.open('plugin')")
  })

  it('restores the APP entry without restoring the legacy copy-command path', () => {
    const source = readFileSync(new URL('../src/client/ArkmeSettingsSurface.tsx', import.meta.url), 'utf8')
    expect(source).not.toContain('复制更新命令')
    expect(source).toContain('arkmeAppUpdateStore')
    expect(source).toContain('ArkmeAppUpdateSnapshot')
    expect(source).toContain("arkmeUpdateUi.open('app')")
    expect(source).toContain('arkmeAppUpdateStore.showDownloadedFile()')
    expect(source).toContain('arkmeAppUpdateStore.refresh(true)')
  })
})
