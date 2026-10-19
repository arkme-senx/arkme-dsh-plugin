import { useEffect, useRef, useState } from 'react'
import type { TeamConversation, TeamIdentity } from '../team-app-contract.js'
import { callArkme } from './api.js'

/** Remarks are viewer-owned, optional enrichment; never delay the timeline on them. */
export function useTeamPersonNames(conversation: TeamConversation, accountKey: string, people: readonly TeamIdentity[]) {
  const scope = `${accountKey}:${conversation.key}`
  const [state, setState] = useState<{ scope: string; names: Record<string, string> }>({ scope, names: {} })
  const [refresh, setRefresh] = useState(0)
  const current = useRef({ conversation, people }); current.current = { conversation, people }
  const keys = [...new Set(people.filter(p => p.personRef && p.personKey).map(p => p.personKey!))].sort().join(',')
  useEffect(() => {
    const update = () => setRefresh(v => v + 1)
    window.addEventListener('focus', update)
    return () => window.removeEventListener('focus', update)
  }, [])
  useEffect(() => {
    if (conversation.side !== 'team' || !keys) return
    const abort = new AbortController()
    const refs = [...new Map(current.current.people.filter(p => p.personRef && p.personKey).map(p => [p.personKey!, p.personRef!])).values()]
    void (async () => {
      for (let i = 0; i < refs.length && !abort.signal.aborted; i += 50) {
        const result = await callArkme<{ items: Array<{ personKey: string; remark: string }> }>('team.app.people.remarks', {
          conversationRef: current.current.conversation.ref, expectedAccountKey: accountKey, personRefs: refs.slice(i, i + 50),
        }, abort.signal)
        if (abort.signal.aborted) return
        setState(old => ({ scope, names: { ...(old.scope === scope ? old.names : {}),
          ...Object.fromEntries(result.items.map(item => [item.personKey, item.remark.trim()])) } }))
      }
    })().catch(() => { /* A remark lookup failure must not replace known names or reset reading. */ })
    return () => abort.abort()
  }, [scope, keys, refresh, conversation.side])
  return <T extends TeamIdentity>(identity: T): T => {
    const remark = state.scope === scope && identity.personKey ? state.names[identity.personKey] : undefined
    const name = remark || identity.publicNickname || identity.nickname
    return name === identity.nickname ? identity : { ...identity, publicNickname: identity.publicNickname ?? identity.nickname, nickname: name }
  }
}
