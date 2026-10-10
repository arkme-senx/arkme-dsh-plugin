// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ArkmeRecordingSpeakerOption, ArkmeRecordingWorkbenchItem } from '../src/types.js'
const mocks = vi.hoisted(() => ({ options: [] as ArkmeRecordingSpeakerOption[], save: vi.fn() }))
vi.mock('../src/client/recordings/use-recording-speaker-options.js', () => ({ useRecordingSpeakerOptions: () => ({
  contextKey: 'item-context', options: mocks.options, loading: false, error: '', ready: true, pending: false, refresh: vi.fn(), save: mocks.save,
}) }))
import { ArkmeRecordingSpeakerEditor } from '../src/client/recordings/ArkmeRecordingSpeakerEditor.js'

let root: Root, host: HTMLDivElement
const item = { itemRef: 'recording-item', speakerLabel: '说话人', sameSpeakerItemCount: 1 } as ArkmeRecordingWorkbenchItem
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.save.mockReset()
  mocks.options = Array.from({ length: 80 }, (_, index) => ({ optionKey: `person:${index}`, speakerRef: `ref:${index}`, label: `候选人${index}`,
    kind: 'speaker', recommended: false, currentAssignment: false, isCurrentUser: false }))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const list = document.querySelector<HTMLElement>('[data-speaker-options-list]')
    if (this === list) return { top: 100, bottom: 388, height: 288 } as DOMRect
    const rows = [...(list?.querySelectorAll('[data-speaker-option-key]') ?? [])]
    const index = rows.indexOf(this)
    return { top: 123 + index * 36 - (list?.scrollTop ?? 0), bottom: 155 + index * 36 - (list?.scrollTop ?? 0), height: 32 } as DOMRect
  })
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(288)
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(2903)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('restores the full list around the selected search result and keeps confirmation explicit', async () => {
  await act(async () => root.render(<ArkmeRecordingSpeakerEditor item={item} onUpdated={() => {}} onClose={() => {}} />))
  const input = document.querySelector<HTMLInputElement>('input[aria-label="说话人名称"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '候选人75')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(document.querySelectorAll('[data-speaker-option-key]')).toHaveLength(1)
  await act(async () => document.querySelector<HTMLButtonElement>('[data-speaker-option-key="person:75"]')!.click())
  const list = document.querySelector<HTMLElement>('[data-speaker-options-list]')!
  const selected = document.querySelector<HTMLButtonElement>('[data-speaker-option-key="person:75"]')!
  expect(input.value).toBe('')
  expect(list.querySelectorAll('[data-speaker-option-key]')).toHaveLength(80)
  expect(selected.getAttribute('aria-pressed')).toBe('true')
  expect(list.scrollTop).toBeGreaterThan(2400)
  expect(selected.getBoundingClientRect().top).toBeGreaterThan(123)
  expect(selected.getBoundingClientRect().bottom).toBeLessThan(388)
  expect(mocks.save).not.toHaveBeenCalled()
  // A cache refresh must not pull the user back after they scroll elsewhere.
  list.scrollTop = 400
  await act(async () => root.render(<ArkmeRecordingSpeakerEditor item={item} onUpdated={() => {}} onClose={() => {}} />))
  expect(list.scrollTop).toBe(400)
})

it('locates an existing assignment when opening the editor', async () => {
  mocks.options[70]!.currentAssignment = true
  await act(async () => root.render(<ArkmeRecordingSpeakerEditor item={item} onUpdated={() => {}} onClose={() => {}} />))
  expect(document.querySelector('[data-speaker-option-key="person:70"]')?.getAttribute('aria-pressed')).toBe('true')
  expect(document.querySelector<HTMLElement>('[data-speaker-options-list]')!.scrollTop).toBeGreaterThan(2200)
  expect(mocks.save).not.toHaveBeenCalled()
})
