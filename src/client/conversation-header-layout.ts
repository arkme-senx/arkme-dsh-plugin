import { arkoPresentationName, arkmeArkoProfileStore } from './arko-profile-store.js'
import { tr, useArkmeLocale } from './locale.js'
import { useSyncExternalStore } from 'react'
/** Equal side tracks keep selectors centered in the full conversation region. */
export const CONVERSATION_HEADER_COLUMNS = 'minmax(0, 1fr) minmax(0, 2fr) minmax(0, 1fr)'
/** Four self-workspace actions stay reachable while the title/selector shrink. */
export const SELF_CONVERSATION_HEADER_COLUMNS = 'minmax(0, 1fr) minmax(60px, 2fr) minmax(124px, 1fr)'
/** The local agent is Arko working on this computer; the cloud Arko keeps the bare name. */
export function harnessConversationName(): string {
  return tr('{name} · 本机', { name: arkoPresentationName(arkmeArkoProfileStore.getSnapshot().profile) })
}

/** React form of `harnessConversationName`, repainting on a rename or a language change. */
export function useHarnessConversationName(): string {
  useArkmeLocale()
  useSyncExternalStore(arkmeArkoProfileStore.subscribe, arkmeArkoProfileStore.getSnapshot, arkmeArkoProfileStore.getSnapshot)
  return harnessConversationName()
}
