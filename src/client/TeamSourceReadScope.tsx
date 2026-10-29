import { useEffect, useState, type ReactNode } from 'react'
import { callArkme } from './api.js'
import { subscribeTeamMessageChanges } from './team-messaging-events.js'

/** Frozen local references retain intent, but only a current read may display their material. */
export function TeamSourceReadScope({ accountKey, conversationRef, messageRef, version, children }: {
  accountKey: string | undefined; conversationRef: string | undefined; messageRef: string; version: number
  children(authorized: boolean): ReactNode
}) {
  const identity = JSON.stringify([accountKey, conversationRef, messageRef, version])
  const [authorized, setAuthorized] = useState<string>()
  useEffect(() => {
    const controller = new AbortController()
    let generation = 0
    const validate = () => {
      const token = ++generation
      setAuthorized(undefined)
      if (!accountKey || !conversationRef || version <= 0) return
      void callArkme('team.app.preflight', { conversationRef, selections: [{messageRef, version}], expectedAccountKey: accountKey }, controller.signal)
        .then(() => { if (!controller.signal.aborted && token === generation) setAuthorized(identity) })
        .catch(() => { /* The frozen intent remains editable; stale source material stays hidden. */ })
    }
    const stop = subscribeTeamMessageChanges((account, receiptOnly) => { if (account === accountKey && !receiptOnly) validate() })
    validate()
    window.addEventListener('online', validate)
    window.addEventListener('focus', validate)
    return () => { controller.abort(); stop(); window.removeEventListener('online',validate); window.removeEventListener('focus',validate) }
  }, [identity])
  return children(authorized === identity)
}
