import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { ArkmeTimelineItem } from '../types.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { withArkmeReadDeadline } from './read-deadline.js'
import { isArkmeTransientReadFailure } from './read-retry.js'

function currentAccountKey(): string | undefined {
  const auth = arkmeAuthStore.getSnapshot().auth
  return auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : undefined
}

/** Personal lists are previews. All self/topic details read the same Record owner. */
export function usePersonalNoteDetail(
  preview: ArkmeTimelineItem | undefined,
  enabled: boolean,
  sourceKey: string,
  recordRevision: number,
) {
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot).auth
  const accountKey = auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : undefined
  const recordUid = preview?.itemUid ?? ''
  const version = preview?.recordVersion ?? preview?.version ?? 0
  const active = enabled && accountKey !== undefined && recordUid !== ''
  const [attempt, setAttempt] = useState(0)
  const scopeKey = JSON.stringify([active, accountKey, sourceKey, recordUid])
  const requestKey = JSON.stringify([active, accountKey, sourceKey, recordUid, version, recordRevision, attempt])
  const [result, setResult] = useState<{ scopeKey: string; key: string; item?: ArkmeTimelineItem; error?: string }>()
  const retry = useCallback(() => { setAttempt(value => value + 1) }, [])

  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    const stopAuth = arkmeAuthStore.subscribe(() => {
      if (currentAccountKey() !== accountKey) controller.abort()
    })
    void withArkmeReadDeadline(signal => callArkme<ArkmeTimelineItem>('record.app.detail', {
      recordUid,
    }, signal), controller.signal).then(item => {
      if (controller.signal.aborted || currentAccountKey() !== accountKey) return
      if (item?.itemUid !== recordUid || item.status !== 1) throw new Error('快记详情暂不可用，请重试')
      if ((item.recordVersion ?? item.version ?? 0) < version) throw new Error('快记详情尚未更新，请重试')
      setResult({ scopeKey, key: requestKey, item })
    }).catch(error => {
      if (controller.signal.aborted || currentAccountKey() !== accountKey) return
      setResult(previous => ({ scopeKey, key: requestKey,
        ...(isArkmeTransientReadFailure(error) && previous?.scopeKey === scopeKey ? { item: previous.item } : {}),
        error: error instanceof Error ? error.message : '快记详情加载失败' }))
    })
    return () => { stopAuth(); controller.abort() }
  }, [active, accountKey, recordUid, version, requestKey, scopeKey])

  const scoped = active && result?.scopeKey === scopeKey ? result : undefined
  const current = scoped?.key === requestKey ? scoped : undefined
  // Background revalidation must not replace a full detail with its list preview.
  // A new account/source/record, a newer preview version, or a definitive owner
  // denial cannot inherit that retained content.
  const retained = scoped?.item && (scoped.item.recordVersion ?? scoped.item.version ?? 0) >= version ? scoped.item : undefined
  // Keep the source-bound actions/topic navigation; content and edit facts belong
  // to Record. The caller applies any pending re-edit after this canonical read.
  let item = preview
  if (preview && retained) {
    const { messageActionRef: _action, recordDeletionRef: _deletion,
      recordTopicAssignmentRef: _assignment, recordTopicAssignmentTopicKey: _assignmentTopic,
      selfTopic: _topic, hasManualEdit, ...record } = retained
    item = { ...preview, ...record, ...(hasManualEdit === undefined ? {} : { hasManualEdit }) }
  }
  return {
    item,
    loading: active && current === undefined && retained === undefined,
    error: current?.error,
    retry,
  }
}
