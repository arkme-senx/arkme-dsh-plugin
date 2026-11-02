import type { TeamMessage, TeamConversation } from './team-app-contract.js'

/** A terminal occurrence carries no retained material, even in a late ACK. */
export function teamMessageProjection(message: TeamMessage): TeamMessage {
  if (message.state !== 'recalled') return message
  const { content, reply, forwardRecords, localMarkRef, recipientRead, ...identity } = message
  return { ...identity, canRecall: false, canEdit: false, canDelete: false,
    version: 0, contentStatus: 'recalled', media: [], mediaComplete: true }
}

export function mergeTeamMessages(current: readonly TeamMessage[], incoming: readonly TeamMessage[]): TeamMessage[] {
  const rows = new Map(current.map(message => [message.key, teamMessageProjection(message)]))
  for (const next of incoming) {
    const previous = rows.get(next.key)
    if (previous?.state === 'recalled' || previous && next.state !== 'recalled' && next.revision < previous.revision) continue
    if (previous && next.state === 'published' && next.revision === previous.revision && !next.contentStatus && previous.contentStatus) continue
    // A zero-version available body is an ACK supplemented from the send draft.
    // It cannot reauthorize material already invalidated by current read facts.
    if (previous?.contentStatus && next.state === 'published' && next.version === 0 && next.contentStatus === 'available') {
      if (next.revision > previous.revision) rows.set(next.key, withoutTeamMessageMaterial(next))
      continue
    }
    rows.set(next.key, teamMessageProjection(next))
  }
  return [...rows.values()].sort((a, b) => a.seq - b.seq)
}

// Client-only read projection: distinguish pending validation from an authoritative denial.
export function withoutTeamMessageMaterial(message: TeamMessage): TeamMessage {
  const {content,reply,forwardRecords,localMarkRef,recipientRead,...identity}=message
  return {...identity,media:[],version:0,canEdit:false,canDelete:false,contentStatus:message.state==='recalled'?'recalled':'revalidating'}
}


/** A directory identity is retained while its content preview is revalidated. */
export function withoutTeamConversationMaterial(conversation: TeamConversation): TeamConversation {
  return {...conversation,preview:{status:'unavailable',text:'',hasMedia:false}}
}
