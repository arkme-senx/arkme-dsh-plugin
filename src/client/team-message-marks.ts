import { quoteCanonicalText } from '../message-quote.js'
import { callArkme } from './api.js'
import type { MessageMarkTransport } from './message-underline-session.js'

/** Presentation and persistence machinery are shared; Team authority stays separate. */
export const teamMessageMarkTransport: MessageMarkTransport = {
  capabilities: (conversationRef, signal) => callArkme('team.app.local-mark.capabilities', { conversationRef }, signal),
  list: (conversationRef, markRefs, signal) => callArkme('team.app.local-mark.list', { conversationRef, markRefs }, signal),
  change: (conversationRef, markRef, change, signal, target) => callArkme('team.app.local-mark.change', { conversationRef, markRef, change: change.kind === 'add' ? { ...change, canonical: target ? quoteCanonicalText(target.item) : '' } : change }, signal),
}

export function teamSharedMarkTransport(audience:'team'|'conversation'):MessageMarkTransport {
 return {
  capabilities:(conversationRef,signal)=>callArkme('team.app.mark.capabilities',{conversationRef,audience},signal),
  list:(conversationRef,markRefs,signal)=>callArkme('team.app.mark.list',{conversationRef,audience,markRefs},signal),
  change:(conversationRef,markRef,change,signal)=>callArkme('team.app.mark.change',{conversationRef,audience,markRef,change},signal),
 }
}
