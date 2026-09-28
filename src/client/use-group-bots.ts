import { useCallback, useEffect, useState } from 'react'
import type { ArkmeGroupBotItem, ArkmeGroupBotList } from '../tools/ports/bots.js'
import { callArkme } from './api.js'

type MembershipChange = { scope: string; removedBotRef?: string | undefined }
const listeners = new Set<(change: MembershipChange) => void>()
const scopeKey = (account: string, sourceRef: string) => JSON.stringify([account, sourceRef])

/** Only confirmed membership mutations should announce a change. */
export function arkmeGroupBotsChanged(account: string | undefined, sourceRef: string, removedBotRef?: string): void {
  if (account === undefined) return
  for (const listener of listeners) listener({ scope: scopeKey(account, sourceRef), removedBotRef })
}

export function arkmeInstalledGroupBots(items: readonly ArkmeGroupBotItem[]): ArkmeGroupBotItem[] {
  const seen = new Set<string>()
  return items.filter(bot => {
    const key = bot.directoryKey || bot.botRef
    if (!bot.installed || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

type State = { scope?: string; items: ArkmeGroupBotItem[]; ready: boolean; loading: boolean; error?: string | undefined }
const empty: State = { items: [], ready: false, loading: false }

/** Group roster, not the user's personal Bot directory. Keep people readable if this request fails. */
export function useGroupBots(account: string | undefined, sourceRef: string, active: boolean) {
  const scope = account === undefined ? undefined : scopeKey(account, sourceRef)
  const [state, setState] = useState<State>(empty)
  const [revision, setRevision] = useState(0)
  const refresh = useCallback(() => { setRevision(value => value + 1) }, [])
  useEffect(() => {
    if (scope === undefined) return
    const listener = (change: MembershipChange) => {
      if (change.scope !== scope) return
      if (change.removedBotRef !== undefined) setState(current => current.scope !== scope ? current : {
        ...current, items: current.items.filter(bot => bot.botRef !== change.removedBotRef),
      })
      refresh()
    }
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, [scope, refresh])
  useEffect(() => {
    if (!active || scope === undefined) return
    const controller = new AbortController()
    setState(current => ({ ...(current.scope === scope ? current : empty), scope, loading: true, error: undefined }))
    void callArkme<ArkmeGroupBotList>('group.bots', { sourceRef }, controller.signal).then(result => {
      if (!controller.signal.aborted) setState({ scope, items: arkmeInstalledGroupBots(result.items), ready: true, loading: false })
    }).catch(caught => {
      if (!controller.signal.aborted) setState(current => ({ ...current, scope, loading: false,
        error: caught instanceof Error ? caught.message : String(caught) }))
    })
    return () => { controller.abort() }
  }, [scope, sourceRef, active, revision])
  return { ...(scope !== undefined && state.scope === scope ? state : empty), refresh }
}
