// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ state: {} as any, listeners: new Set<() => void>(), start: vi.fn(), stop: vi.fn(), configure: vi.fn() }))
vi.mock('../src/client/recordings/direct-recording-store.js', () => ({ directRecordingStore: {
  getSnapshot: () => mock.state, subscribe: (fn: () => void) => { mock.listeners.add(fn); return () => mock.listeners.delete(fn) },
  start: mock.start, stop: mock.stop, configure: mock.configure,
} }))
import { ArkmeDirectRecordingButton, ArkmeDirectRecordingStatus, useDirectRecordingOwner } from '../src/client/recordings/ArkmeDirectRecording.js'
let root: Root, host: HTMLDivElement
beforeEach(() => {
  mock.state = { accountKey: 'prod:42', phase: 'idle', startedAt: 0, elapsedMillis: 0, maxMillis: 300000, levels: [], pending: [], message: '', error: '', progress: 0, acceptedRevision: 0, volatile: false }
  mock.start.mockReset(); mock.stop.mockReset(); mock.configure.mockReset()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
})
afterEach(() => { act(() => root.unmount()); host.remove(); mock.listeners.clear() })
const render = (node: ReactNode) => act(() => root.render(node))
const update = (value: object) => act(() => { mock.state = { ...mock.state, ...value }; mock.listeners.forEach(fn => fn()) })
it('starts only by explicit click and disables starting a duplicate recording', () => {
  const start = vi.fn()
  render(<ArkmeDirectRecordingButton onStart={start} />)
  expect(mock.start).not.toHaveBeenCalled()
  act(() => host.querySelector('button')!.click()); expect(start).toHaveBeenCalledOnce(); expect(mock.start).toHaveBeenCalledOnce()
  update({ phase: 'recording' }); expect(host.querySelector('button')!.disabled).toBe(true)
})
it('portals floating controls outside the hidden DSH conversation layer', () => {
  update({ phase: 'recording', elapsedMillis: 123000, message: '正在录音' })
  render(<div aria-hidden style={{ visibility: 'hidden', pointerEvents: 'none' }}><ArkmeDirectRecordingStatus floating /></div>)
  const floating = document.querySelector('[data-arkme-direct-recording="floating"]')!
  expect(floating.parentElement).toBe(document.body)
  expect(floating.textContent).toContain('00:02:03')
  act(() => [...floating.querySelectorAll('button')].find(button => button.textContent === '结束并保存')!.click())
  expect(mock.stop).toHaveBeenCalledOnce()
  update({ phase: 'idle' }); expect(document.querySelector('[data-arkme-direct-recording="floating"]')).toBeNull()
})
it('warns on leaving while recording or while unsaved emergency audio remains', () => {
  function Owner() { useDirectRecordingOwner('prod:42', 42, '/import', true, () => undefined); return null }
  render(<Owner />)
  const closing = () => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented }
  expect(closing()).toBe(false)
  update({ phase: 'recording' }); expect(closing()).toBe(true)
  update({ phase: 'idle', volatile: true }); expect(closing()).toBe(true)
  update({ volatile: false }); expect(closing()).toBe(false)
})
it('retains a shared owner until the last plugin surface unmounts', () => {
  function Owner() { useDirectRecordingOwner('prod:42', 42, '/import', true, () => undefined); return null }
  render(<><Owner key="one" /><Owner key="two" /></>)
  mock.configure.mockClear()
  render(<><Owner key="one" /></>)
  expect(mock.configure).toHaveBeenLastCalledWith({ key: 'prod:42', userId: 42, importPath: '/import' })
  render(null); expect(mock.configure).toHaveBeenLastCalledWith(undefined)
})
it('breathes only the capture icon and status dots, never the labels or saving/upload states', () => {
  render(<><ArkmeDirectRecordingButton onStart={() => undefined} /><ArkmeDirectRecordingStatus /><ArkmeDirectRecordingStatus floating /></>)
  expect(document.querySelectorAll('[data-arkme-recording-breath]')).toHaveLength(0)
  update({ phase: 'recording', startedAt: Date.now() - 3500 })
  expect(document.querySelectorAll('[data-arkme-recording-breath="icon"]')).toHaveLength(1)
  expect(document.querySelectorAll('[data-arkme-recording-breath="dot"]')).toHaveLength(2)
  expect([...document.querySelectorAll('[data-arkme-recording-breath]')].every(el => el.getAttribute('aria-hidden') === 'true')).toBe(true)
  const status = document.querySelector<HTMLElement>('[data-arkme-direct-recording="calendar"]')!
  const delay = status.style.getPropertyValue('--arkme-recording-breath-delay')
  update({ elapsedMillis: 4200, levels: [.1, .2] })
  expect(status.style.getPropertyValue('--arkme-recording-breath-delay')).toBe(delay)
  for (const phase of ['saving', 'uploading', 'idle', 'starting']) {
    update({ phase })
    expect(document.querySelectorAll('[data-arkme-recording-breath]')).toHaveLength(0)
  }
})
