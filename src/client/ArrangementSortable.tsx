import { useLayoutEffect, useRef, type HTMLAttributes, type ReactNode } from 'react'
import { useDroppable, PointerSensor } from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
/** Original content remains selectable and nested controls never activate dragging. */
export class ArrangementPointerSensor extends PointerSensor {
  static activators: typeof PointerSensor.activators = [{ eventName: 'onPointerDown', handler: (event, options) => {
    const target = event.nativeEvent.target as Element | null
    if (target?.closest('button,a,input,textarea,select,[contenteditable=true],.arkme-arrangement-content')) return false
    if (window.getSelection()?.toString()) return false
    return PointerSensor.activators[0]!.handler(event, options)
  } }]
}
/** The header's lower edge belongs to the first insertion slot, not outside the board. */
export function ArrangementDropHeader({ id, disabled, children }: { id: string; disabled: boolean; children: ReactNode }) {
  const { setNodeRef } = useDroppable({ id: `top:${id}`, disabled, data: { status: id, edge: 'start' } })
  return <header ref={setNodeRef} className="arkme-arrangement-column-header">{children}</header>
}
export function ArrangementDropList({ id, disabled, children }: { id: string; disabled: boolean; children: ReactNode }) {
  const { setNodeRef } = useDroppable({ id: `column:${id}`, disabled, data: { status: id } })
  return <div ref={setNodeRef} className="arkme-arrangement-drop-list">{children}</div>
}
export function ArrangementSortableCard({ id, status, disabled, reducedMotion, children, ...props }: Omit<HTMLAttributes<HTMLElement>, 'id'> & { id: string; status: string; disabled: boolean; reducedMotion: boolean }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id, disabled, data: { status }, transition: reducedMotion ? null : { duration: 180, easing: 'ease' } })
  return <article {...attributes} {...props} ref={setNodeRef} data-arrangement-ref={id} draggable={false} data-sort-disabled={disabled} data-dragging={isDragging}
    style={{ ...props.style, transform: CSS.Transform.toString(transform), transition, touchAction: 'pan-y' }}
    onPointerDown={event => { props.onPointerDown?.(event); listeners?.onPointerDown?.(event) }}
    onKeyDown={event => { props.onKeyDown?.(event); if (!event.defaultPrevented) listeners?.onKeyDown?.(event) }}>{children}</article>
}
/** Clone the already rendered card, so an overlay neither refetches nor changes height. */
export function ArrangementDragSnapshot({ node, width, height }: { node: HTMLElement; width: number; height: number }) {
  const root = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const clone = node.cloneNode(true) as HTMLElement
    clone.setAttribute('inert', ''); clone.removeAttribute('data-arrangement-ref'); clone.removeAttribute('id'); clone.removeAttribute('tabindex')
    clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'))
    clone.style.transform = ''; clone.style.transition = ''; clone.style.margin = '0'; clone.style.height = '100%'; clone.style.boxSizing = 'border-box'
    clone.dataset.dragging = 'false'
    root.current?.replaceChildren(clone)
  }, [node])
  return <div ref={root} aria-hidden="true" className="arkme-arrangement-drag-snapshot" style={{ width, height }} />
}
