// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { AttachmentPreviewWindow } from '../src/client/attachment-preview-window.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
beforeEach(() => { vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}); vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {}) })
const controllers: AttachmentPreviewWindow[] = []
afterEach(() => { act(() => { controllers.splice(0).forEach(value => value.close()) }); vi.restoreAllMocks() })
function setup() {
  const docs: Document[] = []
  const windows: any[] = []
  const open = vi.fn(() => {
    const doc = document.implementation.createHTMLDocument('')
    const events = new EventTarget()
    const child = { document: doc, closed: false, focus() {}, close() { this.closed = true; events.dispatchEvent(new Event('beforeunload')) }, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) }
    docs.push(doc); windows.push(child)
    return child as unknown as Window
  })
  const manager = new AttachmentPreviewWindow(window, open)
  controllers.push(manager)
  return { manager, docs, windows, open }
}
describe('independent preview host', () => {
  it('reuses one child; replacing content leaves the main document usable', () => {
    const { manager, docs, open } = setup()
    act(() => { manager.show('a', () => <div>first attachment</div>) })
    expect(docs[0]!.body.textContent).toContain('first attachment')
    expect(document.body.textContent).not.toContain('first attachment')
    expect(document.body.style.overflow).not.toBe('hidden')
    act(() => { manager.show('b', () => <div>second attachment</div>) })
    expect(docs[0]!.body.textContent).toContain('second attachment')
    expect(docs).toHaveLength(1)
    expect(open).toHaveBeenCalledTimes(1)
  })
  it('same identity preserves mounted media; closing releases it and reopens cleanly', () => {
    const { manager, docs } = setup()
    act(() => { manager.show('a', () => <video data-playing="yes" />) })
    const media = docs[0]!.querySelector('video')
    act(() => { manager.show('a', () => <div>should not replace</div>) })
    expect(docs[0]!.querySelector('video')).toBe(media)
    act(() => { manager.close() })
    expect(docs[0]!.querySelector('video')).toBeNull()
    act(() => { manager.show('b', () => <div>new account</div>) })
    expect(docs).toHaveLength(2)
    expect(docs[1]!.body.textContent).toContain('new account')
  })
  it('reports unavailable windows without placing an overlay in chat', () => {
    const manager = new AttachmentPreviewWindow(window, () => null)
    expect(() => manager.show('a', () => <div>file</div>)).toThrow()
    expect(document.body.textContent).not.toContain('file')
  })
})
