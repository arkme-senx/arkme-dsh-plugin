import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArkmeProductNavigation } from '../src/client/ArkmeProductNavigation.js'
import { arkmeAppUpdateStore, type ArkmeAppUpdateSnapshot } from '../src/client/app-update-store.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'

const release: ArkmeAppUpdateSnapshot = {
  status: 'available', currentVersion: '3.0.60', currentVersionCode: 60,
  latestVersion: '3.0.63', latestVersionCode: 63, canAutoInstall: true,
}
let renderer: ReactTestRenderer | undefined
let stop: (() => void) | undefined

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = undefined
  stop?.()
  stop = undefined
  vi.unstubAllGlobals()
})

async function mount(initial: ArkmeAppUpdateSnapshot | null) {
  let emit!: (state: ArkmeAppUpdateSnapshot | null) => void
  const open = vi.fn(async () => true)
  const download = vi.fn()
  vi.stubGlobal('arkmeDesktop', {
    appUpdateUi: true,
    update: {
      status: async () => initial,
      onChanged: (listener: typeof emit) => { emit = listener; return () => undefined },
      open, download,
    },
  })
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'prod', userId: 10001 })
  await act(async () => {
    stop = arkmeAppUpdateStore.start()
    renderer = create(<ArkmeProductNavigation compact={false} />)
  })
  return { emit, open, download }
}
const entries = () => renderer!.root.findAllByProps({ 'aria-label': '版本更新' })

describe('sidebar app update entry', () => {
  it.each(['available', 'downloading', 'downloaded', 'installing', 'failed'] as const)(
    'shows %s above the avatar and reopens the existing update without restarting download', async status => {
      const state = { ...release, status, downloadedBytes: 512, totalBytes: 1024 }
      const { emit, open, download } = await mount(state)
      expect(entries()).toHaveLength(1)
      const buttons = renderer!.root.findAllByType('button')
      const updateIndex = buttons.findIndex(button => button.props['aria-label'] === '版本更新')
      expect(buttons[updateIndex + 1]?.props['aria-label']).toBe('个人资料')
      await act(async () => { await entries()[0]!.props.onClick() })
      // Closing the shell notice publishes the same update state with expanded=false.
      act(() => emit({ ...state }))
      expect(entries()).toHaveLength(1)
      await act(async () => { await entries()[0]!.props.onClick() })
      expect(open).toHaveBeenCalledTimes(2)
      expect(download).not.toHaveBeenCalled()
      expect(arkmeAppUpdateStore.getSnapshot().status?.downloadedBytes).toBe(512)
      act(() => emit({ ...release, status: 'current', currentVersionCode: 63 }))
      expect(entries()).toHaveLength(0)
    },
  )

  it.each([
    null,
    ...(['idle', 'checking', 'current'] as const).map(status => ({ ...release, status })),
    { ...release, status: 'failed' as const, latestVersion: '', failureStage: 'check' as const },
    { ...release, latestVersionCode: 60 },
    { ...release, latestVersionCode: 59 },
    { ...release, latestVersion: ' ' },
  ])('hides absent, inactive or non-newer updates: %j', async state => {
    await mount(state)
    expect(entries()).toHaveLength(0)
  })

  it('appears when a new update arrives and disappears when its state is cleared', async () => {
    const { emit } = await mount(null)
    expect(entries()).toHaveLength(0)
    act(() => emit(release))
    expect(entries()).toHaveLength(1)
    act(() => emit(null))
    expect(entries()).toHaveLength(0)
  })
})
