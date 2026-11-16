import { useEffect, useMemo, useRef, useState } from 'react'
import type { ArkmeTimelineItem } from '../types.js'
import { callArkme } from './api.js'

interface Presentation {
  ref: string
  senderName: string
  avatarRef?: string
}
type Seen = { checkedAt: number; value?: Presentation }

export function useTimelineBotPresentations(account: string | undefined, sourceKey: string, sourceRef: string | undefined,
  items: readonly ArkmeTimelineItem[]): ReadonlyMap<string, Seen> | undefined {
  const scope = account && sourceRef ? JSON.stringify([account, sourceKey]) : undefined
  const cache = useRef<{ scope: string; entries: Map<string, Seen> } | undefined>(undefined)
  const [published, setPublished] = useState<typeof cache.current>()
  const refsKey = useMemo(() => {
    const refs = new Set<string>()
    for (const item of items) {
      if (item.senderBotPresentationRef) refs.add(item.senderBotPresentationRef)
      if (item.extensionParent?.senderBotPresentationRef) refs.add(item.extensionParent.senderBotPresentationRef)
    }
    return [...refs].sort().join(',')
  }, [items])
  useEffect(() => {
    if (!scope || !sourceRef) {
      cache.current = undefined
      return
    }
    if (cache.current?.scope !== scope) cache.current = { scope, entries: new Map() }
    const current = cache.current
    const refs = refsKey ? refsKey.split(',') : []
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    async function refresh(ref: string) {
      const now = Date.now()
      const pending = refs.filter(key => {
        const seen = current.entries.get(key)
        return !seen || now - seen.checkedAt >= 60_000
      })
      for (let offset = 0; offset < pending.length && !controller.signal.aborted; offset += 100) {
        const batch = pending.slice(offset, offset + 100)
        try {
          const response = await callArkme<Presentation[]>('source.bot-senders.presentation', { sourceRef: ref, refs: batch }, controller.signal)
          if (controller.signal.aborted || cache.current !== current) return
          const profiles = new Map(response.map(profile => [profile.ref, profile]))
          let changed = false
          for (const key of batch) {
            const previous = current.entries.get(key)?.value
            const value = profiles.get(key) ?? previous
            if (previous?.senderName !== value?.senderName || previous?.avatarRef !== value?.avatarRef) changed = true
            current.entries.delete(key)
            current.entries.set(key, { checkedAt: Date.now(), ...(value ? { value } : {}) })
          }
          while (current.entries.size > 512) current.entries.delete(current.entries.keys().next().value!)
          if (changed) setPublished({ scope: current.scope, entries: new Map(current.entries) })
        } catch {
          // An optional decoration can retry after the next page or refresh interval.
        }
      }
      if (!controller.signal.aborted && refs.length) timer = setTimeout(() => { void refresh(ref) }, 60_000)
    }
    if (refs.length) void refresh(sourceRef)
    return () => { controller.abort(); clearTimeout(timer) }
  }, [scope, sourceRef, refsKey])
  return published?.scope === scope ? published?.entries : undefined
}

export function presentTimelineBotSender(item: ArkmeTimelineItem, entries: ReadonlyMap<string, Seen> | undefined): ArkmeTimelineItem {
  if (!entries) return item
  const sender = item.senderBotPresentationRef ? entries.get(item.senderBotPresentationRef)?.value : undefined
  const parent = item.extensionParent
  const parentSender = parent?.senderBotPresentationRef ? entries.get(parent.senderBotPresentationRef)?.value : undefined
  const senderName = sender?.senderName || item.senderName
  const avatarRef = sender?.avatarRef ?? item.avatarRef
  if (senderName === item.senderName && avatarRef === item.avatarRef && (!parentSender?.senderName || parentSender.senderName === parent?.senderName)) return item
  return { ...item, senderName, ...(avatarRef ? { avatarRef } : {}),
    ...(parent && parentSender?.senderName ? { extensionParent: { ...parent, senderName: parentSender.senderName } } : {}) }
}
