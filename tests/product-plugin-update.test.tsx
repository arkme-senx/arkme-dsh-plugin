import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArkmePluginUpdateStatus } from '../src/types.js'

const updateState = vi.hoisted(() => ({
  snapshot: {
    checked: true,
    busy: false,
    error: '',
    installError: '',
  } as {
    checked: boolean
    busy: boolean
    error: string
    installError: string
    status?: ArkmePluginUpdateStatus
  },
}))

vi.mock('../src/client/plugin-update-store.js', () => ({
  arkmePluginUpdateStore: {
    subscribe: () => () => undefined,
    getSnapshot: () => updateState.snapshot,
    install: vi.fn(async () => undefined),
  },
}))

import * as productNavigation from '../src/client/ArkmeProductNavigation.js'
import { ArkmePluginUpdateDialog } from '../src/client/ArkmePluginUpdateDialog.js'
import pluginManifest from '../package.json' with { type: 'json' }

function status(patch: Partial<ArkmePluginUpdateStatus> = {}): ArkmePluginUpdateStatus {
  return {
    enabled: true,
    installedVersion: '0.1.16',
    latestVersion: '0.1.17',
    availability: 'available',
    level: 'normal',
    title: '性能与稳定性更新',
    summary: '修复消息同步问题，并优化插件启动速度。',
    releaseNotesUrl: 'https://www.arkme.ai/releases/0.1.17',
    stale: false,
    checkFailed: false,
    checking: false,
    acknowledged: false,
    updateCommand: 'Arkme 应用内更新',
    canInstallInApp: true,
    restartRequired: true,
    ...patch,
  }
}

beforeEach(() => {
  updateState.snapshot = {
    checked: true,
    busy: false,
    error: '',
    installError: '',
    status: status(),
  }
})

describe('Arkme product plugin update entry', () => {
  it('shows the installed plugin version below the logo and a red new-version action only when an update exists', () => {
    const availableMarkup = renderToStaticMarkup(
      <productNavigation.ArkmeProductNavigation compact={false} currentSessionId="session-1" />,
    )

    expect(availableMarkup).toContain('data-arkme-plugin-version="0.1.16"')
    expect(availableMarkup).toContain('>v0.1.16</span>')
    expect(availableMarkup).toContain('aria-label="查看插件新版本 0.1.17"')
    expect(availableMarkup).toContain('background:#ef4444')
    expect(availableMarkup).toContain('>新版本</button>')

    updateState.snapshot = { ...updateState.snapshot, status: status({ availability: 'current', latestVersion: '0.1.16' }) }
    const currentMarkup = renderToStaticMarkup(
      <productNavigation.ArkmeProductNavigation compact={false} currentSessionId="session-1" />,
    )

    expect(currentMarkup).toContain('>v0.1.16</span>')
    expect(currentMarkup).not.toContain('>新版本</button>')
  })

  it('shows the packaged plugin version while the first update status request is still loading', () => {
    updateState.snapshot = { checked: false, busy: false, error: '', installError: '' }

    const markup = renderToStaticMarkup(
      <productNavigation.ArkmeProductNavigation compact={false} currentSessionId="session-1" />,
    )

    expect(markup).toContain(`data-arkme-plugin-version="${pluginManifest.version}"`)
    expect(markup).toContain(`>v${pluginManifest.version}</span>`)
  })

  it('presents release content and the confirmed update-and-restart action in the dialog', () => {
    const markup = renderToStaticMarkup(<ArkmePluginUpdateDialog
      status={status({ title: '插件更新' })}
      busy={false}
      error=""
      onDismiss={() => undefined}
      onInstall={() => undefined}
    />)

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('>发现插件新版本</h2>')
    expect(markup).toContain('当前 v0.1.16 → 最新 v0.1.17')
    expect(markup).toContain('>更新说明</h3>')
    expect(markup).not.toContain('>插件更新</h3>')
    expect(markup).toContain('修复消息同步问题，并优化插件启动速度。')
    expect(markup).toContain('>稍后</button>')
    expect(markup).toContain('>更新并重启</button>')
  })

  it('keeps update-and-restart unavailable when the current runtime cannot install in app', () => {
    const markup = renderToStaticMarkup(<ArkmePluginUpdateDialog
      status={status({ canInstallInApp: false, installBlockedReason: 'local-install' })}
      busy={false}
      error=""
      onDismiss={() => undefined}
      onInstall={() => undefined}
    />)

    expect(markup).toContain('当前为本地开发插件，不能在应用内覆盖更新。')
    expect(markup).toContain('<button type="button" disabled=""')
    expect(markup).toContain('>更新并重启</button>')
  })
})
