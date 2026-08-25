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

  it('uses real APP byte progress and remains indeterminate when total bytes are unavailable', () => {
    expect(appUpdateProgress(25, 100)).toBe(25)
    expect(appUpdateProgress(25, undefined)).toBeUndefined()
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
