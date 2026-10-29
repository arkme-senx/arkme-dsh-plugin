import { withoutTeamConversationMaterial } from '../team-message-projection.js'
import { mergeTeamNotificationPolicy } from '../team-notification-contract.js'
import { callArkme } from './api.js'
import { subscribeTeamMessageChanges } from './team-messaging-events.js'
import type { TeamChannel, TeamConversation, TeamPage, TeamSide, TeamConversationReadState } from '../team-app-contract.js'
import { teamDirectoryPreferences, teamEntryHidden, teamEntryPinned, type TeamDirectoryPreferences } from './team-directory-preferences.js'

type Snapshot = { items: TeamConversation[]; hasMore: boolean; loading: boolean; hasLoaded: boolean; error?: string }
const empty: Snapshot = Object.freeze({ items: [], hasMore: false, loading: false, hasLoaded: false })
const listeners = new Set<() => void>()
let account = '', snapshot = empty, request: ((more?: boolean, readStateOnly?: boolean) => Promise<void>) | undefined
let discard: ((conversation: TeamConversation) => void) | undefined
export const subscribeTeamDirectory = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export const readTeamDirectory = (key: string): Snapshot => key === account ? snapshot : empty
export const refreshTeamDirectory = (key: string, more = false, readStateOnly = false): Promise<void> => key === account ? request?.(more, readStateOnly) ?? Promise.resolve() : Promise.resolve()
const emit = () => { for (const listener of listeners) listener() }
export function discardTeamDirectory(key: string, conversation: TeamConversation): void {
  if (key !== account) return
  discard?.(conversation)
}

/** One account-scoped presentation source. Neither Chat storage nor readiness depends on it. */
export function startTeamDirectory(key: string): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}
  const controller = new AbortController(), pages = new Map<TeamSide, TeamPage<TeamConversation>>()
  let running = false, again = false, fullAgain = false, revision = 0
  account = key; snapshot = empty; emit()
  const refresh = async (more = false, readStateOnly = false) => {
    if (controller.signal.aborted || account !== key) return
    if (running) { if (!more) { again = true; fullAgain ||= !readStateOnly }; return }
    running = true
    const token = revision
    if (!readStateOnly) { snapshot = { ...snapshot, loading: true }; emit() }
    let failure: string | undefined
    await Promise.all((['team', 'external'] as const).map(async side => {
      const previous = pages.get(side)
      if (more && !previous?.hasMore) return
      try {
        if (readStateOnly) {
          if (!previous?.items.length) return
          const states = new Map<string, TeamConversationReadState>()
          for (let i = 0; i < previous.items.length; i += 100) {
            const rows = await callArkme<TeamConversationReadState[]>('team.app.read-states', {
              conversationRefs: previous.items.slice(i, i + 100).map(c => c.ref), expectedAccountKey: key,
            }, controller.signal)
            for (const state of rows) states.set(state.key, state)
          }
          if (!controller.signal.aborted && account === key && token === revision) {
            pages.set(side, {...previous, items: previous.items.flatMap(c => {
              const state = states.get(c.key)
              if (!state) throw new Error('阅读状态返回不完整')
              if (!state.accessible) return []
              if (state.lastSeq < c.lastSeq || state.myReadSeq < c.myReadSeq) return [c]
              return [{...c, myReadSeq: state.myReadSeq, unread: state.unread, notificationPolicy:mergeTeamNotificationPolicy(c.notificationPolicy,state.notificationPolicy)}]
            })})
          }
          return
        }
        if (more && !previous?.nextCursor) throw new Error('消息分页异常，请重试')
        let page = await callArkme<TeamPage<TeamConversation>>('team.app.conversations', { side, expectedAccountKey: key, ...(more && previous?.nextCursor ? { cursor: previous.nextCursor } : {}) }, controller.signal)
        if (more && page.hasMore && page.nextCursor === previous?.nextCursor) throw new Error('消息分页异常，请重试')
        const previousByKey=new Map(previous?.items.map(c=>[c.key,c])??[])
        const items = new Map([...(more ? previous?.items ?? [] : []), ...page.items.map(c=>({...c,notificationPolicy:mergeTeamNotificationPolicy(previousByKey.get(c.key)?.notificationPolicy,c.notificationPolicy)}))].map(c => [c.key, c]))
        const seen = new Set<string>()
        while (!more && items.size < (previous?.items.length ?? 0) && page.hasMore) {
          if (!page.nextCursor || seen.has(page.nextCursor)) throw new Error('消息分页异常，请重试')
          seen.add(page.nextCursor)
          page = await callArkme<TeamPage<TeamConversation>>('team.app.conversations', { side, expectedAccountKey: key, cursor: page.nextCursor }, controller.signal)
          for (const c of page.items) items.set(c.key, {...c,notificationPolicy:mergeTeamNotificationPolicy(items.get(c.key)?.notificationPolicy,c.notificationPolicy)})
        }
        if (!controller.signal.aborted && account === key && token === revision) pages.set(side, { ...page, items: [...items.values()] })
      } catch (e) {
        failure = e instanceof Error ? e.message : '团队对话暂时无法刷新'
        if(!readStateOnly && token===revision && previous)pages.set(side,{...previous,items:previous.items.map(c=>c.visitor?{...c,visitor:{...c.visitor,memberType:'unknown'}}:c)})
        if (token === revision && /team-(not_accessible|account-changed)|login-/.test(String((e as { body?: { code?: string } })?.body?.code))) pages.delete(side)
      }
    }))
    running = false
    if (controller.signal.aborted || account !== key) return
    const items = [...pages.values()].flatMap(p => p.items).sort((a, b) => b.updatedAt - a.updatedAt || `${a.side}:${a.key}`.localeCompare(`${b.side}:${b.key}`))
    snapshot = { items, hasMore: [...pages.values()].some(p => p.hasMore), loading: false, hasLoaded: true, ...(failure ? { error: failure } : {}) }; emit()
    if (!readStateOnly) void teamDirectoryPreferences.reconcile(key, items, async c => {
      const page = await callArkme<import('../team-app-contract.js').TeamTimeline>('team.app.timeline', { conversationRef: c.ref, expectedAccountKey: key, limit: 1 }, controller.signal)
      return Math.max(0, ...page.messages.map(message => message.createdAt))
    }, controller.signal).catch(() => { /* Keep hidden entries hidden until new-message evidence can be verified. */ })
    if (again) { const full = fullAgain; again = false; fullAgain = false; await refresh(false, !full) }
  }
  request = refresh
  discard = conversation => {
    ++revision
    const page = pages.get(conversation.side)
    if (page) pages.set(conversation.side, { ...page, items: page.items.filter(c => c.channel.jotmoId !== conversation.channel.jotmoId) })
    snapshot = { ...snapshot, items: snapshot.items.filter(c => c.side !== conversation.side || c.channel.jotmoId !== conversation.channel.jotmoId) }; emit()
    void refresh()
  }
  const stop = subscribeTeamMessageChanges((changed, receiptOnly) => {
    if (changed !== key) return
    if (!receiptOnly) {
      ++revision
      for (const [side,page] of pages) pages.set(side,{...page,items:page.items.map(withoutTeamConversationMaterial)})
      snapshot={...snapshot,items:snapshot.items.map(withoutTeamConversationMaterial)};emit()
    }
    void refresh(false, receiptOnly === true)
  })
  const focus = () => { void refresh() }
  const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 60_000)
  window.addEventListener('focus', focus)
  void refresh()
  return () => {
    controller.abort(); stop(); clearInterval(timer); window.removeEventListener('focus', focus)
    if (request === refresh) { account = ''; request = undefined; discard = undefined; snapshot = empty; emit() }
  }
}

export interface TeamConversationGroup {
  key: string; channel: TeamChannel; conversations: TeamConversation[]; latest: TeamConversation
  unread: number; attentionUnread: number; unreadExact: boolean
}
export function groupTeamConversations(conversations: readonly TeamConversation[], complete = true): TeamConversationGroup[] {
  const groups = new Map<string, Map<string, TeamConversation>>()
  for (const c of conversations) {
    if (c.side !== 'team') continue
    const group = groups.get(c.channel.jotmoId) ?? new Map<string, TeamConversation>()
    group.set(c.key, c); groups.set(c.channel.jotmoId, group)
  }
  return [...groups].map(([key, group]) => {
    const rows = [...group.values()].sort((a,b)=>b.updatedAt-a.updatedAt || a.key.localeCompare(b.key)), latest = rows[0]!
    return {key,channel:latest.channel,conversations:rows,latest,unread:rows.reduce((count,c)=>count+Math.max(0,c.unread),0),attentionUnread:rows.reduce((count,c)=>count+(c.notificationPolicy?.muted?0:Math.max(0,c.unread)),0),unreadExact:complete}
  }).sort((a,b)=>b.latest.updatedAt-a.latest.updatedAt || a.key.localeCompare(b.key))
}

type TeamDirectoryRow = { kind:'team'; conversation:TeamConversation; activeAtMillis:number; pinned:boolean }
  | { kind:'team-folder'; group:TeamConversationGroup; activeAtMillis:number; pinned:boolean }
/** Internal visitors share one team entry; external-facing conversations retain their direct entry. */
export function mergeTeamDirectoryRows<T extends { activeAtMillis: number; pinned: boolean }>(ordinary: readonly T[], teams: TeamConversation[], complete = true, preferences: TeamDirectoryPreferences = {}): (T | TeamDirectoryRow)[] {
  const result: (T | TeamDirectoryRow)[] = [...ordinary]
  const teamRows: TeamDirectoryRow[] = [
    ...groupTeamConversations(teams,complete).filter(group=>!teamEntryHidden(preferences,{kind:'folder',group})).map(group=>({kind:'team-folder' as const,group,activeAtMillis:group.latest.updatedAt,pinned:teamEntryPinned(preferences,{kind:'folder',group})})),
    ...teams.filter(c=>c.side==='external' && !teamEntryHidden(preferences,{kind:'conversation',conversation:c})).map(conversation=>({kind:'team' as const,conversation,activeAtMillis:conversation.updatedAt,pinned:teamEntryPinned(preferences,{kind:'conversation',conversation})})),
  ]
  for (const row of teamRows.sort((a,b)=>b.activeAtMillis-a.activeAtMillis)) {
    const index=result.findIndex(item=>Number(row.pinned)>Number(item.pinned) || row.pinned===item.pinned && item.activeAtMillis<row.activeAtMillis)
    result.splice(index<0?result.length:index,0,row)
  }
  return result
}
