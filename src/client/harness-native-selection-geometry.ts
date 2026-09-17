import { isSelectableNativeNode, type NativeChat } from './harness-native-selection.js'

const ROW = '[data-chat-anchor-key][data-chat-flow-kind]'
const HIT = 32
const GAP = 10
export interface SelectionPosition { left: number; top: number }
export interface NativeSelectionSeat extends SelectionPosition { key: string; row: HTMLElement }
export interface NativeSelectionLayout { seats: readonly NativeSelectionSeat[]; cramped: boolean; viewport: HTMLElement | null; highlight?: { left: number; right: number }; actionDock?: HTMLElement }

// The composer stays mounted and keeps its height/draft while selection occupies its space.
export const nativeSelectionActionOverlayCss = `
  :has(> [data-slot="conversation.input.dock"] > [data-arkme-native-selection="actions"]) { position: relative; }
  [data-slot="conversation.input.dock"] > [data-arkme-native-selection="actions"] { position: absolute; inset: 0; z-index: 1; }
  [data-slot="conversation.input.dock"]:has(> [data-arkme-native-selection="actions"]) + [data-slot="conversation.composer.bar"] { visibility: hidden; }
`

export function nativeSelectionHighlightSelector(keys: ReadonlySet<string>): string {
  return [...keys].map(key => {
    const escaped = key.replace(/[^\w-]/gu, character => `\\${character.codePointAt(0)!.toString(16)} `)
    return `[data-chat-flow] ${ROW}[data-chat-anchor-key="${escaped}"]`
  }).join(',')
}

function viewportBounds(viewport: HTMLElement) {
  const box = viewport.getBoundingClientRect()
  const left = box.left + viewport.clientLeft
  const top = box.top + viewport.clientTop
  return { left, top, right: left + viewport.clientWidth, bottom: top + viewport.clientHeight }
}

export function measureNativeSelection(viewport: HTMLElement, flow: HTMLElement, row: HTMLElement): SelectionPosition | undefined {
  const clip = viewportBounds(viewport)
  const column = flow.getBoundingClientRect()
  const box = row.getBoundingClientRect()
  let left = column.left - HIT - GAP
  if (!row.isConnected || row.hidden || box.width <= 0 || box.height <= 0
    || left < Math.max(0, clip.left) || left + HIT > Math.min(row.ownerDocument.defaultView!.innerWidth, clip.right) || box.top < Math.max(0, clip.top)
    || box.top + HIT > Math.min(row.ownerDocument.defaultView!.innerHeight, clip.bottom)) return
  // Keep native resize handles/composer/menu hit areas usable. The outer gutter
  // is a second seat only when it still preserves the minimum text gap.
  if (typeof row.ownerDocument.elementsFromPoint === 'function') {
    const clear = (candidate: number) => [[candidate + 1, box.top + 1], [candidate + HIT / 2, box.top + HIT / 2], [candidate + HIT - 1, box.top + HIT - 1]].every(([x, y]) => {
      const underlying = row.ownerDocument.elementsFromPoint(x!, y!).find(element => !element.closest('[data-arkme-native-selection]'))
      return underlying && viewport.contains(underlying) && (underlying === viewport || underlying.contains(flow) || underlying === flow || row.contains(underlying))
    })
    if (!clear(left)) {
      const edge = Math.max(0, clip.left)
      const outer = [edge + 8, edge].find(candidate => candidate <= left && clear(candidate))
      if (outer === undefined) return
      left = outer
    }
  }
  return { left, top: box.top }
}

export function sameSelectionPosition(a: SelectionPosition, b: SelectionPosition | undefined): boolean {
  return b !== undefined && Math.abs(a.left - b.left) < 1 && Math.abs(a.top - b.top) < 1
}

/** Only the adapter knows native DOM attributes. No styles or attributes are written to host elements. */
export function watchNativeSelectionGeometry(options: {
  doc: Document
  chat(): NativeChat
  publish(layout: NativeSelectionLayout): void
  fail(): void
}): { dispose(): void; refresh(): void; valid(seat: NativeSelectionSeat): boolean } {
  const { doc } = options
  const win = doc.defaultView!
  const flows = doc.querySelectorAll<HTMLElement>('[data-chat-flow]')
  if (flows.length !== 1) throw new Error('Native chat flow unavailable')
  const flow = flows[0]!
  let parent = flow.parentElement
  while (parent && !['auto', 'scroll'].includes(win.getComputedStyle(parent).overflowY)) parent = parent.parentElement
  if (!parent) throw new Error('Native chat viewport unavailable')
  const viewport = parent
  const rows = new Set<HTMLElement>()
  const visible = new Set<HTMLElement>()
  const subscriptions = new Map<HTMLElement, { key: string; unsubscribe(): void }>()
  let stopped = false
  let frame = 0
  let nodeStore = options.chat().nodes
  const guard = (work: () => void) => {
    if (stopped) return
    try { work() } catch { dispose(); options.fail() }
  }
  const schedule = () => {
    if (stopped) return
    if (!frame) frame = win.requestAnimationFrame(() => { frame = 0; guard(publish) })
  }
  const resize = new win.ResizeObserver(schedule)
  const intersection = new win.IntersectionObserver(entries => guard(() => {
    for (const entry of entries) {
      const row = entry.target as HTMLElement
      if (entry.isIntersecting && rows.has(row)) { visible.add(row); resize.observe(row) }
      else { visible.delete(row); resize.unobserve(row); subscriptions.get(row)?.unsubscribe(); subscriptions.delete(row) }
    }
    schedule()
  }), { root: viewport })
  const remove = (row: HTMLElement) => {
    intersection.unobserve(row); resize.unobserve(row)
    rows.delete(row); visible.delete(row)
    subscriptions.get(row)?.unsubscribe(); subscriptions.delete(row)
  }
  const addTree = (node: Node) => {
    if (!(node instanceof win.HTMLElement)) return
    const candidates = node.matches(ROW) ? [node] : [...node.querySelectorAll<HTMLElement>(ROW)]
    for (const row of candidates) {
      if (row.closest('[data-chat-flow]') !== flow || row.parentElement?.closest(ROW) || rows.has(row)) continue
      rows.add(row); intersection.observe(row)
    }
  }
  const mutation = new win.MutationObserver(records => guard(() => {
    for (const record of records) {
      for (const node of record.addedNodes) addTree(node)
      for (const node of record.removedNodes) {
        if (!(node instanceof win.HTMLElement)) continue
        const removed = node.matches(ROW) ? [node, ...node.querySelectorAll<HTMLElement>(ROW)] : [...node.querySelectorAll<HTMLElement>(ROW)]
        for (const row of removed) if (!flow.contains(row)) remove(row)
      }
      if (record.type === 'attributes' && record.target instanceof win.HTMLElement && record.target.matches(ROW)) addTree(record.target)
    }
    schedule()
  }))
  function publish() {
    if (!flow.isConnected || !viewport.isConnected) throw new Error('Native chat flow replaced')
    const chat = options.chat()
    if (nodeStore !== chat.nodes) {
      subscriptions.forEach(value => value.unsubscribe()); subscriptions.clear(); nodeStore = chat.nodes
    }
    const seats: NativeSelectionSeat[] = []
    const seen = new Set<string>()
    let blocked = false
    for (const row of visible) {
      const key = row.dataset.chatAnchorKey
      if (!key) continue
      if (subscriptions.get(row)?.key !== key) {
        subscriptions.get(row)?.unsubscribe()
        subscriptions.set(row, { key, unsubscribe: chat.nodes.source(key).subscribe(schedule) })
      }
      const node = chat.nodes.get(key)
      if (!isSelectableNativeNode(node) || node.key !== key || node.kind !== row.dataset.chatFlowKind) continue
      if (seen.has(key)) throw new Error('Ambiguous native message anchor')
      seen.add(key)
      const position = measureNativeSelection(viewport, flow, row)
      if (position) seats.push({ key, row, ...position })
      else {
        const box = row.getBoundingClientRect(); const clip = viewportBounds(viewport)
        if (box.width > 0 && box.height > 0 && box.top >= Math.max(0, clip.top) && box.top + HIT <= Math.min(win.innerHeight, clip.bottom)) blocked = true
      }
    }
    seats.sort((a, b) => a.top - b.top)
    const cramped = flow.getBoundingClientRect().left - viewportBounds(viewport).left < HIT + GAP
    const column = flow.getBoundingClientRect()
    const bounds = viewportBounds(viewport)
    const docks = doc.querySelectorAll<HTMLElement>('[data-slot="conversation.input.dock"]')
    options.publish({ seats, cramped: cramped || (blocked && seats.length === 0), viewport,
      highlight: { left: Math.max(0, column.left - bounds.left - 8), right: Math.max(0, bounds.right - column.right - 8) },
      ...(docks.length === 1 && docks[0]!.nextElementSibling?.matches('[data-slot="conversation.composer.bar"]') ? { actionDock: docks[0]! } : {}),
    })
  }
  function dispose() {
    if (stopped) return
    stopped = true
    if (frame) win.cancelAnimationFrame(frame)
    mutation.disconnect(); intersection.disconnect(); resize.disconnect()
    subscriptions.forEach(value => value.unsubscribe()); subscriptions.clear()
    viewport.removeEventListener('scroll', schedule)
    win.removeEventListener('resize', schedule)
    win.removeEventListener('scroll', schedule, true)
    win.visualViewport?.removeEventListener('resize', schedule)
    win.visualViewport?.removeEventListener('scroll', schedule)
  }
  try {
    addTree(flow)
    mutation.observe(flow, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-chat-anchor-key', 'data-chat-flow-kind', 'hidden', 'class', 'style'] })
    resize.observe(flow); resize.observe(viewport)
    viewport.addEventListener('scroll', schedule, { passive: true })
    win.addEventListener('resize', schedule)
    win.addEventListener('scroll', schedule, { passive: true, capture: true })
    win.visualViewport?.addEventListener('resize', schedule)
    win.visualViewport?.addEventListener('scroll', schedule)
    schedule()
  } catch (error) { dispose(); throw error }
  return {
    dispose, refresh: schedule,
    valid(seat) {
      if (stopped || frame || !flow.isConnected || !flow.contains(seat.row)) return false
      const node = options.chat().nodes.get(seat.key)
      return isSelectableNativeNode(node) && node.key === seat.key && node.kind === seat.row.dataset.chatFlowKind
        && seat.row.dataset.chatAnchorKey === seat.key && sameSelectionPosition(seat, measureNativeSelection(viewport, flow, seat.row))
    },
  }
}


/** Header slots do not inherit the native header's private view/store hooks. */
export function observeNativeChatPresence(doc: Document, publish: (present: boolean) => void): () => void {
  let flow = doc.querySelector('[data-chat-flow]')
  publish(flow !== null)
  const observer = new doc.defaultView!.MutationObserver(records => {
    // Ignore mutations within the current flow and unrelated subtree updates.
    if (flow?.isConnected || !records.some(record => record.addedNodes.length || record.removedNodes.length)) return
    const next = doc.querySelector('[data-chat-flow]')
    if (next !== flow) { flow = next; publish(next !== null) }
  })
  observer.observe(doc.body, { childList: true, subtree: true })
  return () => observer.disconnect()
}

/** Resolve a selectable message body for pointer actions; native controls keep their own behavior. */
export function nativeSelectionMessageRow(doc: Document, target: EventTarget | null, chat: NativeChat): { key: string; row: HTMLElement } | undefined {
  if (!(target instanceof doc.defaultView!.Element) || target.closest('button, a, input, textarea, select, [role="link"], [role="button"], [contenteditable]:not([contenteditable="false"]), [role="menu"], [role="dialog"]')) return
  const row = target.closest<HTMLElement>(ROW)
  const flows = doc.querySelectorAll('[data-chat-flow]')
  if (!row?.isConnected || row.hidden || flows.length !== 1 || row.closest('[data-chat-flow]') !== flows[0]) return
  const key = row.dataset.chatAnchorKey
  if (!key || [...flows[0]!.querySelectorAll<HTMLElement>(ROW)].filter(candidate => candidate.dataset.chatAnchorKey === key).length !== 1) return
  const node = chat.nodes.get(key)
  return isSelectableNativeNode(node) && node.key === key && node.kind === row.dataset.chatFlowKind ? { key, row } : undefined
}

/** Expanded row paint is outside the native row box; resolve only bare scroll/flow space. */
export function nativeSelectionPointerRow(doc: Document, event: MouseEvent, chat: NativeChat, viewport: HTMLElement | null): { key: string; row: HTMLElement } | undefined {
  const direct = nativeSelectionMessageRow(doc, event.target, chat)
  if (direct) return direct
  const target = event.target
  if (!viewport?.isConnected || !(target instanceof doc.defaultView!.Element) || !viewport.contains(target)) return
  const flow = viewport.querySelector<HTMLElement>('[data-chat-flow]')
  if (!flow || !(target === viewport || target === flow || target.contains(flow))) return
  const clip = viewportBounds(viewport)
  if (event.clientX < clip.left + 8 || event.clientX > clip.right - 8 || event.clientY < clip.top || event.clientY > clip.bottom) return
  let nearest: HTMLElement | undefined
  let distance = Infinity
  let ambiguous = false
  for (const row of flow.querySelectorAll<HTMLElement>(ROW)) {
    if (row.hidden || row.parentElement?.closest(ROW)) continue
    const box = row.getBoundingClientRect()
    if (box.width <= 0 || box.height <= 0 || event.clientY < box.top - 8 || event.clientY > box.bottom + 8) continue
    const gap = Math.max(box.top - event.clientY, event.clientY - box.bottom, 0)
    if (gap < distance) { nearest = row; distance = gap; ambiguous = false }
    else if (gap === distance) ambiguous = true
  }
  // Resolve geometry before eligibility: a tool/running row must shield adjacent messages.
  return nearest && !ambiguous ? nativeSelectionMessageRow(doc, nearest, chat) : undefined
}
