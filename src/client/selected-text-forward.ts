import { readSelectedTextNoteQuote, selectedTextNoteHeader, type SelectedTextNoteQuote } from '../selected-text-note.js'
import type { ArkmeSourceSendResult } from '../types.js'
import { callArkme } from './api.js'
import { nativeForwardDelivery } from './native-forward-entry.js'
import { openLocalSnapshotForward } from './local-snapshot-forward.js'

export function selectedTextForwardContent(accountKey: string, quote: SelectedTextNoteQuote) {
  const userId = Number(accountKey.split(':').at(-1)), frozen = readSelectedTextNoteQuote(quote)
  if (!Number.isSafeInteger(userId) || userId <= 0 || !frozen) throw new Error('账号或选中文字无效，请重新选择')
  return { userId, preview: { title: selectedTextNoteHeader(frozen), subtitle: frozen.text, quote: structuredClone(frozen) },
    delivery: nativeForwardDelivery((target, identity, commentText, signal) => {
      signal.throwIfAborted()
      return callArkme<ArkmeSourceSendResult>('selected-text.forward', {
        expectedAccountKey: accountKey, targetSourceRef: target.sourceRef,
        recordUid: identity.recordUid, relationUid: identity.commentRecordUid,
        quote: structuredClone(frozen), commentText,sendAtMillis:identity.sendAtMillis,
      }, signal)
    }),
  }
}
export async function forwardSelectedText(accountKey: string, quote: SelectedTextNoteQuote, signal: AbortSignal) {
  const prepared=await callArkme<SelectedTextNoteQuote>('selected-text.prepare',{expectedAccountKey:accountKey,quote},signal)
  return openLocalSnapshotForward(selectedTextForwardContent(accountKey, prepared), signal)
}
