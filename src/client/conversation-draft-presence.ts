import { useLayoutEffect, useRef } from 'react'
import { arkmeComposerDraftStore, type ArkmeComposerDraftStore } from './composer-draft-store.js'

/** Several personal topics share one conversation; each independent mounted surface owns a lease. */
export class ConversationDraftPresence {
  private owners = new Map<symbol, { conversation: string; draftKey: string }>()
  private visits = new Map<string, { owners: Set<symbol>; edits: Map<string, number> }>()
  private listeners = new Set<() => void>()
  private revision = 0

  constructor(private readonly drafts: ArkmeComposerDraftStore) {}
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  readonly getRevision = (): number => this.revision

  isActive(draftKey: string | undefined): boolean {
    return draftKey !== undefined && this.visits.has(conversationDraftGroup(draftKey))
  }

  update(owner: symbol, draftKey: string | undefined): void {
    const previous = this.owners.get(owner)
    if (previous?.draftKey === draftKey) return
    const conversation = draftKey === undefined ? undefined : conversationDraftGroup(draftKey)
    if (previous && previous.conversation !== conversation) {
      const visit = this.visits.get(previous.conversation)!
      visit.owners.delete(owner)
      this.owners.delete(owner)
      if (visit.owners.size === 0) {
        this.visits.delete(previous.conversation)
        const atMillis = Date.now()
        for (const [key, revision] of visit.edits) {
          if (this.drafts.getContentEditRevision(key) > revision) this.drafts.markConversationLeft(key, atMillis)
        }
      }
    }
    if (draftKey !== undefined && conversation !== undefined) {
      let visit = this.visits.get(conversation)
      if (!visit) { visit = { owners: new Set(), edits: new Map() }; this.visits.set(conversation, visit) }
      if (!visit.edits.has(draftKey)) visit.edits.set(draftKey, this.drafts.getContentEditRevision(draftKey))
      visit.owners.add(owner)
      this.owners.set(owner, { conversation, draftKey })
    }
    this.revision++
    for (const listener of this.listeners) listener()
  }
}

function conversationDraftGroup(key: string): string {
  return /^arkme-composer:\d+:source:(send_to_self|default_category|topic):/.test(key)
    ? `${key.split(':').slice(0, 2).join(':')}:self` : key
}

export const conversationDraftPresence = new ConversationDraftPresence(arkmeComposerDraftStore)

/** Input focus, menus and window focus do not affect this conversation-level lifetime. */
export function useConversationDraftPresence(draftKey: string | undefined): void {
  const owner = useRef(Symbol('composer'))
  useLayoutEffect(() => { conversationDraftPresence.update(owner.current, draftKey) }, [draftKey])
  useLayoutEffect(() => {
    const current = owner.current
    return () => { conversationDraftPresence.update(current, undefined) }
  }, [])
}
