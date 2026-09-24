import { afterEach, expect, it, vi } from 'vitest'
import { watchVisibleReactionTarget } from '../src/client/reaction-visible-target.js'

afterEach(() => vi.unstubAllGlobals())

it('only subscribes visible messages even when more than 200 historical rows are mounted', () => {
  const observers: { change: (entries: { isIntersecting: boolean }[]) => void; disconnect: ReturnType<typeof vi.fn> }[] = []
  vi.stubGlobal('IntersectionObserver', class {
    disconnect = vi.fn()
    constructor(change: (entries: { isIntersecting: boolean }[]) => void) { observers.push({ change, disconnect: this.disconnect }) }
    observe() {}
  })
  const active = new Set<number>()
  const cleanups = Array.from({ length: 240 }, (_, id) => watchVisibleReactionTarget({ closest: () => null } as unknown as HTMLElement, () => {
    active.add(id)
    return () => { active.delete(id) }
  }))
  expect(active.size).toBe(0)
  observers[0]!.change([{ isIntersecting: true }])
  observers[0]!.change([{ isIntersecting: true }])
  expect([...active]).toEqual([0])
  observers[0]!.change([{ isIntersecting: false }])
  observers[239]!.change([{ isIntersecting: true }])
  expect([...active]).toEqual([239])
  cleanups.forEach(stop => stop())
  expect(active.size).toBe(0)
  expect(observers.every(observer => observer.disconnect.mock.calls.length === 1)).toBe(true)
})
