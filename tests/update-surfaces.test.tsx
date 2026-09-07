import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ArkmePluginUpdateStatus } from '../src/types.js'
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

describe('Arkme Demo-aligned update surfaces', () => {
  it('ignores plugin update availability and plugin install progress', () => {
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

    expect(presentation.primary).toBeUndefined()
    expect(presentation.items).toEqual([])
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

    expect(presentation.primary).toBeUndefined()
  })

  it('uses real APP byte progress and remains indeterminate when total bytes are unavailable', () => {
    expect(appUpdateProgress(25, 100)).toBe(25)
    expect(appUpdateProgress(25, undefined)).toBeUndefined()
  })

  it('uses the progress layout for a downloading APP update', () => {
    const item = deriveArkmeUpdatePresentation({
      app: {
        checked: true,
        busy: true,
        error: '',
        status: {
          status: 'downloading',
          currentVersion: '0.1.18',
          latestVersion: '0.1.19',
          downloadedBytes: 49,
          totalBytes: 100,
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

    expect(markup).toContain('data-layout="progress"')
  })

  it('renders the downloaded APP state without any plugin restart action', () => {
    const item = deriveArkmeUpdatePresentation({
      app: {
        checked: true,
        busy: false,
        error: '',
        status: { status: 'downloaded', currentVersion: '0.1.18', latestVersion: '0.1.19' },
      },
    }).primary
    expect(item).toBeDefined()

    const markup = renderToStaticMarkup(<ArkmeUpdateTopCapsule
      item={item!}
      onClose={() => undefined}
      onRetry={() => undefined}
      onOpenDownloaded={() => undefined}
    />)

    expect(markup).toContain('更新包已就绪')
    expect(markup).toContain('已下载 0.1.19')
    expect(markup).toContain('打开文件夹')
    expect(markup).toContain('data-layout="action"')
    expect(markup).not.toContain('立即重启')
    expect(markup).not.toContain('稍后重启')
  })

  it('offers an explicit restart-and-install choice for a verified in-app package', () => {
    const item = deriveArkmeUpdatePresentation({
      app: {
        checked: true,
        busy: false,
        error: '',
        status: {
          status: 'downloaded',
          currentVersion: '1.2.0',
          currentVersionCode: 10,
          latestVersion: '1.1.0',
          latestVersionCode: 11,
          installMode: 'in-app',
        },
      },
    }).primary

    const markup = renderToStaticMarkup(<ArkmeUpdateTopCapsule
      item={item!}
      onClose={() => undefined}
      onRetry={() => undefined}
      onOpenDownloaded={() => undefined}
    />)

    expect(markup).toContain('稍后重启')
    expect(markup).toContain('重启并安装')
    expect(markup).toContain('data-layout="ready-action"')
    expect(markup).not.toContain('打开文件夹')
    expect(markup).not.toContain('关闭更新进度')
  })

  it('locks the capsule while the installer is starting', () => {
    const item = deriveArkmeUpdatePresentation({
      app: {
        checked: true,
        busy: true,
        error: '',
        status: {
          status: 'installing',
          currentVersion: '1.2.0',
          latestVersion: '1.3.0',
          installMode: 'in-app',
        },
      },
    }).primary
    const markup = renderToStaticMarkup(<ArkmeUpdateTopCapsule
      item={item!}
      onClose={() => undefined}
      onRetry={() => undefined}
      onOpenDownloaded={() => undefined}
    />)

    expect(markup).toContain('正在安装更新')
    expect(markup).toContain('data-layout="restarting"')
    expect(markup).not.toContain('关闭更新进度')
  })
})
