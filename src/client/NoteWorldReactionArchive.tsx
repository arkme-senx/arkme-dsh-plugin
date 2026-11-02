import { useEffect, useState, useSyncExternalStore } from 'react'
import type { WorldReactionContextPage } from '../world-reaction-contract.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { WorldReactionArchive } from './ArkmeWorldReactionHistory.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr } from './locale.js'

/** Resolve only this owned original. Never infer a publication from a private source copy. */
export function NoteWorldReactionArchive({ sourceRef, messageActionRef }: { sourceRef: string; messageActionRef: string }) {
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot).auth
  const accountKey = auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : ''
  const identity = JSON.stringify([accountKey, sourceRef, messageActionRef])
  const [state, setState] = useState<{ identity: string; page?: WorldReactionContextPage; error?: string }>()
  const [attempt, retry] = useState(0)
  useEffect(() => {
    if (!accountKey) return
    const c = new AbortController()
    void callArkme<WorldReactionContextPage>('world.reactions.from-note', { accountKey, sourceRef, messageActionRef }, c.signal)
      .then(page => { if (!c.signal.aborted) setState({ identity, page }) })
      .catch(error => { if (!c.signal.aborted) setState({ identity, error: error instanceof Error ? error.message : tr('世界表态读取失败') }) })
    return () => c.abort()
  }, [identity, attempt])
  if (state?.identity !== identity) return null
  if (state.error) return <p role="status" style={{ color: arkmeTheme.secondary, fontSize: 12 }}>{tr('世界表态暂时无法读取')} <button type="button" onClick={() => retry(v => v + 1)}>{tr('重试')}</button></p>
  const context = state.page?.items[0]
  return context ? <WorldReactionArchive key={`${identity}:${context.target.id}`} scope={accountKey} target={context.target}
    title={context.visibility === 'unpublished' ? '世界表态 · 已取消公开' : '世界表态'} /> : null
}
