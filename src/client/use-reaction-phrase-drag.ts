import { useEffect, useRef, useState, type PointerEvent } from 'react'
type Drag = { label: string; over?: string; left: number; top: number; width: number; height: number }
export function useReactionPhraseDrag(onMove: (from: string, to: string) => void) {
  const pending = useRef<{ label: string; x: number; y: number; id: number; node: HTMLElement; active: boolean; over?: string | undefined; box: DOMRect; slots: { label: string; box: DOMRect }[] }>(undefined)
  const [drag, setDrag] = useState<Drag>()
  const suppressed = useRef(false)
  const release = () => {
    const state = pending.current; pending.current = undefined
    if (state?.node.hasPointerCapture(state.id)) state.node.releasePointerCapture(state.id)
  }
  const cancel = () => { release(); setDrag(undefined) }
  useEffect(() => () => release(), [])
  return {
    drag, cancel,
    consumeClick: () => { const value = suppressed.current; suppressed.current = false; return value },
    down: (event: PointerEvent<HTMLElement>, label: string) => {
      if (event.button !== 0) return
      cancel(); suppressed.current = false
      const node = event.currentTarget
      const grid = node.closest<HTMLElement>('[data-reaction-sort-grid]')
      const slots = Array.from(grid?.querySelectorAll<HTMLElement>('[data-reaction-sort]') ?? [], element => ({ label: element.dataset.reactionSort!, box: element.getBoundingClientRect() }))
      pending.current = { label, x: event.clientX, y: event.clientY, id: event.pointerId, node: grid ?? node, active: false, box: node.getBoundingClientRect(), slots }
    },
    move: (event: PointerEvent<HTMLElement>) => {
      const state = pending.current
      if (!state || event.pointerId !== state.id) return
      const dx = event.clientX - state.x, dy = event.clientY - state.y
      if (!state.active && Math.hypot(dx, dy) < 6) return
      if (!state.active) state.node.setPointerCapture(state.id)
      state.active = true; suppressed.current = true; event.preventDefault()
      const slot = state.slots.find(slot => event.clientX >= slot.box.left - 4 && event.clientX <= slot.box.right + 4 && event.clientY >= slot.box.top - 6 && event.clientY <= slot.box.bottom + 6)
      if (slot) state.over = slot.label
      setDrag({ label: state.label, ...(state.over ? { over: state.over } : {}), left: state.box.left + dx, top: state.box.top + dy, width: state.box.width, height: state.box.height })
    },
    up: () => { const state = pending.current; if (state?.active && state.over) onMove(state.label, state.over); cancel() },
  }
}
