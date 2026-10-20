// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeAttachmentStrip } from '../src/client/ArkmeAttachmentStrip.js'
import type { ArkmeComposerAttachment } from '../src/client/composer-draft-store.js'

let host: HTMLDivElement, root: Root
const preview = vi.fn(), remove = vi.fn()
const names = ['录音实体识别后端交接-20261015.md', '录音实体识别后端交接-修订版-20261015.pdf']
const attachments: ArkmeComposerAttachment[] = names.map((fileName, i) => ({ localFile: {
  fileRef: `arkme-file-v1.00000000-0000-4000-8000-00000000000${i + 1}`,
  fileName, fileKind: 4, mimeType: 'application/octet-stream', size: 10,
} }))
const tiles = () => host.querySelectorAll<HTMLElement>('[data-arkme-attachment-tile]')
const tip = () => document.querySelector<HTMLElement>('[data-arkme-attachment-tooltip]')
const hover = (index = 0) => act(() => { tiles()[index]!.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })) })
const render = (canPreview = true) => act(() => root.render(<ArkmeAttachmentStrip attachments={attachments}
  disabled={false} onMove={() => {}} onRemove={remove} onPreview={preview} canPreview={() => canPreview} />))

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers()
  preview.mockClear(); remove.mockClear()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount()); host.remove()
  vi.useRealTimers(); vi.unstubAllGlobals()
})

it('shows the full filename immediately outside the clipped strip and switches between files', () => {
  render(); hover()
  expect(tip()?.textContent).toBe(names[0])
  expect(tip()?.parentElement).toBe(document.body)
  expect(tip()?.style.pointerEvents).toBe('none')
  expect(host.querySelectorAll('[title]')).toHaveLength(0)
  act(() => tiles()[0]!.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: tiles()[1] })))
  hover(1)
  expect(document.querySelectorAll('[role="tooltip"]')).toHaveLength(1)
  expect(tip()?.textContent).toBe(names[1])
  act(() => tiles()[1]!.dispatchEvent(new MouseEvent('pointerout', { bubbles: true })))
  expect(tip()).toBeNull()
})

it('shows the name even when preview is unavailable', () => {
  render(false); hover()
  expect(tiles()[0]!.querySelector('button')?.disabled).toBe(true)
  expect(tip()?.textContent).toBe(names[0])
})

it('supports focus on the sortable item and its buttons, while preserving preview and removal', () => {
  render()
  act(() => host.querySelector<HTMLElement>('[role="listitem"]')!.focus())
  expect(tip()?.textContent).toBe(names[0])
  const buttons = tiles()[0]!.querySelectorAll('button')
  act(() => buttons[0]!.focus())
  expect(tip()?.textContent).toBe(names[0])
  act(() => buttons[0]!.click())
  expect(tip()).toBeNull(); expect(preview).toHaveBeenCalledWith(attachments[0])
  act(() => buttons[1]!.focus())
  expect(tip()?.textContent).toBe(names[0])
  act(() => buttons[1]!.click())
  expect(tip()).toBeNull(); expect(remove).toHaveBeenCalledWith(attachments[0])
})

it.each(['scroll', 'dragstart', 'resize', 'blur', 'Escape', 'pointercancel'])('dismisses on %s without waiting', kind => {
  render(); hover()
  act(() => {
    if (kind === 'scroll') host.dispatchEvent(new Event('scroll'))
    else if (kind === 'dragstart') document.dispatchEvent(new Event('dragstart'))
    else if (kind === 'Escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: kind }))
    else if (kind === 'pointercancel') tiles()[0]!.dispatchEvent(new Event(kind, { bubbles: true }))
    else window.dispatchEvent(new Event(kind))
  })
  expect(tip()).toBeNull()
})
