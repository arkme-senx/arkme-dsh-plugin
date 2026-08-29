import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
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

describe('Arkme product plugin update entry', () => {
  it('shows the packaged plugin version without exposing a plugin update entry', () => {
    updateState.snapshot = {
      checked: true,
      busy: false,
      error: '',
      installError: '',
      status: status(),
    }
    const availableMarkup = renderToStaticMarkup(
      <productNavigation.ArkmeProductNavigation compact={false} currentSessionId="session-1" />,
    )

    expect(availableMarkup).toContain(`data-arkme-plugin-version="${pluginManifest.version}"`)
    expect(availableMarkup).toContain(`>v${pluginManifest.version}</span>`)
    expect(availableMarkup).not.toContain('Arkme 核心插件')
    expect(availableMarkup).not.toContain('更新 Arkme 插件')
  })
})
