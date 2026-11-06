import { useState, useSyncExternalStore } from 'react'
import { useForwardTargetDirectory } from './forward-target-directory.js'
import { arkmeChatDirectory } from './chat-directory-store.js'
import { readTeamDirectory, subscribeTeamDirectory, refreshTeamDirectory } from './team-conversation-directory.js'
import { useTeamDirectoryPreferences } from './team-directory-preferences.js'
import { arkmeComposerDraftStore } from './composer-draft-store.js'
import { withConversationDraftActivity } from './conversation-draft-preview.js'
import { readPrivateInteractionDirectory, subscribePrivateInteractionDirectory } from './use-private-interaction-directory.js'
import { mergePrivateInteractionSources } from './private-interaction-directory.js'
import { projectUnifiedForwardTargets } from './unified-forward-targets.js'
import { arkmeSourceIdentityKey } from './source-identity.js'

export function useUnifiedForwardDirectory(accountKey: string) {
  const [refreshRevision, setRefreshRevision] = useState(0)
  const native = useForwardTargetDirectory(accountKey, true, refreshRevision)
  const directory = useSyncExternalStore(arkmeChatDirectory.subscribe, arkmeChatDirectory.getConversationSnapshot)
  const teams = useSyncExternalStore(subscribeTeamDirectory, () => readTeamDirectory(accountKey))
  const preferences = useTeamDirectoryPreferences(accountKey)
  useSyncExternalStore(arkmeComposerDraftStore.subscribe, arkmeComposerDraftStore.getRevision)
  const interactions = useSyncExternalStore(subscribePrivateInteractionDirectory, () => readPrivateInteractionDirectory(accountKey))
  const hidden = new Set(directory.visibility.filter(item => item.hidden).map(item => item.entryRef))
  const excluded = new Set(directory.directory.sources.filter(source => hidden.has(source.sourceRef)).map(arkmeSourceIdentityKey))
  // Cached/older directory pages may not carry visibility metadata yet. Keep
  // their readable targets while honoring every explicit dismissal and Bot row.
  const sources = directory.accountScope === accountKey ? directory.directory.sources.filter(source =>
    (source.kind === 'private_chat' || source.kind === 'group_chat') && !hidden.has(source.sourceRef)) : native.chats
  const ordinary = withConversationDraftActivity(mergePrivateInteractionSources(sources, interactions.rows, excluded)
    .map(source => ({ source, pinned: source.isPinned === true, activeAtMillis: source.activeAtMillis })),
    arkmeComposerDraftStore, Number(accountKey.slice(accountKey.lastIndexOf(':') + 1)))
  // The second column keeps the personal directory as a separate entry above conversations.
  const rows = projectUnifiedForwardTargets(ordinary, teams.items, preferences, teams.hasLoaded && !teams.hasMore && !teams.error)
  if (native.self) rows.unshift({ kind: 'target', target: { kind: 'source', source: native.self },
    pinned: native.self.isPinned === true, activeAtMillis: native.self.activeAtMillis })
  return { rows, preferences, loading: native.loading || teams.loading, hasMore: teams.hasMore,
    error: [native.error, teams.error].filter(Boolean).join('；'),
    refresh: async (more = false, retry = false) => {
      if (retry) setRefreshRevision(value => value + 1)
      await Promise.all([...(more ? [] : [arkmeChatDirectory.refreshRoot({ silent: true, force: retry })]), refreshTeamDirectory(accountKey, more)])
    } }
}
