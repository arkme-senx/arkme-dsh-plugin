import { useEffect, useRef, useState } from 'react'
import type { ArkmeTimelineItem, ArkmeTimelineExtensionParent } from '../types.js'
import { callArkme } from './api.js'
const EMPTY_PARENTS: ReadonlyMap<string, ArkmeTimelineExtensionParent> = new Map()

/** Topic projections can omit a cross-topic edge. Enrich visible rows, not the whole history. */
export function usePersonalExtensionParents(
  scope: string, sourceRef: string | undefined, items: readonly ArkmeTimelineItem[],
): ReadonlyMap<string, ArkmeTimelineExtensionParent> {
  const [snapshot, setSnapshot] = useState({ scope: '', parents: new Map<string, ArkmeTimelineExtensionParent>() })
  const completed = useRef({ scope: '', keys: new Set<string>() })
  if (completed.current.scope !== scope) completed.current = { scope, keys: new Set() }
  useEffect(() => {
    if (!sourceRef || typeof IntersectionObserver === 'undefined') return
    const controller = new AbortController()
    const done = completed.current.keys
    const byUid = new Map(items.filter(item => item.messageActionRef && item.extensionParent === undefined
      && item.status === 1 && !item.itemUid.includes('-operation:')).map(item => [item.itemUid, item]))
    const queued = new Set<string>()
    const queue: ArkmeTimelineItem[] = []
    let active = 0
    const keyOf = (item: ArkmeTimelineItem) => `${item.itemUid}:${item.recordVersion ?? item.version ?? 0}`
    const drain = () => {
      while (!controller.signal.aborted && active < 2 && queue.length > 0) {
        const item = queue.shift()!
        active += 1
        void callArkme<{ recordUid: string; extensionParent?: ArkmeTimelineExtensionParent }>(
          'source.message-extension.parent', { sourceRef, messageActionRef: item.messageActionRef }, controller.signal,
        ).then(result => {
          if (controller.signal.aborted || result.recordUid !== item.itemUid) return
          done.add(keyOf(item))
          setSnapshot(current => {
            if (result.extensionParent === undefined && !current.parents.has(item.itemUid)) return current
            const parents = new Map(current.scope === scope ? current.parents : [])
            if (result.extensionParent === undefined) parents.delete(item.itemUid)
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
  }, [scope, sourceRef, items])
  return snapshot.scope === scope ? snapshot.parents : EMPTY_PARENTS
}
