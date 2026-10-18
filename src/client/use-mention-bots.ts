import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { ArkmeBotList, ArkmeGroupBotCandidateList } from '../types.js'
import { callArkme } from './api.js'
import { mentionBotCache, mentionBotCacheKey } from './mention-bot-cache.js'
import { subscribeGroupBotChanges } from './use-group-bots.js'
import { arkmeAuthStore } from './auth-store.js'

export function useMentionBots(account: string | undefined, kind: string | undefined, sourceRef: string | undefined, sourceKey: string | undefined, enabled = true, opened = false) {
  const key = enabled ? mentionBotCacheKey(account, kind, sourceKey) : undefined
  useSyncExternalStore(mentionBotCache.subscribe, mentionBotCache.getRevision, mentionBotCache.getRevision)
  const load = useCallback((force = false) => {
    if (!key || !sourceRef) return
    void mentionBotCache.load(key, async () => {
      const assertAccount = () => {
        const auth = arkmeAuthStore.getSnapshot().auth
        if (auth?.status !== 'authenticated' || `${auth.environment}:${String(auth.userId)}` !== account) throw new Error('Account changed')
      }
      assertAccount()
      const data = kind === 'group_chat'
        ? { group: (await callArkme<ArkmeGroupBotCandidateList>('group.bots', { sourceRef })).items, private: [] }
        : { group: [], private: (await callArkme<ArkmeBotList>('bots.list')).items }
      assertAccount()
      return data
    }, force)
  }, [account, key, kind, sourceRef])
  // Prefetch on entry; reopening @ only revalidates stale data, never clears rows.
  useEffect(() => { load() }, [load, opened])
  useEffect(() => kind !== 'group_chat' || !key ? undefined : subscribeGroupBotChanges(account, sourceRef, removed => {
    mentionBotCache.invalidate(key, removed)
    load()
  }), [account, sourceRef, key, kind, load])
  return { ...mentionBotCache.get(key), retry: () => load(true) }
}
