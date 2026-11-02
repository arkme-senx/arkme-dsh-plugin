import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { ArkmeTimelineItem } from '../types.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { withArkmeReadDeadline } from './read-deadline.js'

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
  const requestKey = JSON.stringify([active, accountKey, sourceKey, recordUid, version, recordRevision, attempt])
  const [result, setResult] = useState<{ key: string; item?: ArkmeTimelineItem; error?: string }>()
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
      setResult({ key: requestKey, item })
    }).catch(error => {
      if (controller.signal.aborted || currentAccountKey() !== accountKey) return
      setResult({ key: requestKey, error: error instanceof Error ? error.message : '快记详情加载失败' })
    })
    return () => { stopAuth(); controller.abort() }
  }, [active, accountKey, recordUid, version, requestKey])

  const current = active && result?.key === requestKey ? result : undefined
  // Keep the source-bound actions/topic navigation; content and edit facts belong
  // to Record. The caller applies any pending re-edit after this canonical read.
  let item = preview
  if (preview && current?.item) {
    const { messageActionRef: _action, recordDeletionRef: _deletion,
      recordTopicAssignmentRef: _assignment, recordTopicAssignmentTopicKey: _assignmentTopic,
      selfTopic: _topic, hasManualEdit, ...record } = current.item
    item = { ...preview, ...record, ...(hasManualEdit === undefined ? {} : { hasManualEdit }) }
  }
  return {
    item,
    loading: active && current === undefined,
    error: current?.error,
    retry,
  }
}
