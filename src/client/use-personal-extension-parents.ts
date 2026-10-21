import { useEffect, useRef, useState } from 'react'
import type { ArkmeTimelineItem, ArkmeTimelineExtensionParent, ArkmeTimelineAroundPage } from '../types.js'
import { subscribeMessageQuoteInvalidations } from './message-quote-invalidations.js'
import { callArkme } from './api.js'
const EMPTY_PARENTS: ReadonlyMap<string, ArkmeTimelineExtensionParent> = new Map()

function unavailableQuote(parent?: ArkmeTimelineExtensionParent): ArkmeTimelineExtensionParent | undefined {
  if (!parent?.quote && parent?.quoteState === undefined) return undefined
  const { quote: _quote, ...safe } = parent
  return { ...safe, textContent: '', title: '', contentBlocks: [], quoteState: 'unavailable' }
}

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
      const safe = unavailableQuote(parent)
      return safe ? [[item.itemUid, safe] as const] : []
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
          if (controller.signal.aborted) return
          if (result.recordUid !== item.itemUid) throw new Error('Quoted occurrence mismatch')
          done.add(keyOf(item))
          setSnapshot(current => {
            if (controller.signal.aborted) return current
            const previous = current.scope === scope ? current.parents.get(item.itemUid) ?? item.extensionParent : item.extensionParent
            const parent = result.extensionParent ?? unavailableQuote(previous)
            if (parent === undefined && !current.parents.has(item.itemUid)) return current
            const parents = new Map(current.scope === scope ? current.parents : [])
            if (parent === undefined) parents.delete(item.itemUid)
            else parents.set(item.itemUid, parent)
            return { scope, parents }
          })
        }).catch(() => {
          // The reply body remains usable, but an unverified cached quotation
          // cannot survive a failed current-source read.
          if (controller.signal.aborted) return
          setSnapshot(current => {
            if (controller.signal.aborted) return current
            const previous = current.scope === scope ? current.parents.get(item.itemUid) ?? item.extensionParent : item.extensionParent
            const safe = unavailableQuote(previous)
            if (!safe) return current
            const parents = new Map(current.scope === scope ? current.parents : [])
            parents.set(item.itemUid, safe)
            return { scope, parents }
          })
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
