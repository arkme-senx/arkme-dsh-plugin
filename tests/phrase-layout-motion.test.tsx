import { act, create } from 'react-test-renderer'
import { it, expect, vi } from 'vitest'
import { usePhraseLayoutMotion } from '../src/client/use-phrase-layout-motion.js'
it('animates surviving tiles into the deleted gap and releases animations', () => {
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
  const cancel = vi.fn(), animate = vi.fn(() => ({ cancel }))
  let x = 110
  const element = { dataset: { reactionSort: 'b' }, getBoundingClientRect: () => ({ left: x, top: 0 }), animate }
  function Harness({ revision }: { revision: string }) { const ref = usePhraseLayoutMotion(revision); return <div ref={ref} /> }
  let ui: ReturnType<typeof create>
  act(() => { ui = create(<Harness revision="before" />, { createNodeMock: () => ({ querySelectorAll: () => [element], getBoundingClientRect: () => ({ left: 0, top: 0 }) }) }) })
  expect(animate).not.toHaveBeenCalled()
  x = 0
  act(() => ui!.update(<Harness revision="after" />))
  expect(animate).toHaveBeenCalledWith([{ transform: 'translate(110px, 0px)' }, { transform: 'translate(0, 0)' }], expect.objectContaining({ duration: 180 }))
  act(() => ui!.unmount())
  expect(cancel).toHaveBeenCalled()
  vi.unstubAllGlobals()
})

it('ignores panel placement on the first reorder while animating only moved tiles', () => {
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
  let panelX = 8, panelY = 8, tileX = 110
  const moved = vi.fn(() => ({ cancel: vi.fn() })), stationary = vi.fn(() => ({ cancel: vi.fn() }))
  const elements = [
    { dataset: { reactionSort: 'moving' }, getBoundingClientRect: () => ({ left: panelX + tileX, top: panelY + 220 }), animate: moved },
    { dataset: { reactionSort: 'stationary' }, getBoundingClientRect: () => ({ left: panelX + 220, top: panelY + 220 }), animate: stationary },
  ]
  function Harness({ revision }: { revision: string }) { const ref = usePhraseLayoutMotion(revision); return <div ref={ref} /> }
  let ui: ReturnType<typeof create>
  act(() => { ui = create(<Harness revision="open" />, { createNodeMock: () => ({ querySelectorAll: () => elements, getBoundingClientRect: () => ({ left: panelX, top: panelY }) }) }) })
  panelX = 400; panelY = 300; tileX = 0
  act(() => ui!.update(<Harness revision="first-drag" />))
  expect(stationary).not.toHaveBeenCalled()
  expect(moved).toHaveBeenCalledWith([{ transform: 'translate(110px, 0px)' }, { transform: 'translate(0, 0)' }], expect.objectContaining({ duration: 180 }))
  act(() => ui!.unmount())
  vi.unstubAllGlobals()
})
