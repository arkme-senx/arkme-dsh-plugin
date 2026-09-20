// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeComposerScreenshotButton } from '../src/client/ArkmeComposerScreenshotButton.js'
import type { ArkmeDesktopScreenshotResult } from '../src/desktop-screenshot-contract.js'

const { call } = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: call }))
let host: HTMLDivElement, root: Root
let resolveCapture: (value: ArkmeDesktopScreenshotResult) => void
let rejectCapture: (error: Error) => void
let captureSignal: AbortSignal
let current = true
const scope = {}
const onFile = vi.fn(async (_file: File) => {}), restored = vi.fn(), onBegin = vi.fn(() => restored), onError = vi.fn()
const props = () => ({ userId: 11, scope, disabled: false, isCurrent: () => current, onBegin, onFile, onError })
const button = () => host.querySelector('button')!
const mount = async (overrides = {}) => { await act(async () => root.render(<ArkmeComposerScreenshotButton {...props()} {...overrides} />)) }
const start = async () => { await act(async () => button().click()) }
const captured = { status: 'captured', fileName: '截图.png', mimeType: 'image/png', contentBase64: 'iVBORw0KGgo=' } as const

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('arkmeDesktop', { appVersion: 'test' })
  vi.clearAllMocks(); current = true
  call.mockImplementation((operation: string, _params: unknown, signal: AbortSignal) => {
    if (operation === 'desktop.screenshot.capability') return Promise.resolve({ available: true })
    captureSignal = signal
    return new Promise<ArkmeDesktopScreenshotResult>((resolve, reject) => { resolveCapture = resolve; rejectCapture = reject })
  })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

it('captures only on click, adds a PNG through existing attachment staging, and restores focus without sending', async () => {
  await mount()
  expect(call.mock.calls.map(args => args[0])).toEqual(['desktop.screenshot.capability'])
  await start()
  expect(onBegin).toHaveBeenCalledOnce()
  expect(button().disabled).toBe(true)
  await act(async () => resolveCapture(captured))
  expect(onFile).toHaveBeenCalledOnce()
  expect(onFile.mock.calls[0]![0]).toMatchObject({ name: '截图.png', type: 'image/png', size: 8 })
  expect(restored).toHaveBeenCalledOnce()
  expect(button().disabled).toBe(false)
  expect(call.mock.calls.map(args => args[0])).toEqual(['desktop.screenshot.capability', 'desktop.screenshot.capture'])
})
it('ignores rapid repeated clicks', async () => {
  await mount()
  await act(async () => { button().click(); button().click(); button().click() })
  expect(call.mock.calls.filter(args => args[0] === 'desktop.screenshot.capture')).toHaveLength(1)
  await act(async () => resolveCapture({ status: 'cancelled' }))
})
it('keeps the editor selection when pressing the screenshot toolbar button', async () => {
  await mount()
  const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
  act(() => { button().dispatchEvent(event) })
  expect(event.defaultPrevented).toBe(true)
})
it('cancels silently without modifying the draft', async () => {
  await mount(); await start()
  await act(async () => resolveCapture({ status: 'cancelled' }))
  expect(onFile).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled(); expect(restored).toHaveBeenCalledOnce()
})
it.each(['scope', 'account', 'inactive', 'hidden', 'unmount'])('never attaches a late screenshot after %s changes', async kind => {
  await mount(); await start()
  if (kind === 'scope') await mount({ scope: {} })
  if (kind === 'account') await mount({ userId: 12 })
  if (kind === 'inactive') current = false
  if (kind === 'hidden') await mount({ active: false })
  if (kind === 'unmount') await act(async () => root.render(null))
  if (kind !== 'inactive') expect(captureSignal.aborted).toBe(true)
  await act(async () => resolveCapture(captured))
  expect(onFile).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled()
})
it('shows actionable failure without sending or discarding the draft', async () => {
  await mount(); await start()
  await act(async () => rejectCapture(new Error('请允许屏幕录制')))
  expect(onError).toHaveBeenCalledWith('请允许屏幕录制')
  expect(onFile).not.toHaveBeenCalled()
  expect(button().disabled).toBe(false)
})
it('explains unsupported native capture without starting it', async () => {
  call.mockResolvedValue({ available: false, reason: '仅支持 macOS' })
  await mount(); await start()
  expect(button().disabled).toBe(false); expect(button().title).toBe('仅支持 macOS')
  expect(onError).toHaveBeenCalledWith('仅支持 macOS')
  expect(onBegin).not.toHaveBeenCalled()
})
