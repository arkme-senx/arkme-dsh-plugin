import { act, create } from 'react-test-renderer'
import { describe, it, expect, vi } from 'vitest'
import { useReactionPhraseDrag } from '../src/client/use-reaction-phrase-drag.js'
describe('phrase pointer sorting', () => {
  it('distinguishes clicks, previews a drag immediately and cancels without writing', () => {
    const moved = vi.fn(), capture = vi.fn(), release = vi.fn()
    const box = { left: 0, top: 0, right: 100, bottom: 28, width: 100, height: 28 }
    const node = { closest: () => grid, getBoundingClientRect: () => box }
    const grid = { setPointerCapture: capture, hasPointerCapture: () => true, releasePointerCapture: release, querySelectorAll: () => [
      { dataset: { reactionSort: 'a' }, getBoundingClientRect: () => box },
      { dataset: { reactionSort: 'b' }, getBoundingClientRect: () => ({ ...box, left: 110, right: 210 }) },
    ] }
    let drag: ReturnType<typeof useReactionPhraseDrag>
    function Harness() { drag = useReactionPhraseDrag(moved); return null }
    let ui: ReturnType<typeof create>
    act(() => { ui = create(<Harness />) })
    const event = { button: 0, clientX: 10, clientY: 10, pointerId: 1, currentTarget: node, preventDefault() {} } as unknown as Parameters<typeof drag.down>[0]
    act(() => drag.down(event, 'a'))
    act(() => drag.move({ ...event, clientX: 12 }))
    expect(drag!.drag).toBeUndefined()
    act(() => drag.up())
    expect(drag!.consumeClick()).toBe(false)
    expect(moved).not.toHaveBeenCalled()
    act(() => drag.down(event, 'a'))
    act(() => drag.move({ ...event, clientX: 130 }))
    expect(drag!.drag).toMatchObject({ label: 'a', over: 'b', left: 120 })
    act(() => drag.up())
    expect(moved).toHaveBeenCalledWith('a', 'b')
    expect(drag!.consumeClick()).toBe(true)
    act(() => drag.down(event, 'a'))
    act(() => drag.move({ ...event, clientX: 130 }))
    act(() => drag.cancel())
    expect(moved).toHaveBeenCalledTimes(1)
    expect(drag!.drag).toBeUndefined()
    act(() => ui!.unmount())
    expect(release).toHaveBeenCalled()
  })
})
