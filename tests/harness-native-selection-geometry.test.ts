// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { measureNativeSelection, sameSelectionPosition, nativeSelectionHighlightSelector } from '../src/client/harness-native-selection-geometry.js'

afterEach(() => document.body.replaceChildren())
it('escapes opaque keys without widening the highlight selector', () => {
  const flow = document.createElement('div'); flow.dataset.chatFlow = ''
  const row = document.createElement('div'); row.dataset.chatFlowKind = 'user'
  const other = document.createElement('div'); other.dataset.chatFlowKind = 'user'; other.dataset.chatAnchorKey = 'other'
  document.body.append(flow); flow.append(row, other)
  for (const key of ['user:opaque', 'user:"], body { color:red } /*', 'user:中文\\\n']) {
    row.dataset.chatAnchorKey = key
    expect([...document.querySelectorAll(nativeSelectionHighlightSelector(new Set([key])))]).toEqual([row])
  }
  expect(nativeSelectionHighlightSelector(new Set())).toBe('')
})
function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }
}

it('keeps 32px controls and a 10px gap without changing native layout', () => {
  const viewport = document.createElement('div'); const flow = document.createElement('div'); const row = document.createElement('div')
  document.body.append(viewport); viewport.append(flow); flow.append(row)
  vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(rect(0, 60, 800, 500))
  vi.spyOn(flow, 'getBoundingClientRect').mockReturnValue(rect(80, 70, 680, 900))
  vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(rect(80, 100, 680, 90))
  Object.defineProperty(viewport, 'clientWidth', { value: 800 }); Object.defineProperty(viewport, 'clientHeight', { value: 500 })
  expect(measureNativeSelection(viewport, flow, row)).toEqual({ left: 38, top: 100 })
  const before = row.outerHTML
  vi.mocked(flow.getBoundingClientRect).mockReturnValue(rect(32, 70, 720, 900))
  expect(measureNativeSelection(viewport, flow, row)).toBeUndefined()
  expect(row.outerHTML).toBe(before)
  vi.mocked(flow.getBoundingClientRect).mockReturnValue(rect(80, 70, 680, 900))
  vi.mocked(row.getBoundingClientRect).mockReturnValue(rect(80, 45, 680, 90))
  expect(measureNativeSelection(viewport, flow, row)).toBeUndefined()
  vi.mocked(row.getBoundingClientRect).mockReturnValue(rect(80, 540, 680, 90))
  expect(measureNativeSelection(viewport, flow, row)).toBeUndefined()
  vi.mocked(row.getBoundingClientRect).mockReturnValue(rect(80, 100, 680, 90))
  const wrapper = document.createElement('div'); viewport.append(wrapper); wrapper.append(flow)
  const handle = document.createElement('div'); viewport.append(handle)
  const pointLookup = document.elementsFromPoint
  document.elementsFromPoint = (x: number) => x >= 38 ? [handle, wrapper, viewport] : [wrapper, viewport]
  expect(measureNativeSelection(viewport, flow, row)).toEqual({ left: 0, top: 100 })
  document.elementsFromPoint = () => [wrapper, viewport]
  expect(measureNativeSelection(viewport, flow, row)).toEqual({ left: 38, top: 100 })
  document.elementsFromPoint = pointLookup
  const composer = document.createElement('textarea'); document.body.append(composer)
  const original = document.elementsFromPoint
  document.elementsFromPoint = () => [composer, viewport]
  expect(measureNativeSelection(viewport, flow, row)).toBeUndefined()
  document.elementsFromPoint = original
})

it('hides partial controls and rejects stale geometry', () => {
  expect(sameSelectionPosition({ left: 20, top: 40 }, { left: 20, top: 90 })).toBe(false)
  expect(sameSelectionPosition({ left: 20, top: 40 }, undefined)).toBe(false)
  expect(sameSelectionPosition({ left: 20, top: 40 }, { left: 20, top: 40 })).toBe(true)
})
