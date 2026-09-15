/** Geometry and gesture ownership only: keys have no message or permission semantics. */
export interface RegionMarqueeItem { key: string; element: HTMLElement }
export interface RegionMarqueePort {
  /** Blank space before a control may start a drag; it never expands the viewport. */
  getStartArea?(): { element: HTMLElement; boundary: HTMLElement } | undefined
  canStart(): boolean
  getItems(): readonly RegionMarqueeItem[]
  onCommit(keys: ReadonlySet<string>): void
  onRect(rect: DOMRect | undefined): void
}

const interactive = 'button,a,input,textarea,select,video,audio,img,[contenteditable]:not([contenteditable="false"]),[draggable="true"],[role="button"],[role="checkbox"],[role="slider"],[role="separator"],[data-marquee-ignore]'

function overText(target: Element, viewport: HTMLElement, x: number, y: number): boolean {
  for (let element: Element | null = target; element && element !== viewport; element = element.parentElement) {
    for (const node of element.childNodes) {
      if (node.nodeType !== 3 || !node.textContent?.trim()) continue
      const range = viewport.ownerDocument.createRange()
      range.selectNodeContents(node)
      for (const box of range.getClientRects()) {
        if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return true
      }
    }
  }
  return false
}

export interface RegionMarqueeHandle { cancel(): void; dispose(): void }

export function attachRegionMarquee(viewport: HTMLElement, port: RegionMarqueePort): RegionMarqueeHandle {
  const doc = viewport.ownerDocument
  const win = doc.defaultView!
  let drag: { startSurface: HTMLElement; pointerId: number; x: number; y: number; anchorX: number; anchorY: number; active: boolean; keys: Set<string> } | undefined
  let frame: number | undefined
  let suppressedClickPointerId: number | undefined
  let previousUserSelect = ''
  let previousUserSelectPriority = ''

  function bounds() {
    const box = viewport.getBoundingClientRect()
    return new DOMRect(box.left + viewport.clientLeft, box.top + viewport.clientTop, viewport.clientWidth, viewport.clientHeight)
  }
  function stop() {
    if (frame !== undefined) win.cancelAnimationFrame(frame)
    frame = undefined
    if (drag?.active) {
      if (previousUserSelect) viewport.style.setProperty('user-select', previousUserSelect, previousUserSelectPriority)
      else viewport.style.removeProperty('user-select')
    }
    drag = undefined
    doc.removeEventListener('selectstart', preventNativeSelection, true)
    doc.removeEventListener('pointermove', move, true)
    doc.removeEventListener('pointerup', up, true)
    doc.removeEventListener('pointercancel', pointerCancelled, true)
    doc.removeEventListener('keydown', keydown, true)
    win.removeEventListener('blur', cancel)
    win.removeEventListener('resize', cancel)
    doc.removeEventListener('visibilitychange', visibility)
    viewport.removeEventListener('scroll', update)
    port.onRect(undefined)
  }
  function preventNativeSelection(event: Event) { if (drag?.active) event.preventDefault() }
  function suppressReleaseClick() { suppressedClickPointerId = drag?.pointerId }
  function cancel() { if (drag?.active) suppressReleaseClick(); stop() }
  function pointerCancelled(event: PointerEvent) { if (event.pointerId === drag?.pointerId) cancel() }
  function keydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return
    if (drag?.active) { event.preventDefault(); event.stopPropagation() }
    cancel()
  }
  function visibility() { if (doc.visibilityState === 'hidden') cancel() }
  function update() {
    if (!drag) return
    const box = bounds()
    if (box.width <= 0 || box.height <= 0) { cancel(); return }
    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
    const startX = clamp(box.left + drag.anchorX - viewport.scrollLeft, box.left, box.right)
    const startY = clamp(box.top + drag.anchorY - viewport.scrollTop, box.top, box.bottom)
    const endX = clamp(drag.x, box.left, box.right)
    const endY = clamp(drag.y, box.top, box.bottom)
    const rect = new DOMRect(Math.min(startX, endX), Math.min(startY, endY), Math.abs(startX - endX), Math.abs(startY - endY))
    if (!drag.active) {
      if (rect.width * rect.height <= 600) return
      drag.active = true
      const selection = win.getSelection()
      if (selection && (viewport.contains(selection.anchorNode) || viewport.contains(selection.focusNode)
        || drag.startSurface.contains(selection.anchorNode) || drag.startSurface.contains(selection.focusNode))) selection.removeAllRanges()
      previousUserSelect = viewport.style.getPropertyValue('user-select')
      previousUserSelectPriority = viewport.style.getPropertyPriority('user-select')
      viewport.style.setProperty('user-select', 'none')
    }
    port.onRect(rect)
    if (rect.width === 0 || rect.height === 0) return
    for (const { key, element } of port.getItems()) {
      const item = element.getBoundingClientRect()
      if (viewport.contains(element) && item.width > 0 && item.height > 0
        && item.left < rect.right && item.right > rect.left && item.top < rect.bottom && item.bottom > rect.top) drag.keys.add(key)
    }
  }
  function scrollFrame() {
    frame = undefined
    update()
    if (!drag?.active) return
    const box = bounds()
    const distance = drag.y < box.top ? drag.y - box.top : drag.y > box.bottom ? drag.y - box.bottom : 0
    if (distance === 0) return
    const before = viewport.scrollTop
    viewport.scrollTop = Math.max(0, Math.min(viewport.scrollHeight - viewport.clientHeight, before + Math.sign(distance) * Math.min(11, Math.abs(distance) / 4)))
    update()
    if (drag && before !== viewport.scrollTop) frame = win.requestAnimationFrame(scrollFrame)
  }
  function move(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return
    if (event.buttons !== 1) { cancel(); return }
    drag.x = event.clientX; drag.y = event.clientY
    // High-frequency pointer events update coordinates; geometry is read once per frame.
    if (!drag.active) update()
    if (drag?.active) {
      event.preventDefault()
      if (frame === undefined) frame = win.requestAnimationFrame(scrollFrame)
    }
  }
  function up(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return
    drag.x = event.clientX; drag.y = event.clientY
    update()
    const keys = drag?.active ? new Set(drag.keys) : undefined
    if (drag?.active) { event.preventDefault(); suppressReleaseClick() }
    stop()
    if (keys?.size) port.onCommit(keys)
  }
  function down(event: PointerEvent) {
    if (!port.canStart()) return
    if (event.defaultPrevented || event.pointerType !== 'mouse' || !event.isPrimary || event.buttons !== 1 || event.button !== 0) return
    if (drag) stop()
    const target = event.target
    if (!(target instanceof win.Element) || target.closest(interactive)) return
    const box = bounds()
    if (event.clientX < box.left || event.clientX >= box.right) return
    let startSurface = viewport
    if (!viewport.contains(target) || event.clientY < box.top || event.clientY >= box.bottom) {
      const area = port.getStartArea?.()
      if (!area || !area.element.contains(target)) return
      const areaBox = area.element.getBoundingClientRect()
      const boundary = area.boundary.getBoundingClientRect()
      if (event.clientY < Math.max(box.bottom, areaBox.top) || event.clientY >= Math.min(areaBox.bottom, boundary.top)
        || event.clientX < areaBox.left || event.clientX >= areaBox.right) return
      startSurface = area.element
    }
    if (overText(target, startSurface, event.clientX, event.clientY)) return
    drag = { startSurface, pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      anchorX: event.clientX - box.left + viewport.scrollLeft, anchorY: Math.min(event.clientY, box.bottom) - box.top + viewport.scrollTop,
      active: false, keys: new Set() }
    // Only an active marquee owns native selection; preserve ordinary clicks
    // and below-threshold drags before taking over the gesture.
    doc.addEventListener('selectstart', preventNativeSelection, true)
    doc.addEventListener('pointermove', move, { capture: true, passive: false })
    doc.addEventListener('pointerup', up, true)
    doc.addEventListener('pointercancel', pointerCancelled, true)
    doc.addEventListener('keydown', keydown, true)
    win.addEventListener('blur', cancel)
    win.addEventListener('resize', cancel)
    doc.addEventListener('visibilitychange', visibility)
    viewport.addEventListener('scroll', update)
  }
  function nextGesture() { suppressedClickPointerId = undefined }
  function click(event: PointerEvent) {
    if (suppressedClickPointerId !== undefined && event.pointerId === suppressedClickPointerId) {
      suppressedClickPointerId = undefined
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }
  doc.addEventListener('pointerdown', down)
  doc.addEventListener('pointerdown', nextGesture, true)
  doc.addEventListener('click', click, true)
  return {
    cancel,
    dispose() {
      stop()
      doc.removeEventListener('pointerdown', down)
      doc.removeEventListener('pointerdown', nextGesture, true)
      doc.removeEventListener('click', click, true)
    },
  }
}
