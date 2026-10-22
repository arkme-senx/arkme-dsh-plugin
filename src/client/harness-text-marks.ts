import { callArkme } from './api.js'
import type { MessageMarkTransport } from './message-underline-session.js'
import type { MessageUnderlineSnapshot } from '../message-annotations.js'

export const nativeTextMarkTransport: MessageMarkTransport = {
  capabilities: (sourceRef, signal) => callArkme('native-chat.local-mark.capabilities', { sourceRef }, signal),
  list: async (sourceRef, markRefs, signal) => {
    const rows: { actionRef: string; snapshot: MessageUnderlineSnapshot }[] = []
    // Bound UTF-8 request bytes even for several large answers.
    for (let start = 0; start < markRefs.length;) {
      let end = start, bytes = 0
      while (end < markRefs.length && (end === start || bytes + new TextEncoder().encode(markRefs[end]!).length < 800_000)) {
        bytes += new TextEncoder().encode(markRefs[end++]!).length
      }
      rows.push(...await callArkme<typeof rows>('native-chat.local-mark.list', { sourceRef, markRefs: markRefs.slice(start, end) }, signal))
      start = end
    }
    return rows
  },
  change: (sourceRef, markRef, change, signal) => callArkme('native-chat.local-mark.change', { sourceRef, markRef, change }, signal),
}
