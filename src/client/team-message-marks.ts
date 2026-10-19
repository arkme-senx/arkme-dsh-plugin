import { callArkme } from './api.js'
import type { MessageMarkTransport } from './message-underline-session.js'

/** Presentation and persistence machinery are shared; Team authority stays separate. */
export const teamMessageMarkTransport: MessageMarkTransport = {
  capabilities: (conversationRef, signal) => callArkme('team.app.local-mark.capabilities', { conversationRef }, signal),
  list: (conversationRef, markRefs, signal) => callArkme('team.app.local-mark.list', { conversationRef, markRefs }, signal),
  change: (conversationRef, markRef, change, signal) => callArkme('team.app.local-mark.change', { conversationRef, markRef, change }, signal),
}
