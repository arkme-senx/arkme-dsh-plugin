import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ArkmePluginUpdateStatus } from '../src/types.js'
import type { ArkmePluginUpdateStoreSnapshot } from '../src/client/plugin-update-store.js'
import {
  ArkmeUpdateTopCapsule,
  appUpdateProgress,
  deriveArkmeUpdatePresentation,
} from '../src/client/ArkmeUpdateSurfaces.js'

const pluginStatus: ArkmePluginUpdateStatus = {
  enabled: true,
  installedVersion: '0.1.21',
  latestVersion: '0.1.22',
  availability: 'available',
  level: 'normal',
  summary: '后台更新：下载期间可以继续工作。\n稳定性优化：修复已知问题。',
  stale: false,
  checkFailed: false,
  checking: false,
  acknowledged: false,
  updateCommand: 'Arkme 应用内更新',
  canInstallInApp: true,
  restartRequired: true,
}

const succeededPlugin: ArkmePluginUpdateStoreSnapshot = {
  checked: true, busy: false, error: '', installError: '', status: pluginStatus,
  install: {
    schemaVersion: 1, jobId: 'completed-job', phase: 'succeeded',
    previousVersion: '0.1.21', targetVersion: '0.1.22',
    message: '新版本已安装', updatedAtMillis: 1,
  },
}

describe('Arkme Demo-aligned update surfaces', () => {
  it.each(['preparing', 'downloading', 'verifying', 'installing', 'restarting'] as const)(
    'does not show a stale %s response after the target version is already running', phase => {
      const plugin = {
        ...succeededPlugin,
        status: { ...pluginStatus, installedVersion: '0.1.22', availability: 'current' as const },
        install: { ...succeededPlugin.install!, phase },
      }
      expect(deriveArkmeUpdatePresentation({ app: { checked: true, busy: false, error: '' }, plugin }).items).toEqual([])
      const newer = deriveArkmeUpdatePresentation({
        app: { checked: true, busy: false, error: '' },
        plugin: { ...plugin, status: { ...plugin.status, latestVersion: '0.1.23', availability: 'available' } },
      }).primary
      expect(newer).toMatchObject({ active: false, available: true, latestVersion: '0.1.23' })
    },
  )

  it.each([undefined, '0.1.21', '0.1.22'])('hides a completed plugin job even with stale latest version %s', latestVersion => {
    const presentation = deriveArkmeUpdatePresentation({
      app: { checked: true, busy: false, error: '' },
      plugin: {
        ...succeededPlugin,
        // Startup checks can still be in flight when install-status returns success.
        busy: true,
        status: latestVersion === undefined ? undefined : { ...pluginStatus, latestVersion },
      },
    })
    expect(presentation.items).toEqual([])
    expect(presentation.primary).toBeUndefined()
  })

  it('does not let an old success hide a genuinely newer release', () => {
    const presentation = deriveArkmeUpdatePresentation({
      app: { checked: true, busy: false, error: '' },
      plugin: { ...succeededPlugin, status: { ...pluginStatus, installedVersion: '0.1.22', latestVersion: '0.1.23' } },
    })
    expect(presentation.primary).toMatchObject({
      target: 'plugin', instanceKey: 'plugin:0.1.23', available: true,
      active: false, ready: false, latestVersion: '0.1.23',
    })
    expect(presentation.primary?.phase).toBeUndefined()
  })

  it('keeps an APP installer actionable when the plugin installation has succeeded', () => {
    const presentation = deriveArkmeUpdatePresentation({
      app: { checked: true, busy: false, error: '', status: { status: 'downloaded', currentVersion: '0.1.20', latestVersion: '0.1.22' } },
      plugin: succeededPlugin,
    })
    expect(presentation.items).toHaveLength(1)
    expect(presentation.primary).toMatchObject({ target: 'app', ready: true })
    const markup = renderToStaticMarkup(<ArkmeUpdateTopCapsule
      item={presentation.primary!} onClose={() => undefined} onRetry={() => undefined} onOpenDownloaded={() => undefined}
    />)
    expect(markup).toContain('安装包已下载')
    expect(markup).toContain('打开文件夹')
    expect(markup).toContain('data-layout="action"')
  })

  it('projects existing plugin phases into UI-only progress without changing the install owner', () => {
    const presentation = deriveArkmeUpdatePresentation({
      app: { checked: true, busy: false, error: '' },
      plugin: {
        checked: true,
        busy: false,
        error: '',
        installError: '',
        status: pluginStatus,
        install: {
          schemaVersion: 1,
          jobId: 'job-1',
          phase: 'installing',
          previousVersion: '0.1.21',
          targetVersion: '0.1.22',
          message: '正在安装 0.1.22…',
          updatedAtMillis: 1,
        },
      },
    })

    expect(presentation.primary).toMatchObject({
      target: 'plugin', active: true, progress: 78, phase: 'installing',
      notes: [
        { title: '后台更新', detail: '下载期间可以继续工作。' },
        { title: '稳定性优化', detail: '修复已知问题。' },
      ],
    })
  })

  it('does not present a slow update check as an install stuck at 8%', () => {
    const presentation = deriveArkmeUpdatePresentation({
      app: { checked: true, busy: false, error: '' },
      plugin: {
        checked: true,
        busy: true,
        error: '',
        installError: '',
        status: pluginStatus,
      },
    })

    expect(presentation.primary).toMatchObject({
      target: 'plugin', available: true, active: false,
    })
    expect(presentation.primary?.progress).toBeUndefined()
  })

  it('uses real APP byte progress and remains indeterminate when total bytes are unavailable', () => {
    expect(appUpdateProgress(25, 100)).toBe(25)
    expect(appUpdateProgress(25, undefined)).toBeUndefined()
  })

  it('shows recovery instead of restart progress when monitoring the old job times out', () => {
    const item = deriveArkmeUpdatePresentation({
      app: { checked: true, busy: false, error: '' },
      plugin: {
        ...succeededPlugin,
        install: { ...succeededPlugin.install!, phase: 'restarting' },
        installError: '等待 DSH 重启超时',
      },
    }).primary!
    expect(item).toMatchObject({ active: false, restarting: false, failed: true })
    const markup = renderToStaticMarkup(<ArkmeUpdateTopCapsule
      item={item} onClose={() => {}} onRetry={() => {}} onOpenDownloaded={() => {}}
    />)
    expect(markup).toContain('等待 DSH 重启超时')
    expect(markup).toContain('data-layout="action"')
    expect(markup).toContain('重新尝试')
    expect(markup).not.toContain('正在自动重启')
  })

  it('keeps baseline automatic restart and does not render a manual restart action', () => {
    const item = deriveArkmeUpdatePresentation({
      app: { checked: true, busy: false, error: '' },
      plugin: {
        checked: true,
        busy: false,
        error: '',
        installError: '',
        status: pluginStatus,
        install: {
          schemaVersion: 1,
          jobId: 'job-1',
          phase: 'restarting',
          previousVersion: '0.1.21',
          targetVersion: '0.1.22',
          message: '安装完成，正在由 Arkme 重启 DSH…',
          updatedAtMillis: 1,
        },
      },
    }).primary
    expect(item).toBeDefined()

    const markup = renderToStaticMarkup(<ArkmeUpdateTopCapsule
      item={item!}
      onClose={() => undefined}
      onRetry={() => undefined}
      onOpenDownloaded={() => undefined}
    />)

    expect(markup).toContain('正在自动重启…')
    expect(markup).toContain('即将打开新版本')
    expect(markup).not.toContain('立即重启')
    expect(markup).not.toContain('稍后重启')
    expect(markup).not.toContain('关闭更新进度')
  })
})
