import { useCallback, useSyncExternalStore } from 'react'
import type { ArkmeSourceItem } from '../types.js'
import { arkmeConversationMembers, EMPTY_CONVERSATION_MEMBERS } from './conversation-members-store.js'

export function useConversationMembers(account: string | undefined, source: ArkmeSourceItem | undefined, enabled = true) {
  const active = enabled && account !== undefined && (source?.kind === 'group_chat' || source?.kind === 'private_chat')
  const sourceRef = source?.sourceRef
  const sourceKey = source?.sourceKey
  const subscribe = useCallback((listener: () => void) => active && sourceRef !== undefined
    ? arkmeConversationMembers.subscribe(account!, { sourceRef, ...(sourceKey === undefined ? {} : { sourceKey }) }, listener)
    : () => undefined, [active, account, sourceRef, sourceKey])
  const getSnapshot = useCallback(() => active && sourceRef !== undefined
    ? arkmeConversationMembers.get(account, { sourceRef, ...(sourceKey === undefined ? {} : { sourceKey }) })
    : EMPTY_CONVERSATION_MEMBERS, [active, account, sourceRef, sourceKey])
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_CONVERSATION_MEMBERS)
}
