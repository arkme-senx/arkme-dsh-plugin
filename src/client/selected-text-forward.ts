import { readSelectedTextNoteQuote, selectedTextNoteHeader, type SelectedTextNoteQuote } from '../selected-text-note.js'
import type { ArkmeSourceSendResult } from '../types.js'
import { callArkme } from './api.js'
import { nativeForwardDelivery } from './native-forward-entry.js'
import { openLocalSnapshotForward } from './local-snapshot-forward.js'

export function selectedTextForwardContent(accountKey: string, quote: SelectedTextNoteQuote) {
  const userId = Number(accountKey.split(':').at(-1))
  const frozen = readSelectedTextNoteQuote(quote)
  if (!Number.isSafeInteger(userId) || userId <= 0 || !frozen) throw new Error('账号或选中文字无效，请重新选择')

  // The existing picker opens immediately. All targets in its first send share
  // one source check, and retries keep the same successfully prepared snapshot.
  let prepared: Promise<SelectedTextNoteQuote> | undefined
  return {
    userId,
    preview: { title: selectedTextNoteHeader(frozen), subtitle: frozen.text, quote: structuredClone(frozen) },
    delivery: nativeForwardDelivery(async (target, identity, commentText, signal) => {
      signal.throwIfAborted()
      prepared ??= callArkme<SelectedTextNoteQuote>('selected-text.prepare', {
        expectedAccountKey: accountKey,
        quote: structuredClone(frozen),
      }, signal).then(snapshot => {
        signal.throwIfAborted()
        return snapshot
      }).catch(error => {
        prepared = undefined
        throw error
      })
      const snapshot = await prepared
      signal.throwIfAborted()
      return callArkme<ArkmeSourceSendResult>('selected-text.forward', {
        expectedAccountKey: accountKey,
        targetSourceRef: target.sourceRef,
        recordUid: identity.recordUid,
        relationUid: identity.commentRecordUid,
        quote: structuredClone(snapshot),
        commentText,
        sendAtMillis: identity.sendAtMillis,
      }, signal)
    }),
  }
}

export function forwardSelectedText(accountKey: string, quote: SelectedTextNoteQuote, signal: AbortSignal) {
  return openLocalSnapshotForward(selectedTextForwardContent(accountKey, quote), signal)
}
