import { callArkme } from './api.js'
import type { MessageMarkTransport } from './message-underline-session.js'
import type { MessageSelectionTarget } from './ArkmeMessageTextSelection.js'
import type { MessageUnderlineSnapshot } from '../message-annotations.js'

export const arkoMessageMarkTransport: MessageMarkTransport = {
  capabilities: (sourceRef, signal) => callArkme('arko.local-mark.capabilities', { sourceRef }, signal),
  list: async (sourceRef, markRefs, signal) => {
    const rows: { actionRef: string; snapshot: MessageUnderlineSnapshot }[] = []
    // References contain the authenticated text projection; bound batches for long replies.
    for (let start = 0; start < markRefs.length;) {
      let end = start, bytes = 0
      while (end < markRefs.length && (end === start || bytes + markRefs[end]!.length < 1_048_576)) bytes += markRefs[end++]!.length
      rows.push(...await callArkme<typeof rows>('arko.local-mark.list', { sourceRef, markRefs: markRefs.slice(start, end) }, signal))
      start = end
    }
    return rows
  },
  change: (sourceRef, markRef, change, signal) => callArkme('arko.local-mark.change', { sourceRef, markRef, change }, signal),
}

export function arkoMessageMarkTarget(message: {
  messageId?: number; sessionId?: number; localMarkRef?: string; role: string; status: string; text: string; createdAtMillis?: number
}, sourceRef: string | undefined): MessageSelectionTarget | undefined {
  if (!sourceRef || !message.localMarkRef || !message.messageId || !message.sessionId
    || message.status !== 'done' || !['user', 'assistant'].includes(message.role)) return undefined
  return { sourceRef, localMarkRef: message.localMarkRef, item: {
    itemUid: `arko:${message.sessionId}:${message.messageId}`, senderName: message.role === 'user' ? '我' : 'Arko',
    isMe: message.role === 'user', sendAtMillis: message.createdAtMillis ?? 0,
    title: '', textContent: message.text, textFormat: message.role === 'assistant' ? 'markdown' : 'plain', status: 1,
  } }
}
