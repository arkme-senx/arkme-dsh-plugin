import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { arkmeSettingsTitle } from '../src/client/ArkmeSettingsRow.js'
import { buildArkmeUpdateCenterRows, updateVersionText } from '../src/client/ArkmeSettingsSurface.js'

describe('ArkmeSettingsRow', () => {
  it('folds the installed version into the single account-row title', () => {
    expect(arkmeSettingsTitle('0.1.2')).toBe('Arkme v0.1.2')
    expect(arkmeSettingsTitle(undefined)).toBe('Arkme v…')
  })

  it('hides the latest version label when current and latest versions match', () => {
    expect(updateVersionText('v0.1.10', 'v0.1.10')).toBe('当前 v0.1.10 · 已是最新版本')
    expect(updateVersionText('v0.1.10', 'v0.1.11')).toBe('当前 v0.1.10 → 最新 v0.1.11')
  })

  it('builds one unified APP and core-plugin update center projection', () => {
    expect(buildArkmeUpdateCenterRows({
      app: { status: 'available', currentVersion: '1.2.0', latestVersion: '1.3.0' },
      plugin: { availability: 'available', installedVersion: '0.1.10', latestVersion: '0.1.11' },
    })).toEqual([
      {
        key: 'app', label: 'APP', current: 'v1.2.0', latest: 'v1.3.0',
        button: '下载更新包', action: 'download', feedback: '发现新版本，可以下载更新包',
      },
      {
        key: 'plugin', label: '核心插件', current: 'v0.1.10', latest: 'v0.1.11',
        button: '立即更新', action: 'install', feedback: '发现新版本，可以立即更新',
      },
    ])
  })

  it('shows a downloaded APP package as a local file instead of requesting a restart', () => {
    expect(buildArkmeUpdateCenterRows({
      app: {
        status: 'downloaded',
        currentVersion: '1.2.0',
        latestVersion: '1.3.0',
        downloadedFilePath: '/Users/example/Downloads/arkme-1.3.0-darwin-arm64.zip',
      },
    })[0]).toEqual({
      key: 'app', label: 'APP', current: 'v1.2.0', latest: 'v1.3.0', button: '打开所在文件夹', action: 'open',
      feedback: '下载完成，可打开所在文件夹定位安装包',
      downloadedFilePath: '/Users/example/Downloads/arkme-1.3.0-darwin-arm64.zip',
    })
  })

  it('keeps the plugin check action clickable when no update is known yet', () => {
    expect(buildArkmeUpdateCenterRows({
      app: { status: 'current', currentVersion: '1.2.0' },
      plugin: { availability: 'current', installedVersion: '0.1.10' },
    })).toEqual([
      {
        key: 'app', label: 'APP', current: 'v1.2.0', latest: 'v1.2.0',
        button: '检查更新', action: 'check', feedback: '已检查 · 当前已是最新版本',
      },
      {
        key: 'plugin', label: '核心插件', current: 'v0.1.10', latest: 'v0.1.10',
        button: '检查更新', action: 'check', feedback: '已检查 · 当前已是最新版本',
      },
    ])
  })

  it('shows an unavailable APP feed as no available version instead of a failed check', () => {
    expect(buildArkmeUpdateCenterRows({
      app: { status: 'current', currentVersion: '1.2.0', noUpdateAvailable: true },
    })[0].feedback).toBe('已检查 · 暂无可用版本')
  })

  it('surfaces a missing desktop update bridge instead of silently offering a broken action', () => {
    expect(buildArkmeUpdateCenterRows({
      appError: 'APP 更新只在 Arkme 桌面端可用',
    })[0]).toMatchObject({
      button: '当前不可用',
      action: 'busy',
      feedback: '检查失败：APP 更新只在 Arkme 桌面端可用',
    })
  })

  it('projects explicit check progress and completion feedback for both update targets', () => {
    expect(buildArkmeUpdateCenterRows({
      app: { status: 'checking', currentVersion: '1.2.0' },
      plugin: { availability: 'current', installedVersion: '0.1.10' },
      pluginBusy: true,
    })).toEqual([
      {
        key: 'app', label: 'APP', current: 'v1.2.0', latest: 'v1.2.0',
        button: '检查中…', action: 'busy', feedback: '正在检查更新…',
      },
      {
        key: 'plugin', label: '核心插件', current: 'v0.1.10', latest: 'v0.1.10',
        button: '检查中…', action: 'busy', feedback: '正在检查更新…',
      },
    ])

    expect(buildArkmeUpdateCenterRows({
      app: { status: 'current', currentVersion: '1.2.0' },
      plugin: { availability: 'current', installedVersion: '0.1.10' },
    }).map(row => row.feedback)).toEqual([
      '已检查 · 当前已是最新版本',
      '已检查 · 当前已是最新版本',
    ])
  })

  it('makes APP package download progress visible in the update center', () => {
    expect(buildArkmeUpdateCenterRows({
      app: { status: 'downloading', currentVersion: '1.2.0', latestVersion: '1.3.0' },
    })[0]).toMatchObject({
      button: '更新中…',
      action: 'busy',
      feedback: '正在下载更新包',
    })
  })

  it('makes update-check failures visible next to the affected target', () => {
    expect(buildArkmeUpdateCenterRows({
      app: { status: 'failed', currentVersion: '1.2.0', error: 'HTTP 404' },
      plugin: { availability: 'unknown', installedVersion: '0.1.10' },
      pluginError: '无法连接更新服务',
    }).map(row => row.feedback)).toEqual([
      '检查失败：HTTP 404',
      '检查失败：无法连接更新服务',
    ])
  })

  it('shows a remote plugin check failure even when a cached version is current', () => {
    expect(buildArkmeUpdateCenterRows({
      plugin: { availability: 'current', installedVersion: '0.1.10', checkFailed: true },
    })[1].feedback).toBe('检查失败：请稍后重试')
  })

  it('keeps the legacy copy-command path out of the settings row', () => {
    const source = readFileSync(new URL('../src/client/ArkmeSettingsSurface.tsx', import.meta.url), 'utf8')
    expect(source).not.toContain('复制更新命令')
  })
})
