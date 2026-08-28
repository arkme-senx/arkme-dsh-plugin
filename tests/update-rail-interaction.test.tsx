import React from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArkmePluginUpdateStoreSnapshot } from '../src/client/plugin-update-store.js'
import type { ArkmeAppUpdateStoreSnapshot } from '../src/client/app-update-store.js'

const state = vi.hoisted(() => ({
  app: { checked: true, busy: false, error: '' } as ArkmeAppUpdateStoreSnapshot,
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
  checkInstallStatus: vi.fn(async () => undefined),
  showDownloadedFile: vi.fn(async () => undefined),
}))

vi.mock('react-dom', () => ({ createPortal: (node: React.ReactNode) => node }))
vi.mock('../src/client/app-update-store.js', () => ({
  arkmeAppUpdateStore: {
    subscribe: () => () => undefined,
    getSnapshot: () => state.app,
    download: vi.fn(async () => undefined),
    showDownloadedFile: state.showDownloadedFile,
  },
}))
vi.mock('../src/client/plugin-update-store.js', () => ({
  arkmePluginUpdateStore: {
    subscribe: () => () => undefined,
    getSnapshot: () => state.plugin,
    install: state.install,
    checkInstallStatus: state.checkInstallStatus,
  },
}))

import { ArkmeUpdateRailSlot } from '../src/client/ArkmeUpdateSurfaces.js'

const initialPlugin = state.plugin
const renderers: ReturnType<typeof create>[] = []
function renderRail() {
  let renderer: ReturnType<typeof create>
  act(() => { renderer = create(<ArkmeUpdateRailSlot />) })
  renderers.push(renderer!)
  return renderer!
}
function installPhase(phase: NonNullable<ArkmePluginUpdateStoreSnapshot['install']>['phase']) {
  state.plugin = { ...state.plugin, install: {
    schemaVersion: 1, jobId: 'job-1', phase, previousVersion: '0.1.21',
    targetVersion: '0.1.22', message: '更新状态', updatedAtMillis: 1,
  } }
}
afterEach(() => { act(() => { renderers.splice(0).forEach(renderer => renderer.unmount()) }) })

beforeAll(() => {
  vi.stubGlobal('document', {
    body: {},
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
})

beforeEach(() => {
  state.install.mockClear()
  state.checkInstallStatus.mockClear()
  state.showDownloadedFile.mockClear()
  state.app = { checked: true, busy: false, error: '' }
  state.plugin = initialPlugin
})

describe('Arkme update rail interaction', () => {
  it('checks an uncertain installation without reinstalling and keeps the collapsed recovery entry usable', () => {
    installPhase('installing')
    const renderer = renderRail()
    state.plugin = { ...state.plugin, installWarning: '更新状态长时间未变化，请检查状态。' }
    act(() => { renderer.update(<ArkmeUpdateRailSlot />) })
    expect(renderer.root.findByProps({ 'data-layout': 'action' })).toBeDefined()
    expect(renderer.root.findAllByProps({ className: 'arkme-update-progress' })).toHaveLength(0)
    act(() => { renderer.root.findByProps({ className: 'arkme-update-ready-action' }).props.onClick() })
    expect(state.checkInstallStatus).toHaveBeenCalledOnce()
    expect(state.install).not.toHaveBeenCalled()
    state.plugin = { ...state.plugin, installStatusChecking: true }
    act(() => { renderer.update(<ArkmeUpdateRailSlot />) })
    expect(renderer.root.findByProps({ className: 'arkme-update-ready-action' }).props.disabled).toBe(true)
    expect(renderer.root.findByProps({ className: 'arkme-update-ready-action' }).children).toEqual(['检查中…'])
    state.plugin = { ...state.plugin, installStatusChecking: false, installStatusFeedback: '已检查，更新仍未结束。可稍后再检查。' }
    act(() => { renderer.update(<ArkmeUpdateRailSlot />) })
    expect(renderer.root.findByProps({ className: 'arkme-update-ready-action' }).props.disabled).toBe(false)
    act(() => { renderer.root.findByProps({ 'aria-label': '关闭更新进度' }).props.onClick() })
    const rail = renderer.root.findByProps({ 'aria-label': '更新状态待确认' })
    expect(rail.findByType('span').children).toEqual(['待确认'])
    act(() => { rail.props.onClick() })
    expect(renderer.root.findByProps({ 'data-layout': 'action' })).toBeDefined()
    state.plugin = { ...state.plugin, installWarning: '' }
    installPhase('failed')
    act(() => { renderer.update(<ArkmeUpdateRailSlot />) })
    act(() => { renderer.root.findByProps({ className: 'arkme-update-ready-action' }).props.onClick() })
    expect(state.install).toHaveBeenCalledOnce()
  })

  it('opens the Demo-style release popover and starts the existing install action', () => {
    const renderer = renderRail()

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
    const renderer = renderRail()

    expect(renderer!.root.findByProps({ className: 'arkme-update-capsule' })).toBeDefined()
    expect(renderer.root.findAllByProps({ className: 'arkme-update-rail-slot' })).toHaveLength(0)
    act(() => { renderer!.root.findByProps({ 'aria-label': '关闭更新进度' }).props.onClick() })

    const rail = renderer!.root.findByProps({ className: 'arkme-update-rail is-downloading' })
    expect(rail.findByType('span').children).toEqual(['78%'])
    expect(renderer.root.findAllByProps({ className: 'arkme-update-rail-slot' })).toHaveLength(1)
    act(() => { rail.props.onClick() })
    expect(renderer!.root.findByProps({ className: 'arkme-update-capsule' })).toBeDefined()
  })

  it('removes all plugin UI after success and on remount, without carrying its open state to the next release', () => {
    installPhase('installing')
    const renderer = renderRail()
    installPhase('succeeded')
    act(() => { renderer.update(<ArkmeUpdateRailSlot />) })
    expect(renderer.toJSON()).toBeNull()
    expect(renderRail().toJSON()).toBeNull()

    state.plugin = { ...state.plugin, status: { ...initialPlugin.status!, latestVersion: '0.1.23' } }
    act(() => { renderer.update(<ArkmeUpdateRailSlot />) })
    expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
    act(() => { renderer.root.findByProps({ 'aria-label': '更新 Arkme' }).props.onClick() })
    expect(renderer.root.findByProps({ role: 'dialog' })).toBeDefined()
  })

  it('does not auto-open another target after success; the APP installer remains available on click', () => {
    installPhase('installing')
    state.app = { ...state.app, status: { status: 'downloaded', currentVersion: '0.1.20', latestVersion: '0.1.22' } }
    const renderer = renderRail()
    installPhase('succeeded')
    act(() => { renderer.update(<ArkmeUpdateRailSlot />) })
    expect(renderer.root.findAllByProps({ role: 'status' })).toHaveLength(0)
    const rail = renderer.root.findByProps({ className: 'arkme-update-rail is-ready' })
    expect(rail.findByType('span').children).toEqual(['待安装'])
    act(() => { rail.props.onClick() })
    expect(renderer.root.findAllByProps({ className: 'arkme-update-rail-slot' })).toHaveLength(0)
    act(() => { renderer.root.findByProps({ className: 'arkme-update-ready-action' }).props.onClick() })
    expect(state.showDownloadedFile).toHaveBeenCalledOnce()
  })

  it.each(['failed', 'rolled-back'] as const)('keeps %s retry available after collapsing the capsule', phase => {
    installPhase('installing')
    const renderer = renderRail()
    installPhase(phase)
    act(() => { renderer.update(<ArkmeUpdateRailSlot />) })
    expect(renderer.root.findByProps({ role: 'alert' })).toBeDefined()
    act(() => { renderer.root.findByProps({ 'aria-label': '关闭更新进度' }).props.onClick() })
    act(() => { renderer.root.findByProps({ 'aria-label': '重试更新' }).props.onClick() })
    act(() => { renderer.root.findByProps({ className: 'arkme-update-ready-action' }).props.onClick() })
    expect(state.install).toHaveBeenCalledOnce()
  })

  it('hides the retry action and old failure while the install request is pending', () => {
    installPhase('failed')
    const renderer = renderRail()
    act(() => { renderer.root.findByProps({ 'aria-label': '重试更新' }).props.onClick() })
    act(() => { renderer.root.findByProps({ className: 'arkme-update-ready-action' }).props.onClick() })
    state.plugin = { ...state.plugin, busy: true, installPending: true }
    act(() => { renderer.update(<ArkmeUpdateRailSlot />) })
    expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
    expect(renderer.root.findAllByProps({ className: 'arkme-update-ready-action' })).toHaveLength(0)
    expect(renderer.root.findAllByProps({ className: 'arkme-update-rail-slot' })).toHaveLength(0)
    expect(renderer.root.findByProps({ 'data-layout': 'progress' }).children).toHaveLength(4)
    state.plugin = { ...state.plugin, busy: false, installPending: false, installError: '重试请求失败' }
    act(() => { renderer.update(<ArkmeUpdateRailSlot />) })
    expect(renderer.root.findByProps({ role: 'alert' })).toBeDefined()
    act(() => { renderer.root.findByProps({ 'aria-label': '关闭更新进度' }).props.onClick() })
    expect(renderer.root.findByProps({ 'aria-label': '重试更新' })).toBeDefined()
  })

  it('keeps a collapsed pending request collapsed when the Host accepts the job, until automatic restart', () => {
    state.plugin = { ...state.plugin, busy: true, installPending: true }
    const renderer = renderRail()
    act(() => { renderer.root.findByProps({ 'aria-label': '关闭更新进度' }).props.onClick() })
    expect(renderer.root.findByProps({ 'aria-label': '查看更新进度，8%' })).toBeDefined()
    installPhase('preparing')
    state.plugin = { ...state.plugin, busy: false, installPending: false }
    act(() => { renderer.update(<ArkmeUpdateRailSlot />) })
    expect(renderer.root.findAllByProps({ role: 'status' })).toHaveLength(0)
    expect(renderer.root.findByProps({ 'aria-label': '查看更新进度，12%' })).toBeDefined()
    installPhase('restarting')
    act(() => { renderer.update(<ArkmeUpdateRailSlot />) })
    expect(renderer.root.findByProps({ 'aria-label': '正在自动重启客户端' })).toBeDefined()
  })
})
