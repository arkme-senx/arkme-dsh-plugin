import { useCallback, useEffect, useRef, useState } from 'react'
import type { TeamWorkspaceEntry, TeamWorkspacePage } from '../team-group-contract.js'
import type { TeamConversationGroup } from './team-conversation-directory.js'
import { callArkme } from './api.js'
import { teamDirectoryPreferences, teamEntryKey, teamFolderEntryKey } from './team-directory-preferences.js'
import { teamWorkspaceTarget } from './team-workspace-rows.js'
import { subscribeTeamMessageChanges, subscribeTeamWorkspaceChanges } from './team-messaging-events.js'
import { tr } from './locale.js'

export interface ForwardTeamWorkspace {
  teamRef: string
  folderIdentity: string
  rows: TeamWorkspaceEntry[]
  pinRows: TeamWorkspaceEntry[]
  page?: TeamWorkspacePage | undefined
  loading: boolean
  error: string
}
const empty = (teamRef: string, folderIdentity: string): ForwardTeamWorkspace => ({ teamRef, folderIdentity, rows: [], pinRows: [], loading: false, error: '' })
const accessLost = (error: unknown) => /team-(not_accessible|account-changed)|login-|team_group_(forbidden|membership_stale)/
  .test(String((error as { body?: { code?: string } })?.body?.code))

/** A chooser reads only its expanded workspace. No all-team scan or positive access cache. */
export function useForwardTeamWorkspace(accountKey: string, groups: readonly TeamConversationGroup[], activeKey?: string, supported = false) {
  const [state, setState] = useState<{ account: string; views: Record<string, ForwardTeamWorkspace> }>({ account: accountKey, views: {} })
  const views = state.account === accountKey ? state.views : {}
  const viewsRef = useRef(views), account = useRef(accountKey), alive = useRef(false)
  const folders = useRef(new Map(groups.map(group => [group.key, group])))
  const requests = useRef(new Map<string, AbortController>())
  viewsRef.current = views; account.current = accountKey; folders.current = new Map(groups.map(group => [group.key, group]))
  const activeRef = groups.find(group => group.key === activeKey)?.channel.teamRef
  const load = useCallback(async (key: string, more = false) => {
    const group = folders.current.get(key)
    if (!supported || !group || !alive.current || requests.current.has(key)) return
    const teamRef = group.channel.teamRef, folderIdentity = teamFolderEntryKey(group.channel)
    const previous = viewsRef.current[key]?.folderIdentity === folderIdentity ? viewsRef.current[key] : undefined
    if (more && (!previous?.page?.complete || !previous.page.hasMore || previous.page.resetRequired)) return
    const request = new AbortController(); requests.current.set(key, request)
    const current = () => alive.current && !request.signal.aborted && account.current === accountKey
      && folders.current.get(key)?.channel.teamRef === teamRef
    const update = (change: (view: ForwardTeamWorkspace) => ForwardTeamWorkspace) => {
      if (!current()) return
      setState(value => {
        const all = value.account === accountKey ? value.views : {}
        const old = all[key]?.folderIdentity === folderIdentity ? { ...all[key]!, teamRef } : empty(teamRef, folderIdentity)
        return { account: accountKey, views: { ...all, [key]: change(old) } }
      })
    }
    update(old => ({ ...old, loading: true, error: '' }))
    try {
      const page = await callArkme<TeamWorkspacePage>('team.app.workspace', { expectedAccountKey: accountKey, teamRef,
        ...(more ? { cursor: previous!.page!.nextCursor } : {}) }, request.signal)
      if (!current()) return
      if (!Array.isArray(page.items) || typeof page.complete !== 'boolean' || typeof page.hasMore !== 'boolean'
        || typeof page.resetRequired !== 'boolean' || !Array.isArray(page.unavailableSources)
        || page.hasMore && (!page.nextCursor || more && !page.resetRequired && page.nextCursor === previous?.page?.nextCursor)) throw new Error(tr('团队目录分页异常，请重试'))
      const rows = [...new Map([...(more && !page.resetRequired ? previous?.rows ?? [] : []), ...page.items].map(row => [row.key, row])).values()]
      update(old => ({ ...old, page, rows, pinRows: [], error: page.resetRequired ? tr('来源权限已变化，请刷新目录')
        : page.complete ? '' : tr('部分来源暂不可用，当前列表尚不完整') }))
      // Match the second column's cloud preferences and pins outside the loaded page.
      await teamDirectoryPreferences.hydrate(accountKey, true)
      if (!current()) return
      await teamDirectoryPreferences.reconcileTargets(accountKey, rows.map(row => teamWorkspaceTarget(row, group.channel)), request.signal)
      if (!current()) return
      const entries = teamDirectoryPreferences.workspacePins(accountKey, teamFolderEntryKey(group.channel), new Set(rows.map(row => teamEntryKey(teamWorkspaceTarget(row, group.channel)))))
      const pins: TeamWorkspaceEntry[] = []
      for (let i = 0; i < entries.length; i += 100) {
        const next = await callArkme<TeamWorkspacePage>('team.app.workspace.request', { expectedAccountKey: accountKey,
          request: { operation: 'resolve-entries', teamRef, entries: entries.slice(i, i + 100) } }, request.signal)
        if (!next.complete || next.resetRequired) throw new Error(tr('来源权限已变化，请刷新目录'))
        pins.push(...next.items)
      }
      update(old => ({ ...old, pinRows: pins }))
    } catch (error) {
      update(old => ({ ...(accessLost(error) ? empty(teamRef, folderIdentity) : old), error: error instanceof Error ? error.message : tr('团队目录暂时无法加载') }))
    } finally {
      update(old => ({ ...old, loading: false }))
      if (requests.current.get(key) === request) requests.current.delete(key)
    }
  }, [accountKey, supported])
  useEffect(() => {
    alive.current = true
    setState(value => value.account === accountKey ? value : { account: accountKey, views: {} })
    return () => { alive.current = false; for (const request of requests.current.values()) request.abort(); requests.current.clear() }
  }, [accountKey])
  useEffect(() => {
    if (!activeKey || !activeRef || !supported) return
    void load(activeKey)
    const refresh = () => { void load(activeKey) }
    const changed = (key: string) => { if (key === accountKey) refresh() }
    const stopMessages = subscribeTeamMessageChanges(changed), stopWorkspace = subscribeTeamWorkspaceChanges(changed)
    window.addEventListener('focus', refresh)
    return () => { requests.current.get(activeKey)?.abort(); requests.current.delete(activeKey); stopMessages(); stopWorkspace(); window.removeEventListener('focus', refresh) }
  }, [accountKey, activeKey, activeRef, supported, load])
  const currentViews = Object.fromEntries(Object.entries(views).filter(([key, view]) => supported && folders.current.has(key) && teamFolderEntryKey(folders.current.get(key)!.channel) === view.folderIdentity))
  return { views: currentViews, load }
}
