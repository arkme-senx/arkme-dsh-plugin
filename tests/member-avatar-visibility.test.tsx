import { useRef } from 'react'
import { act, create } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { useArkmeAvatarImage } from '../src/client/use-arkme-avatar-image.js'

const { load, release } = vi.hoisted(() => ({ load: vi.fn(async () => 'image'), release: vi.fn() }))
vi.mock('../src/client/avatar-image-runtime.js', () => ({ arkmeAvatarImages: { load, current: () => undefined, subscribe: () => release } }))

it('loads and subscribes only visible avatars from a 500-member cache', async () => {
  const observers: Array<{ notify(visible: boolean): void; disconnect(): void }> = []
  const disconnected = vi.fn()
  vi.stubGlobal('IntersectionObserver', class {
    constructor(private callback: (entries: Array<{ isIntersecting: boolean }>) => void) { observers.push(this) }
    observe() {}
    notify(visible: boolean) { this.callback([{ isIntersecting: visible }]) }
    disconnect() { disconnected() }
  })
  function Avatar({ index }: { index: number }) {
    const ref = useRef<HTMLSpanElement>(null)
    useArkmeAvatarImage(`member-${index}`, ref)
    return <span ref={ref} />
  }
  const renderer = create(<>{Array.from({ length: 500 }, (_, index) => <Avatar key={index} index={index} />)}</>, { createNodeMock: () => ({}) })
  try {
    await act(async () => {})
    expect(load).not.toHaveBeenCalled()
    await act(async () => { for (const observer of observers.slice(0, 8)) observer.notify(true) })
    expect(load).toHaveBeenCalledTimes(8)
    await act(async () => { for (const observer of observers.slice(0, 8)) observer.notify(false) })
    expect(release).toHaveBeenCalledTimes(8)
    expect(load).toHaveBeenCalledTimes(8)
  } finally { await act(async () => { renderer.unmount() }); vi.unstubAllGlobals() }
  expect(disconnected).toHaveBeenCalledTimes(500)
})
