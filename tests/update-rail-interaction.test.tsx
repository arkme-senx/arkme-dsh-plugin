import React from 'react'
import { act, create } from 'react-test-renderer'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArkmePluginUpdateStoreSnapshot } from '../src/client/plugin-update-store.js'

const state = vi.hoisted(() => ({
  app: { checked: true, busy: false, error: '' },
  plugin: {
    checked: true,
    busy: false,
    error: '',
    installError: '',
    status: {
      enabled: true,
      installedVersion: '0.1.21',
      latestVersion: '0.1.22',
      availability: 'available',
      level: 'normal',
      summary: '后台更新：下载期间可以继续工作。',
      stale: false,
      checkFailed: false,
      checking: false,
      acknowledged: false,
      updateCommand: 'Arkme 应用内更新',
      canInstallInApp: true,
      restartRequired: true,
    },
  } as ArkmePluginUpdateStoreSnapshot,
  install: vi.fn(async () => undefined),
}))

vi.mock('react-dom', () => ({ createPortal: (node: React.ReactNode) => node }))
vi.mock('../src/client/app-update-store.js', () => ({
  arkmeAppUpdateStore: {
    subscribe: () => () => undefined,
    getSnapshot: () => state.app,
    download: vi.fn(async () => undefined),
    showDownloadedFile: vi.fn(async () => undefined),
  },
}))
vi.mock('../src/client/plugin-update-store.js', () => ({
  arkmePluginUpdateStore: {
    subscribe: () => () => undefined,
    getSnapshot: () => state.plugin,
    install: state.install,
  },
}))

import { ArkmeUpdateRailSlot } from '../src/client/ArkmeUpdateSurfaces.js'

beforeAll(() => {
  vi.stubGlobal('document', {
    body: {},
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
})

beforeEach(() => {
  state.install.mockClear()
  state.plugin = {
    ...state.plugin,
    busy: false,
    install: undefined,
  }
})

describe('Arkme update rail interaction', () => {
  it('opens the Demo-style release popover and starts the existing install action', () => {
    let renderer: ReturnType<typeof create>
    act(() => { renderer = create(<ArkmeUpdateRailSlot />) })

    act(() => { renderer!.root.findByProps({ 'aria-label': '更新 Arkme' }).props.onClick() })
    expect(renderer!.root.findByProps({ role: 'dialog' })).toBeDefined()
    expect(renderer!.root.findByProps({ id: 'arkme-update-title' }).children).toEqual(['发现新版本'])
    expect(renderer!.root.findByProps({ 'aria-label': '更新内容' })).toBeDefined()
    expect(renderer!.root.findAllByType('strong').map(node => node.children.join(''))).toContain('后台更新')
    expect(renderer!.root.findAllByType('strong').map(node => node.children.join(''))).not.toContain('自动重启')

    act(() => { renderer!.root.findByProps({ className: 'arkme-update-now' }).props.onClick() })
    expect(state.install).toHaveBeenCalledOnce()
  })

  it('restores percentage above the avatar after closing progress and reopens it on click', () => {
    state.plugin = {
      ...state.plugin,
      install: {
        schemaVersion: 1,
        jobId: 'job-1',
        phase: 'installing',
        previousVersion: '0.1.21',
        targetVersion: '0.1.22',
        message: '正在安装 0.1.22…',
        updatedAtMillis: 1,
      },
    }
    let renderer: ReturnType<typeof create>
    act(() => { renderer = create(<ArkmeUpdateRailSlot />) })

    expect(renderer!.root.findByProps({ className: 'arkme-update-capsule' })).toBeDefined()
    act(() => { renderer!.root.findByProps({ 'aria-label': '关闭更新进度' }).props.onClick() })

    const rail = renderer!.root.findByProps({ className: 'arkme-update-rail is-downloading' })
    expect(rail.findByType('span').children).toEqual(['78%'])
    act(() => { rail.props.onClick() })
    expect(renderer!.root.findByProps({ className: 'arkme-update-capsule' })).toBeDefined()
  })
})
