import { useRef, useState } from 'react'
import type { ArkmeRelatedRecordingItem, ArkmeRelatedRecordingShareResult } from '../types.js'
import { callArkme } from './api.js'
import { tr } from './locale.js'

export interface RelatedRecordingShareStatus {
  busy?: 'share' | 'withdraw'
  message?: string
  error?: string
}

/** List and detail use one mutation owner, including while a request is pending. */
export function useRelatedRecordingSharing(
  scopeKey: string,
  sourceRef: string | undefined,
  onCommitted: (result: ArkmeRelatedRecordingShareResult) => void,
) {
  const scope = useRef({ key: scopeKey })
  if (scope.current.key !== scopeKey) scope.current = { key: scopeKey }
  const currentScope = scope.current
  const pending = useRef(new Map<string, object>())
  const [state, setState] = useState<{ scope: object; statuses: Record<string, RelatedRecordingShareStatus> }>({ scope: currentScope, statuses: {} })
  const committed = useRef(onCommitted)
  committed.current = onCommitted
  const update = (recordingRef: string, status: RelatedRecordingShareStatus) => {
    if (scope.current !== currentScope) return
    setState(previous => ({ scope: currentScope, statuses: {
      ...(previous.scope === currentScope ? previous.statuses : {}), [recordingRef]: status,
    } }))
  }
  const mutate = async (item: ArkmeRelatedRecordingItem, action: 'share' | 'withdraw'): Promise<boolean> => {
    if (!sourceRef || !item.shareActionRef || !item.shareStateKnown || item.isSharedByOther
      || (action === 'share' ? item.isShared : !item.isShared)
      || pending.current.get(item.recordingRef) === currentScope) return false
    pending.current.set(item.recordingRef, currentScope)
    update(item.recordingRef, { busy: action })
    try {
      const result = await callArkme<ArkmeRelatedRecordingShareResult>(`related-recordings.${action}`, {
        sourceRef, actionRef: item.shareActionRef,
      })
      if (scope.current !== currentScope) return false
      // A committed write stays successful even if timeline refresh fails later.
      update(item.recordingRef, { message: tr(action === 'share' ? '已共享到私聊' : '已撤回共享') })
      try { committed.current(result) } catch { /* Projection refresh must not turn a committed share into a failed send. */ }
      return true
    } catch (error) {
      update(item.recordingRef, { error: error instanceof Error ? error.message : tr('操作失败，请稍后重试') })
      return false
    } finally {
      if (pending.current.get(item.recordingRef) === currentScope) pending.current.delete(item.recordingRef)
    }
  }
  return { statuses: state.scope === currentScope ? state.statuses : {}, mutate }
}
