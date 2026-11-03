import { useEffect, useState } from 'react'
import type { ArkmeRecordRevision, ArkmeRecordEditHistoryReader, ArkmeRecordRevisionSnapshot } from '../record-edit-history.js'
import { ArkmeMessageSnapshotDialog } from './ArkmeMessageSnapshotDialog.js'
import { arkmeAuthStore } from './auth-store.js'
import { withArkmeReadDeadline } from './read-deadline.js'

/** Read only the selected revision. Current-message capture data is never a fallback. */
export function ArkmeRecordRevisionSnapshotDialog({ revision, sourceRef, messageActionRef, reader, mine, senderName, onClose }: {
  revision: ArkmeRecordRevision
  sourceRef: string
  messageActionRef: string
  reader: ArkmeRecordEditHistoryReader
  mine: boolean
  senderName: string
  onClose(): void
}) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ detail?: ArkmeRecordRevisionSnapshot; error?: string }>()
  useEffect(() => {
    const controller = new AbortController()
    const auth = arkmeAuthStore.getSnapshot().auth
    const sameAccount = () => {
      const current = arkmeAuthStore.getSnapshot().auth
      return current?.userId === auth?.userId && current?.environment === auth?.environment && current?.status === auth?.status
    }
    const stopAuth = arkmeAuthStore.subscribe(() => { if (!sameAccount()) { controller.abort(); onClose() } })
    setState(undefined)
    void withArkmeReadDeadline(signal => {
      if (!reader.snapshot) throw new Error('该版本的记忆快照暂不可用')
      return reader.snapshot(sourceRef, messageActionRef, revision.revisionUid, signal)
    }, controller.signal).then(detail => {
      if (controller.signal.aborted || !sameAccount()) return
      if (detail.revisionUid !== revision.revisionUid) throw new Error('记忆快照与所选版本不一致')
      setState({ detail })
    }).catch(error => {
      if (!controller.signal.aborted && sameAccount()) setState({ error: error instanceof Error ? error.message : '记忆快照读取失败，请重试' })
    })
    return () => { controller.abort(); stopAuth() }
  }, [sourceRef, messageActionRef, revision.revisionUid, reader, attempt, onClose])
  return <ArkmeMessageSnapshotDialog item={{ ...revision.content, title: revision.content.title ?? '', itemUid: revision.revisionUid,
    senderName, isMe: mine, status: 1, sendAtMillis: revision.editAtMillis }}
    {...(state?.detail === undefined ? {} : { detail: state.detail })}
    {...(state?.error === undefined ? {} : { loadError: state.error })}
    historical loading={!state} onRetry={() => setAttempt(value => value + 1)} onClose={onClose} />
}
