import { useSyncExternalStore, type ReactNode } from 'react'
import type { ArkmeSourceItem } from '../types.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr } from './locale.js'
import { arkmeComposerDraftStore, arkmeSourceComposerDraftKey, arkmeArkoComposerDraftKey, arkmeDraftEditedAtMillis } from './composer-draft-store.js'
import { conversationDraftPreview, selfConversationDraftPreview } from './conversation-draft-preview.js'
import { conversationDirectoryStyles } from './conversation-directory-presentation.js'
import { selfTopicDirectory } from './self-topic-directory-cache.js'

const subscribeNothing = () => () => {}
const noTopics = () => undefined

export function ArkmeDraftPreviewText({ preview }: { preview: string }) {
  return <span data-arkme-draft-preview style={conversationDirectoryStyles.preview} title={`${tr('[草稿]')} ${preview}`.trim()}>
    <span style={{ color: arkmeTheme.danger }}>{tr('[草稿]')}</span>{preview && ` ${preview}`}
  </span>
}

export function useConversationDraftPresentation(source: ArkmeSourceItem | 'arko'): { preview: string | undefined; editedAtMillis: number } {
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot).auth
  const userId = auth?.status === 'authenticated' ? auth.userId : undefined
  const key = source === 'arko' ? arkmeArkoComposerDraftKey(userId) : arkmeSourceComposerDraftKey(userId, source)
  const draft = useSyncExternalStore(arkmeComposerDraftStore.subscribe,
    () => arkmeComposerDraftStore.get(key), () => arkmeComposerDraftStore.get(undefined))
  const preview = conversationDraftPreview(draft)
  return { preview, editedAtMillis: preview === undefined ? 0 : arkmeDraftEditedAtMillis(draft) }
}

/** Uses the same account-owned topic directory as the composer, including nested topics. */
export function useSelfConversationDraftPreview(source?: ArkmeSourceItem) {
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot).auth
  const userId = auth?.status === 'authenticated' ? auth.userId : undefined
  const topics = auth?.status === 'authenticated' && userId !== undefined ? selfTopicDirectory(userId, auth.environment) : undefined
  const directory = useSyncExternalStore(topics?.subscribe ?? subscribeNothing, topics?.getSnapshot ?? noTopics, noTopics)
  useSyncExternalStore(arkmeComposerDraftStore.subscribe, arkmeComposerDraftStore.getRevision, arkmeComposerDraftStore.getRevision)
  const sources = directory?.sources ?? []
  return selfConversationDraftPreview(arkmeComposerDraftStore, userId, source ? [source, ...sources] : sources)
}

export function ArkmeSelfConversationDraftPreview({ source, fallback }: { source?: ArkmeSourceItem | undefined; fallback: ReactNode }) {
  const preview = useSelfConversationDraftPreview(source)
  return preview ? <ArkmeDraftPreviewText preview={preview.preview} /> : <>{fallback}</>
}
