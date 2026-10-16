// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { DirectRecordingSnapshot } from '../src/client/recordings/direct-recording-store.js'
const mock = vi.hoisted(() => ({ state: {} as DirectRecordingSnapshot, listeners: new Set<() => void>(), start: vi.fn() }))
vi.mock('../src/client/recordings/direct-recording-store.js', () => ({ directRecordingStore: {
  getSnapshot: () => mock.state,
  subscribe: (fn: () => void) => { mock.listeners.add(fn); return () => mock.listeners.delete(fn) },
  start: mock.start,
} }))
import { ArkmeQuickAddButton } from '../src/client/ArkmeQuickAdd.js'
import { ArkmeDirectRecordingStatus } from '../src/client/recordings/ArkmeDirectRecording.js'
import { arkmeUi } from '../src/client/ui-controller.js'
let host: HTMLDivElement, root: Root
const publish = (update: Partial<DirectRecordingSnapshot>) => { mock.state = { ...mock.state, ...update }; mock.listeners.forEach(fn => fn()) }
const trigger = () => host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!
const action = (label: string) => document.querySelector<HTMLButtonElement>(`[role="menuitem"][aria-label="${label}"]`)
const render = (accountKey: string | undefined = 'prod:42') => act(() => root.render(<>
  <ArkmeQuickAddButton recordingAccountKey={accountKey} onContactAdd={() => {}} onSourceCreated={() => {}} />
  <ArkmeDirectRecordingStatus floating />
</>))
const open = async () => { await act(async () => trigger().click()) }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mock.state = { accountKey: 'prod:42', phase: 'idle', startedAt: 0, elapsedMillis: 0, maxMillis: 300000, levels: [], pending: [], message: '', error: '', progress: 0, acceptedRevision: 0, volatile: false }
  mock.start.mockReset()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); mock.listeners.clear(); vi.unstubAllGlobals() })

it('starts the shared recorder without navigating, then offers the existing recording surface', async () => {
  let finish!: () => void
  mock.start.mockImplementation(() => { publish({ phase: 'starting' }); return new Promise<void>(resolve => { finish = resolve }) })
  render(); await open()
  const previousUi = arkmeUi.getSnapshot()
  expect(mock.start).not.toHaveBeenCalled()
  await act(async () => action('开始录音')!.click())
  expect(mock.start).toHaveBeenCalledOnce()
  expect(arkmeUi.getSnapshot()).toBe(previousUi)
  expect(document.querySelector('[role="menu"]')).toBeNull()
  expect(document.querySelector('[data-arkme-direct-recording="floating"]')).not.toBeNull()
  await open()
  expect(action('正在准备录音…')?.disabled).toBe(true)
  await act(async () => action('正在准备录音…')!.click())
  expect(mock.start).toHaveBeenCalledOnce()
  await act(async () => { publish({ phase: 'recording', elapsedMillis: 12000 }); finish() })
  expect(action('查看录音')?.disabled).toBe(false)
  expect(document.querySelector('[data-arkme-direct-recording="floating"]')?.textContent).toContain('00:00:12')
  await act(async () => action('查看录音')!.click())
  expect(arkmeUi.getSnapshot().mode).toBe('recordings')
  expect(mock.start).toHaveBeenCalledOnce()
  expect(document.querySelector('[role="menu"]')).toBeNull()
})

it('shows a failed microphone attempt in the menu and allows retry', async () => {
  mock.start.mockImplementation(async () => { publish({ phase: 'idle', error: '麦克风权限被拒绝' }) })
  render(); await open()
  await act(async () => action('开始录音')!.click())
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('麦克风权限被拒绝')
  expect(action('开始录音')?.disabled).toBe(false)
  await act(async () => action('开始录音')!.click())
  expect(mock.start).toHaveBeenCalledTimes(2)
})

it.each([['saving', '正在保存录音…'], ['uploading', '正在上传录音…']] as const)('does not start again during %s', async (phase, label) => {
  mock.state.phase = phase
  render(); await open()
  expect(action(label)?.disabled).toBe(true)
  await act(async () => action(label)!.click())
  expect(mock.start).not.toHaveBeenCalled()
})

it('keeps the entry visible but prevents starting against another account owner', async () => {
  render('prod:99'); await open()
  expect(action('开始录音')?.disabled).toBe(true)
  await act(async () => action('开始录音')!.click())
  expect(mock.start).not.toHaveBeenCalled()
  act(() => publish({ accountKey: 'prod:99' }))
  expect(action('开始录音')?.disabled).toBe(false)
})

it('ignores an old permission failure after switching accounts', async () => {
  let finish!: () => void
  mock.start.mockImplementation(() => { publish({ phase: 'starting' }); return new Promise<void>(resolve => { finish = resolve }) })
  render(); await open()
  await act(async () => action('开始录音')!.click())
  render('prod:99')
  await act(async () => { publish({ accountKey: 'prod:99', phase: 'idle', error: '旧权限请求失败' }); finish() })
  expect(document.querySelector('[role="menu"]')).toBeNull()
  expect(document.querySelector('[role="alert"]')).toBeNull()
})

it('leaves other quick-add menu locations unchanged when the shortcut is not requested', async () => {
  act(() => root.render(<ArkmeQuickAddButton onContactAdd={() => {}} onSourceCreated={() => {}} />))
  await open()
  expect(action('开始录音')).toBeNull()
})
