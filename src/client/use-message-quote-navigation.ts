import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArkmeTimelineExtensionParent, ArkmeTimelineItem } from '../types.js'
import { messageSelectionTarget } from './ArkmeMessageTextSelection.js'
import { quoteDigest, quoteHighlightRange } from './message-quote-selection.js'

/** Reuses the timeline's around/locate lifecycle. No polling or second history cache. */
export function useMessageQuoteNavigation(scope: string) {
  const pending = useRef<{ parent: ArkmeTimelineExtensionParent; startedAt: number }>()
  const cleanup = useRef<() => void>()
  const [back, setBack] = useState<{ scope: string; item: ArkmeTimelineItem }>()
  const [notice, setNotice] = useState('')
  useEffect(() => { pending.current = undefined; cleanup.current?.(); setBack(undefined); setNotice(''); return () => cleanup.current?.() }, [scope])
  const begin = (parent: ArkmeTimelineExtensionParent, from?: ArkmeTimelineItem) => {
    cleanup.current?.(); pending.current = parent.quote ? { parent, startedAt: Date.now() } : undefined; setNotice('')
    setBack(parent.quote && from ? { scope, item: from } : undefined)
  }
  const located = useCallback((row: HTMLElement, uid: string, scrollBody?: HTMLElement) => {
    const target = pending.current
    if (!target) return
    const { parent, startedAt } = target
    if (parent.itemUid !== uid || !parent.quote || Date.now() - startedAt > 30_000) { pending.current = undefined; return }
    pending.current = undefined
    if ((parent.recordOwnerUserId !== undefined && String(parent.recordOwnerUserId) !== row.dataset.arkmeMessageOwnerId)
      || (parent.sequence !== undefined && String(parent.sequence) !== row.dataset.arkmeMessageSequence)) {
      setNotice('已找到同一条消息，但尚不能确认是被引用的那次发送，未高亮片段'); return
    }
    if (parent.quoteState === 'edited') { setNotice('原消息已编辑，引用保留发送时原话'); return }
    let cancelled = false
    const toggle = row.querySelector<HTMLButtonElement>('[data-arkme-text-toggle][aria-expanded="false"]')
    toggle?.click()
    const frame = requestAnimationFrame(() => { void (async () => {
      if (cancelled) return
      const element = row.querySelector<HTMLElement>('[data-arkme-text-selection]')
      const source = element ? messageSelectionTarget(element) : undefined
      if (!source || await quoteDigest(source.item) !== parent.quote!.sourceDigest) {
        if (!cancelled) setNotice('已找到原消息，原文发生变化，无法准确高亮引用')
        return
      }
      if (cancelled) return
      const range = element ? quoteHighlightRange(element, parent.quote!) : undefined
      if (!range) { setNotice('已找到原消息，原文发生变化，无法准确高亮引用'); return }
      // A long message may be centered while the actual quotation is still off screen.
      if (scrollBody) {
        const rect = range.getBoundingClientRect(), viewport = scrollBody.getBoundingClientRect()
        if (rect.top < viewport.top + 24 || rect.bottom > viewport.bottom - 24) {
          scrollBody.scrollTo({ top: Math.max(0, scrollBody.scrollTop + rect.top - viewport.top - 24), behavior: 'auto' })
        }
      }
      // CSS Highlights does not alter DOM text or the user's selection.
      const api = globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown; CSS?: { highlights?: Map<string, unknown> } }
      if (!api.Highlight || !api.CSS?.highlights) { setNotice('已定位原消息；当前浏览器不支持片段高亮'); return }
      const name = 'arkme-message-quote'
      const style = document.createElement('style')
      style.textContent = `::highlight(${name}) { background: #ffcf6680; color: inherit; }`
      document.head.append(style)
      api.CSS.highlights.set(name, new api.Highlight(range))
      const remove = () => { api.CSS?.highlights?.delete(name); style.remove() }
      const timer = setTimeout(remove, 3_000)
      cleanup.current = () => { cancelled = true; clearTimeout(timer); remove() }
    })() })
    cleanup.current = () => { cancelled = true; cancelAnimationFrame(frame) }
  }, [])
  return { begin, located, back: back?.scope === scope ? back.item : undefined, notice, clear: () => { cleanup.current?.(); pending.current = undefined; setBack(undefined); setNotice('') } }
}
