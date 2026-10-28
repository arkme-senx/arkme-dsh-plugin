import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { ArkmeSourceItem, ArkmeTimelineItem } from '../../types.js'
import type { OfflineContextEntry } from '../../offline-context.js'
import type { OfflineContextCapability, OfflineContextList } from '../../offline-context-contract.js'
import { createArkmeSdk } from '../../sdk/index.js'
import { arkmeChatTimelineDelta } from '../chat-directory-store.js'
import { tr } from '../locale.js'
import css from './offline-context-message-link.css?inline'

const sdk = createArkmeSdk()
/** Batch only loaded messages; a linked card may live outside the loaded window. */
export function useOfflineContextMessageLinks(source: ArkmeSourceItem | undefined, items: ArkmeTimelineItem[], revision: string) {
  const refs = JSON.stringify([...new Set(items.flatMap(item => item.offlineContextMessageRef ? [item.offlineContextMessageRef] : []))].sort())
  const sourceRef = source?.kind === 'private_chat' || source?.kind === 'group_chat' ? source.sourceRef : ''
  const key = `${sourceRef}:${refs}`
  const invalidation = useSyncExternalStore(arkmeChatTimelineDelta.subscribe, () => arkmeChatTimelineDelta.getSnapshotForSource(source?.sourceKey ?? sourceRef).invalidationRevision, () => 0)
  const [result, setResult] = useState<{ key: string; entries: OfflineContextEntry[] }>()
  useEffect(() => {
    const controller = new AbortController()
    const messageRefs = JSON.parse(refs) as string[]
    if (!sourceRef || !messageRefs.length) return () => controller.abort()
    void (async () => {
      const capability = await sdk.offlineContext({ operation: 'capability' }, controller.signal) as OfflineContextCapability
      if (!capability.supported) return
      const entries = new Map<string, OfflineContextEntry>()
      for (let offset = 0; offset < messageRefs.length; offset += 100) {
        const batch = messageRefs.slice(offset, offset + 100)
        const seen = new Set<string>()
        let cursor: string | undefined
        do {
          const page = await sdk.offlineContext({ operation: 'list', sourceRef, state: 'linked', messageRefs: batch, ...(cursor ? { cursor } : {}) }, controller.signal) as OfflineContextList
          for (const entry of page.entries) if (entry.state === 'linked' && entry.sourceState === 'available') entries.set(entry.id, entry)
          cursor = page.nextCursor
          if (page.hasMore && (!cursor || seen.has(cursor))) throw new Error('Invalid association cursor')
          if (cursor) seen.add(cursor)
        } while (cursor)
      }
      if (!controller.signal.aborted) setResult({ key, entries: [...entries.values()] })
    })().catch(() => { if (!controller.signal.aborted) setResult(undefined) })
    return () => controller.abort()
  }, [sourceRef, refs, key, invalidation, revision])
  return useMemo(() => {
    const links = new Map<string, OfflineContextEntry>()
    if (result?.key === key) for (const entry of result.entries) for (const message of entry.messages) {
      if (!links.has(message.messageRef)) links.set(message.messageRef, entry)
    }
    return links
  }, [result, key])
}

/** Same message-side action and visual treatment as the colleague's preview. */
export function OfflineContextMessageLink({ onOpen }: { onOpen(): void }) {
  return <><style>{css}</style><button type="button" className="arkme-offline-message-link" onClick={event => { event.stopPropagation(); onOpen() }}>{tr('线下已讨论 ↗')}</button></>
}
