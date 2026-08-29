import React from 'react'
import { act, create } from 'react-test-renderer'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeAppUpdateStoreSnapshot } from '../src/client/app-update-store.js'

const state = vi.hoisted(() => ({
  app: {
    checked: true,
    busy: false,
    error: '',
    status: {
      status: 'available',
      currentVersion: '0.1.21',
      latestVersion: '0.1.22',
      releaseNotes: '后台更新：下载期间可以继续工作。',
    },
  } as ArkmeAppUpdateStoreSnapshot,
  download: vi.fn(async () => undefined),
}))

vi.mock('react-dom', () => ({ createPortal: (node: React.ReactNode) => node }))
vi.mock('../src/client/app-update-store.js', () => ({
  arkmeAppUpdateStore: {
    subscribe: () => () => undefined,
    getSnapshot: () => state.app,
    download: state.download,
    showDownloadedFile: vi.fn(async () => undefined),
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
  state.download.mockClear()
  state.app = {
    checked: true,
    busy: false,
    error: '',
    status: {
      status: 'available',
      currentVersion: '0.1.21',
      latestVersion: '0.1.22',
      releaseNotes: '后台更新：下载期间可以继续工作。',
    },
  }
})

describe('Arkme update rail interaction', () => {
  it('opens the APP release popover and starts the existing APP download action', () => {
    let renderer: ReturnType<typeof create>
    act(() => { renderer = create(<ArkmeUpdateRailSlot />) })

    act(() => { renderer!.root.findByProps({ 'aria-label': '更新 Arkme' }).props.onClick() })
    expect(renderer!.root.findByProps({ role: 'dialog' })).toBeDefined()
    expect(renderer!.root.findByProps({ id: 'arkme-update-title' }).children).toEqual(['发现新版本'])
    expect(renderer!.root.findByProps({ 'aria-label': '更新内容' })).toBeDefined()
    expect(renderer!.root.findAllByType('strong').map(node => node.children.join(''))).toContain('后台更新')

    act(() => { renderer!.root.findByProps({ className: 'arkme-update-now' }).props.onClick() })
    expect(state.download).toHaveBeenCalledOnce()
  })

  it('restores percentage above the avatar after closing progress and reopens it on click', () => {
    state.app = {
      checked: true,
      busy: true,
      error: '',
      status: {
        status: 'downloading',
        currentVersion: '0.1.21',
        latestVersion: '0.1.22',
        downloadedBytes: 78,
        totalBytes: 100,
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
