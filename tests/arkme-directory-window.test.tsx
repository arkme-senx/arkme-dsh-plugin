import React from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { ArkmeDirectoryWindow } from '../src/client/ArkmeDirectoryWindow.js'

afterEach(() => { vi.unstubAllGlobals() })

it('mounts only the initial directory chunk and keeps an offscreen selected row available', () => {
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
  const rows = Array.from({ length: 240 }, (_, index) => <button key={String(index)}>Row {index}</button>)
  let view: ReturnType<typeof create>
  act(() => { view = create(<ArkmeDirectoryWindow>{rows}</ArkmeDirectoryWindow>) })
  expect(view!.root.findAllByType('button')).toHaveLength(20)
  act(() => { view!.update(<ArkmeDirectoryWindow activeKey="201">{rows}</ArkmeDirectoryWindow>) })
  expect(view!.root.findAllByType('button')).toHaveLength(40)
  expect(view!.root.findAllByType('button').some(row => row.props.children[1] === 201)).toBe(true)
  act(() => { view!.unmount() })
})


it('keeps all rows reachable without IntersectionObserver', () => {
  vi.stubGlobal('IntersectionObserver', undefined)
  let view: ReturnType<typeof create>
  act(() => { view = create(<ArkmeDirectoryWindow>{Array.from({ length: 45 }, (_, i) => <button key={i}>Row {i}</button>)}</ArkmeDirectoryWindow>) })
  expect(view!.root.findAllByType('button')).toHaveLength(45)
  act(() => { view!.unmount() })
})

it('does not unmount keyboard focus when its chunk leaves the viewport', () => {
  let notify!: (entries: { isIntersecting: boolean }[]) => void
  vi.stubGlobal('IntersectionObserver', class { constructor(callback: typeof notify) { notify = callback } observe() {} disconnect() {} })
  let view: ReturnType<typeof create>
  act(() => { view = create(<ArkmeDirectoryWindow>{[<button key="a">A</button>]}</ArkmeDirectoryWindow>, { createNodeMock: () => ({ closest: () => null, getClientRects: () => [{}], getBoundingClientRect: () => ({ height: 54 }) }) }) })
  const chunk = view!.root.findByProps({ 'data-arkme-directory-chunk': true })
  act(() => { chunk.props.onFocusCapture(); notify([{ isIntersecting: false }]) })
  expect(view!.root.findAllByType('button')).toHaveLength(1)
  act(() => { chunk.props.onBlurCapture({ currentTarget: { contains: () => false }, relatedTarget: null }) })
  expect(view!.root.findAllByType('button')).toHaveLength(0)
  act(() => { view!.unmount() })
})


it('retains visible rows while the entire sidebar panel is hidden', () => {
  let notify!: (entries: { isIntersecting: boolean }[]) => void
  let hidden = false
  vi.stubGlobal('IntersectionObserver', class { constructor(callback: typeof notify) { notify = callback } observe() {} disconnect() {} })
  let view: ReturnType<typeof create>
  act(() => { view = create(<ArkmeDirectoryWindow>{[<button key="a">A</button>]}</ArkmeDirectoryWindow>, { createNodeMock: () => ({ closest: () => null, getClientRects: () => hidden ? [] : [{}], getBoundingClientRect: () => ({ height: hidden ? 0 : 54 }) }) }) })
  const row = view!.root.findByType('button')
  act(() => { hidden = true; notify([{ isIntersecting: false }]) })
  expect(view!.root.findByType('button')).toBe(row)
  act(() => { hidden = false; notify([{ isIntersecting: true }]) })
  expect(view!.root.findByType('button')).toBe(row)
  act(() => { notify([{ isIntersecting: false }]) })
  expect(view!.root.findAllByType('button')).toHaveLength(0)
  act(() => { view!.unmount() })
})


it('materializes an unread jump chunk without changing or unmounting the active conversation', () => {
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
  const rows = Array.from({ length: 240 }, (_, i) => <button key={String(i)}>Row {i}</button>)
  let view: ReturnType<typeof create>
  act(() => { view = create(<ArkmeDirectoryWindow activeKey="21" revealKey="201">{rows}</ArkmeDirectoryWindow>) })
  expect(view!.root.findAllByType('button')).toHaveLength(60)
  expect(view!.root.findAllByType('button').some(row => row.props.children[1] === 201)).toBe(true)
  act(() => { view!.unmount() })
})
