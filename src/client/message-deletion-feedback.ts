import type { ArkmeRecordDeletionResult } from '../record-deletion-contract.js'

/** Confirmed owner versions only. A later restore/edit must be allowed through. */
export class ConfirmedMessageDeletions {
  private versions = new Map<string, number>()
  accept(result: ArkmeRecordDeletionResult) {
    for (const item of result.items) if (item.result === 'deleted') {
      this.versions.set(item.recordUid, Math.max(this.versions.get(item.recordUid) ?? 0, item.version))
    }
  }
  keeps(item: { itemUid: string; recordVersion?: number }) {
    const version = this.versions.get(item.itemUid)
    return version === undefined || (item.recordVersion ?? 0) > version
  }
}

export const MESSAGE_DELETION_DURATION = 420
const ROW = '[data-arkme-conversation-row]'
const MAX_FRAGMENTS = 120
const MAX_CLONED_NODES = 6000
let snapshotSequence = 0

function intersects(a: DOMRect, b: DOMRect) {
  return a.width > 0 && a.height > 0 && a.bottom > b.top && a.top < b.bottom && a.right > b.left && a.left < b.right
}

/** A short-lived, inert visual copy. No handlers, media playback, or duplicated IDs. */
function visualCopy(source: HTMLElement, win: Window): HTMLElement {
  const copy = source.cloneNode(true) as HTMLElement
  const originals = [source, ...source.querySelectorAll<HTMLElement>('*')]
  const copies = [copy, ...copy.querySelectorAll<HTMLElement>('*')]
  const prefix = `arkme-delete-${++snapshotSequence}-`
  const ids = new Map<string, string>()
  originals.forEach((node, index) => { if (node.id) ids.set(node.id, `${prefix}${index}`) })
  originals.forEach((node, index) => {
    const target = copies[index]!
    const computed = win.getComputedStyle(node)
    for (let i = 0; i < computed.length; i++) {
      const property = computed.item(i)
      target.style.setProperty(property, computed.getPropertyValue(property))
    }
    target.style.animation = 'none'
    target.style.transition = 'none'
    for (const attribute of [...target.attributes]) {
      if (/^on/i.test(attribute.name) || /^(autoplay|autofocus|aria-describedby|aria-labelledby)$/.test(attribute.name)) target.removeAttribute(attribute.name)
      else if (attribute.name === 'id') target.id = ids.get(attribute.value)!
      else if (attribute.value.includes('#')) {
        let value = attribute.value
        for (const [id, replacement] of ids) value = value.replaceAll(`#${id}`, `#${replacement}`)
        target.setAttribute(attribute.name, value)
      }
    }
    target.setAttribute('tabindex', '-1')
    if (target.tagName === 'VIDEO' || target.tagName === 'AUDIO') {
      target.removeAttribute('src')
      target.querySelectorAll('source').forEach(child => child.remove())
      target.setAttribute('preload', 'none')
    }
    if (target.tagName === 'IFRAME') { target.removeAttribute('src'); target.removeAttribute('srcdoc') }
  })
  copy.inert = true
  copy.setAttribute('aria-hidden', 'true')
  return copy
}

export interface MessageDeletionMotion { afterRemoval(): void; cancel(): void }

/** Capture before React removes facts; animate the visual copies and surviving rows after commit. */
export function captureMessageDeletion(viewport: HTMLElement, shouldDelete: (item: { itemUid: string; recordVersion?: number }) => boolean): MessageDeletionMotion {
  const doc = viewport.ownerDocument, win = doc.defaultView!
  const bounds = viewport.getBoundingClientRect()
  const rows = [...viewport.querySelectorAll<HTMLElement>(ROW)]
  const visible = rows.filter(row => intersects(row.getBoundingClientRect(), bounds))
  const targets = visible.filter(row => shouldDelete({ itemUid: row.dataset.arkmeMessageItemUid ?? '', recordVersion: Number(row.dataset.arkmeMessageVersion ?? 0) }))
  const reduced = win.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  const animations: Animation[] = []
  const before = new Map(visible.map(row => [row.dataset.arkmeConversationRow!, row.getBoundingClientRect()]))
  const layer = doc.createElement('div')
  layer.dataset.arkmeDeletionEffect = ''
  layer.setAttribute('aria-hidden', 'true'); layer.inert = true
  Object.assign(layer.style, { position: 'fixed', left: `${bounds.left}px`, top: `${bounds.top}px`, width: `${bounds.width}px`, height: `${bounds.height}px`, overflow: 'hidden', pointerEvents: 'none', zIndex: '100', contain: 'strict' })
  let timer: ReturnType<typeof setTimeout> | undefined
  let cancelled = false, started = false, scrollTop = viewport.scrollTop
  const cancel = () => {
    if (cancelled) return
    cancelled = true
    if (timer !== undefined) clearTimeout(timer)
    animations.forEach(animation => animation.cancel())
    layer.remove()
    viewport.removeEventListener('scroll', onScroll)
    viewport.removeEventListener('wheel', cancel)
    viewport.removeEventListener('touchstart', cancel)
    win.removeEventListener('resize', cancel)
  }
  const onScroll = () => { if (viewport.scrollTop !== scrollTop) cancel() }
  const parts: Array<{ element: HTMLElement; x: number; y: number; angle: number; delay: number }> = []
  let remainingFragments = MAX_FRAGMENTS, remainingNodes = MAX_CLONED_NODES
  try {
    targets.forEach((row, rowIndex) => {
      const bubble = row.querySelector<HTMLElement>('.arkme-timed-bubble')
      if (!bubble) return
      const box = bubble.getBoundingClientRect()
      if (!intersects(box, bounds)) return
      const nodes = bubble.querySelectorAll('*').length + 1
      if (remainingFragments < 1 || remainingNodes < nodes) return
      // Bound work even for 100 selections, long Markdown, or many media cards.
      const budget = Math.min(24, Math.floor(remainingFragments / (targets.length - rowIndex)), Math.floor(remainingNodes / nodes))
      const columns = reduced || budget < 4 ? 1 : Math.min(6, Math.max(2, Math.round(box.width / 70)), Math.floor(budget / 2))
      const lines = columns === 1 ? 1 : Math.max(2, Math.min(4, Math.round(box.height / 32), Math.floor(budget / columns)))
      const template = visualCopy(bubble, win)
      Object.assign(template.style, { position: 'absolute', left: '0', top: '0', margin: '0', width: `${box.width}px`, height: `${box.height}px`, maxWidth: 'none', boxSizing: 'border-box', opacity: '1', transform: 'none' })
      // Shared jittered vertices keep neighboring fragments joined on their first frame.
      const points = Array.from({ length: lines + 1 }, (_, y) => Array.from({ length: columns + 1 }, (_, x) => ({
        x: (x + (x > 0 && x < columns ? Math.sin(x * 13 + y * 7) * .18 : 0)) / columns * 100,
        y: (y + (y > 0 && y < lines ? Math.cos(x * 11 + y * 3) * .18 : 0)) / lines * 100,
      })))
      for (let y = 0; y < lines; y++) for (let x = 0; x < columns; x++) {
        const fragment = doc.createElement('div')
        fragment.dataset.arkmeDeletionFragment = ''
        Object.assign(fragment.style, { position: 'absolute', left: `${box.left - bounds.left}px`, top: `${box.top - bounds.top}px`, width: `${box.width}px`, height: `${box.height}px`, pointerEvents: 'none', willChange: 'transform, opacity', transformOrigin: `${(x + .5) / columns * 100}% ${(y + .5) / lines * 100}%` })
        if (columns > 1) fragment.style.clipPath = `polygon(${[points[y]![x]!, points[y]![x + 1]!, points[y + 1]![x + 1]!, points[y + 1]![x]!].map(p => `${p.x}% ${p.y}%`).join(',')})`
        const image = template.cloneNode(true) as HTMLElement
        // Each fragment is an independent inert subtree; strip IDs from subsequent copies.
        if (x || y) { image.removeAttribute('id'); image.querySelectorAll('[id]').forEach(node => node.removeAttribute('id')) }
        fragment.append(image); layer.append(fragment)
        parts.push({ element: fragment, x: (x - (columns - 1) / 2) * 10 + Math.sin(y * 7 + x) * 9, y: 15 + y * 8 + Math.cos(x * 9) * 6, angle: Math.sin(x * 13 + y * 5) * 10, delay: Math.min(rowIndex * 12, 36) + (x + y) % 3 * 10 })
      }
      remainingFragments -= columns * lines; remainingNodes -= columns * lines * nodes
    })
    if (parts.length) doc.body.append(layer)
  } catch { cancel() } // Visual failure must never block an acknowledged deletion.
  return {
    cancel,
    afterRemoval() {
      if (cancelled || started) return
      started = true; scrollTop = viewport.scrollTop
      if (!viewport.isConnected || typeof layer.animate !== 'function') { cancel(); return }
      for (const part of parts) {
        animations.push(part.element.animate(reduced ? [{ opacity: 1 }, { opacity: 0 }] : [
          { opacity: 1, transform: 'translate(0, 0) rotate(0deg) scale(1)' },
          { opacity: .95, offset: .4 },
          { opacity: .6, offset: .7 },
          { opacity: 0, transform: `translate(${part.x}px, ${part.y}px) rotate(${part.angle}deg) scale(.88)` },
        ], { duration: reduced ? 110 : 360, delay: reduced ? 0 : part.delay, easing: 'cubic-bezier(.2,.65,.35,1)', fill: 'both' }))
      }
      if (!reduced) for (const row of viewport.querySelectorAll<HTMLElement>(ROW)) {
        const old = before.get(row.dataset.arkmeConversationRow!), now = row.getBoundingClientRect()
        if (!old || !intersects(now, bounds) || !row.animate) continue
        const x = old.left - now.left, y = old.top - now.top
        if (Math.abs(x) + Math.abs(y) < 1) continue
        // Keep the row's geometry truthful for ResizeObserver/reading anchors.
        // Moving the anchor itself feeds the temporary transform back into scroll restoration.
        for (const child of row.children) if (child instanceof win.HTMLElement && child.animate) {
          animations.push(child.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: 'translate(0, 0)' }], { duration: MESSAGE_DELETION_DURATION, easing: 'cubic-bezier(.22,.75,.25,1)' }))
        }
      }
      viewport.addEventListener('scroll', onScroll, { passive: true })
      viewport.addEventListener('wheel', cancel, { passive: true })
      viewport.addEventListener('touchstart', cancel, { passive: true })
      win.addEventListener('resize', cancel)
      timer = setTimeout(cancel, reduced ? 120 : MESSAGE_DELETION_DURATION + 20)
    },
  }
}
