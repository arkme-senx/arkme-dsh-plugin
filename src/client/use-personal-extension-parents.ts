import { useEffect, useRef, useState } from 'react'
import type { ArkmeTimelineItem, ArkmeTimelineExtensionParent, ArkmeTimelineAroundPage } from '../types.js'
import { subscribeMessageQuoteInvalidations } from './message-quote-invalidations.js'
import { callArkme } from './api.js'
const EMPTY_PARENTS: ReadonlyMap<string, ArkmeTimelineExtensionParent> = new Map()

/** Topic projections can omit a cross-topic edge. Enrich visible rows, not the whole history. */
export function usePersonalExtensionParents(
  scope: string, sourceRef: string | undefined, items: readonly ArkmeTimelineItem[], sourceKey?: string, isChat = false,
): ReadonlyMap<string, ArkmeTimelineExtensionParent> {
  const [snapshot, setSnapshot] = useState({ scope: '', parents: new Map<string, ArkmeTimelineExtensionParent>() })
  const [epoch, setEpoch] = useState(0)
  useEffect(() => subscribeMessageQuoteInvalidations(changedSource => {
    if (changedSource && sourceKey && changedSource !== sourceKey) return
    completed.current.keys.clear()
    // Clear reference text immediately; an unavailable re-read cannot leave an old quote visible.
    setSnapshot(current => ({ scope, parents: new Map(items.flatMap(item => {
      const parent = current.scope === scope ? current.parents.get(item.itemUid) ?? item.extensionParent : item.extensionParent
      if (!parent?.quote && parent?.quoteState === undefined) return []
      const { quote: _quote, ...safe } = parent
      return [[item.itemUid, { ...safe, textContent: '', title: '', contentBlocks: [], quoteState: 'unavailable' as const }] as const]
    })) }))
    setEpoch(value => value + 1)
  }), [scope, sourceKey, items])
  const completed = useRef({ scope: '', keys: new Set<string>() })
  if (completed.current.scope !== scope) completed.current = { scope, keys: new Set() }
  useEffect(() => {
    if (!sourceRef || typeof IntersectionObserver === 'undefined' || typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return
    const controller = new AbortController()
    const done = completed.current.keys
    const byUid = new Map(items.filter(item => item.messageActionRef && ((!isChat && item.extensionParent === undefined) || item.extensionParent?.quoteState !== undefined || item.extensionParent?.quote !== undefined)
      && item.status === 1 && !item.itemUid.includes('-operation:')).map(item => [item.itemUid, item]))
    const queued = new Set<string>()
    const queue: ArkmeTimelineItem[] = []
    let active = 0
    const keyOf = (item: ArkmeTimelineItem) => `${item.itemUid}:${item.recordVersion ?? item.version ?? 0}`
    const drain = () => {
      while (!controller.signal.aborted && active < 2 && queue.length > 0) {
        const item = queue.shift()!
        active += 1
        const read = isChat
          ? callArkme<ArkmeTimelineAroundPage>('source.timeline-around', { sourceRef, itemUid: item.itemUid, recordOwnerUserId: item.recordOwnerUserId, beforeLimit: 1, afterLimit: 1 }, controller.signal).then(page => {
              const current = page.items.find(candidate => candidate.itemUid === item.itemUid && candidate.sequence === item.sequence && candidate.recordOwnerUserId === item.recordOwnerUserId)
              if (!current) throw new Error('Quoted occurrence unavailable')
              return { recordUid: current.itemUid, extensionParent: current.extensionParent }
            })
          : callArkme<{ recordUid: string; extensionParent?: ArkmeTimelineExtensionParent }>('source.message-extension.parent', { sourceRef, messageActionRef: item.messageActionRef }, controller.signal)
        void read.then(result => {
          if (controller.signal.aborted || result.recordUid !== item.itemUid) return
          done.add(keyOf(item))
          setSnapshot(current => {
            if (result.extensionParent === undefined && !current.parents.has(item.itemUid)) return current
            const parents = new Map(current.scope === scope ? current.parents : [])
            if (result.extensionParent === undefined && item.extensionParent?.quoteState !== undefined) { const { quote: _quote, ...safe } = item.extensionParent; parents.set(item.itemUid, { ...safe, title: '', textContent: '', contentBlocks: [], quoteState: 'unavailable' }) }
            else if (result.extensionParent === undefined) parents.delete(item.itemUid)
            else parents.set(item.itemUid, result.extensionParent)
            return { scope, parents }
          })
        }).catch(() => {
          // A failed optional preview never hides the message. Opening its full
          // detail performs a fresh read with an explicit retry affordance.
        }).finally(() => { active -= 1; drain() })
      }
    }
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const uid = entry.target.getAttribute('data-arkme-message-item-uid') ?? ''
        const item = byUid.get(uid)
        if (item === undefined || done.has(keyOf(item)) || queued.has(uid)) continue
        queued.add(uid)
        queue.push(item)
      }
      drain()
    }, { rootMargin: '100px' })
    for (const element of document.querySelectorAll('[data-arkme-message-item-uid]')) observer.observe(element)
    return () => { controller.abort(); observer.disconnect() }
  }, [scope, sourceRef, items, epoch, isChat])
  return snapshot.scope === scope ? snapshot.parents : EMPTY_PARENTS
}
