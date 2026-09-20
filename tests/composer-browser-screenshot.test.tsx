// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeComposerScreenshotButton } from '../src/client/ArkmeComposerScreenshotButton.js'
import type { ScreenshotFrame } from '../src/client/browser-screenshot.js'

const { call, capture, cropImage } = vi.hoisted(() => ({ call: vi.fn(), capture: vi.fn(), cropImage: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: call }))
vi.mock('../src/client/browser-screenshot.js', async original => ({
  ...await original<typeof import('../src/client/browser-screenshot.js')>(), captureBrowserScreenshot: capture, cropScreenshot: cropImage,
}))
let host: HTMLDivElement, root: Root, grant: (frame: ScreenshotFrame) => void, signal: AbortSignal
const frame = { blob: new Blob(['full'], { type: 'image/png' }), width: 1600, height: 900 }
const cropped = new Blob(['crop'], { type: 'image/png' })
const scope = {}, onFile = vi.fn(async (_file: File) => {}), restore = vi.fn(), onBegin = vi.fn(() => restore), onError = vi.fn()
const mount = async (overrides = {}) => { await act(async () => root.render(<ArkmeComposerScreenshotButton userId={11} scope={scope} disabled={false} isCurrent={() => true} onFile={onFile} onBegin={onBegin} onError={onError} {...overrides} />)) }
const click = async (label: string) => {
  const button = [...document.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === label || node.textContent === label)!
  expect(button).toBeTruthy(); await act(async () => button.click())
}
const open = async () => {
  await mount(); await click('截屏'); await act(async () => grant(frame))
  await act(async () => document.querySelector('img')!.dispatchEvent(new Event('load')))
}
const pointer = (element: Element, type: string, x: number, y: number) => {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y })
  Object.defineProperty(event, 'pointerId', { value: 1 }); element.dispatchEvent(event)
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('arkmeDesktop', undefined); vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: vi.fn() } })
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:screenshot-test'), revokeObjectURL: vi.fn() })
  capture.mockImplementation((value: AbortSignal) => {
    signal = value
    return new Promise<ScreenshotFrame>((resolve, reject) => {
      grant = resolve; signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  })
  cropImage.mockResolvedValue(cropped)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })

it('does not call the native host in a browser, and adds the whole image only after explicit confirmation', async () => {
  await open()
  expect(call).not.toHaveBeenCalled(); expect(capture).toHaveBeenCalledOnce()
  expect(onFile).not.toHaveBeenCalled()
  expect(document.querySelector('[role=dialog]')!.textContent).toContain('屏幕共享已停止')
  await click('使用整张')
  expect(onFile).toHaveBeenCalledOnce()
  expect(onFile.mock.calls[0]![0]).toMatchObject({ type: 'image/png', size: 4 })
  expect(document.querySelector('[role=dialog]')).toBeNull()
  expect(restore).toHaveBeenCalledOnce(); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:screenshot-test')
})
it('uses reverse drag coordinates for crop and rejects zero-size selections', async () => {
  await open()
  const stage = document.querySelector<HTMLElement>('[data-arkme-screenshot-image]')!
  vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20, width: 800, height: 450 } as DOMRect)
  stage.setPointerCapture = vi.fn(); stage.releasePointerCapture = vi.fn()
  const cropButton = [...document.querySelectorAll('button')].find(node => node.textContent === '完成裁剪')!
  expect(cropButton.disabled).toBe(true)
  act(() => { pointer(stage, 'pointerdown', 610, 380); pointer(stage, 'pointermove', 210, 110); pointer(stage, 'pointerup', 210, 110) })
  expect(cropButton.disabled).toBe(false)
  expect(document.querySelector('[role=status]')!.textContent).toBe('800 × 540')
  await click('完成裁剪')
  expect(cropImage).toHaveBeenCalledWith(expect.any(HTMLImageElement), frame, { x: .25, y: .2, width: .5, height: .6000000000000001 })
  expect(onFile).toHaveBeenCalledOnce()
})
it.each(['取消', '关闭截图', 'Escape'])('cancels using %s without adding or sending any image', async method => {
  await open()
  if (method === 'Escape') act(() => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  else await click(method)
  await act(async () => {})
  expect(onFile).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled()
  expect(document.querySelector('[role=dialog]')).toBeNull(); expect(restore).toHaveBeenCalledOnce()
})
it.each(['scope', 'account', 'hidden', 'unmount'])('discards crop after %s changes', async kind => {
  await open()
  if (kind === 'scope') await mount({ scope: {} })
  if (kind === 'account') await mount({ userId: 12 })
  if (kind === 'hidden') await mount({ active: false })
  if (kind === 'unmount') await act(async () => root.render(null))
  expect(signal.aborted).toBe(true)
  expect(document.querySelector('[role=dialog]')).toBeNull(); expect(onFile).not.toHaveBeenCalled()
})
it('cancels a pending chooser and rejects a late frame on conversation change', async () => {
  await mount(); await click('截屏'); await mount({ scope: {} }); await act(async () => grant(frame))
  expect(signal.aborted).toBe(true); expect(document.querySelector('[role=dialog]')).toBeNull()
  expect(onFile).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled()
})
it('ignores a crop result completed after the dialog was cancelled', async () => {
  await open()
  const stage = document.querySelector<HTMLElement>('[data-arkme-screenshot-image]')!
  vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 800, height: 450 } as DOMRect)
  stage.setPointerCapture = vi.fn(); stage.releasePointerCapture = vi.fn()
  act(() => { pointer(stage, 'pointerdown', 0, 0); pointer(stage, 'pointermove', 400, 200); pointer(stage, 'pointerup', 400, 200) })
  let complete!: (blob: Blob) => void
  cropImage.mockReturnValue(new Promise<Blob>(resolve => { complete = resolve }))
  await click('完成裁剪'); await click('取消'); await act(async () => complete(cropped))
  expect(onFile).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled()
})
it('shows an actionable unsupported-browser message on click', async () => {
  vi.stubGlobal('navigator', {})
  await mount(); await click('截屏')
  expect(onError.mock.calls[0]![0]).toContain('系统截屏后粘贴')
  expect(capture).not.toHaveBeenCalled(); expect(onBegin).not.toHaveBeenCalled()
})
it('handles denial without silently appearing to do nothing', async () => {
  capture.mockRejectedValue(new DOMException('denied', 'NotAllowedError'))
  await mount(); await click('截屏')
  expect(onError.mock.calls[0]![0]).toContain('未获得屏幕共享授权')
  expect(onFile).not.toHaveBeenCalled(); expect(restore).toHaveBeenCalledOnce()
})
