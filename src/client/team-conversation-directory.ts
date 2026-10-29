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
  // Sparse pin discoveries never inflate the ordinary pagination window.
  const pins = new Map<string, TeamConversation>()
  const itemsNow = () => [...new Map([...pins.values(), ...[...pages.values()].flatMap(p => p.items)].map(c => [c.key, c])).values()]
    .sort((a, b) => b.updatedAt - a.updatedAt || `${a.side}:${a.key}`.localeCompare(`${b.side}:${b.key}`))
  let running = false, again = false, fullAgain = false, revision = 0
  account = key; snapshot = empty; emit()
  const refresh = async (more = false, readStateOnly = false) => {
    if (controller.signal.aborted || account !== key) return
    if (running) { if (!more) { again = true; fullAgain ||= !readStateOnly }; return }
    running = true
    const token = revision
    if (!readStateOnly) { snapshot = { ...snapshot, loading: true }; emit() }
    let failure: string | undefined, accessLost = false
    await Promise.all((['team', 'external'] as const).map(async side => {
      const previous = pages.get(side)
      if (more && !previous?.hasMore) return
      try {
        if (readStateOnly) {
          const targets = [...new Map([...pins.values()].filter(c => c.side === side).concat(previous?.items ?? []).map(c => [c.key, c])).values()]
          if (!targets.length) return
          const states = new Map<string, TeamConversationReadState>()
          for (let i = 0; i < targets.length; i += 100) {
            const rows = await callArkme<TeamConversationReadState[]>('team.app.read-states', {
              conversationRefs: targets.slice(i, i + 100).map(c => c.ref), expectedAccountKey: key,
            }, controller.signal)
            for (const state of rows) states.set(state.key, state)
          }
          if (!controller.signal.aborted && account === key && token === revision) {
            const updated = new Map(targets.flatMap(c => {
              const state = states.get(c.key)
              if (!state) throw new Error('阅读状态返回不完整')
              if (!state.accessible) { accessLost = true; return [] }
              const next = state.lastSeq < c.lastSeq || state.myReadSeq < c.myReadSeq ? c : {...c, myReadSeq: state.myReadSeq, unread: state.unread, notificationPolicy:mergeTeamNotificationPolicy(c.notificationPolicy,state.notificationPolicy)}
              return [[c.key, next] as const]
            }))
            if (previous) pages.set(side, {...previous, items: previous.items.flatMap(c => updated.has(c.key) ? [updated.get(c.key)!] : [])})
            for (const [id, c] of pins) if (c.side === side) { if (updated.has(id)) pins.set(id, updated.get(id)!); else pins.delete(id) }
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
        if (!readStateOnly && token === revision) {
          if (previous) pages.set(side, { ...previous, items: previous.items.map(c => c.visitor ? { ...c, visitor: { ...c.visitor, memberType: 'unknown' } } : c) })
          for (const [id, c] of pins) if (c.side === side && c.visitor) pins.set(id, { ...c, visitor: { ...c.visitor, memberType: 'unknown' } })
        }
        if (token === revision && /team-(not_accessible|account-changed)|login-/.test(String((e as { body?: { code?: string } })?.body?.code))) {
          pages.delete(side); for (const [id, c] of pins) if (c.side === side) pins.delete(id)
          accessLost = true
        }
      }
    }))
    running = false
    if (controller.signal.aborted || account !== key) return
    if (accessLost) ++revision
    const items = itemsNow()
    snapshot = { items, hasMore: [...pages.values()].some(p => p.hasMore), loading: false, hasLoaded: true, ...(failure ? { error: failure } : {}) }; emit()
    if (!readStateOnly && token === revision) {
      // Optional preference IO runs after publishing ordinary directory rows.
      void (async () => {
        await teamDirectoryPreferences.hydrate(key, true)
        await teamDirectoryPreferences.reconcile(key, items, controller.signal)
        if (controller.signal.aborted || account !== key || token !== revision) return
        // A preference query also carries an authority verdict. A denial must
        // retire old previews, rather than appear as an ordinary default row.
        const allowed = (c: TeamConversation) => teamDirectoryPreferences.canPresent(key, c)
        const before = itemsNow().length
        for (const [side, page] of pages) pages.set(side, { ...page, items: page.items.filter(allowed) })
        for (const [id, c] of pins) if (!allowed(c)) pins.delete(id)
        if (itemsNow().length !== before) { snapshot = { ...snapshot, items: itemsNow() }; emit() }
        const extra: TeamConversation[] = []
        const targets = teamDirectoryPreferences.missingPins(key, items)
        for (let i = 0; i < targets.length; i += 10) {
          const batch = await Promise.all(targets.slice(i, i + 10).map(async target => {
            try {
              if (target.kind === 'folder') return (await callArkme<TeamPage<TeamConversation>>('team.app.conversations', { teamRef: target.ref, side: 'team', limit: 1, expectedAccountKey: key }, controller.signal)).items
              return [(await callArkme<import('../team-app-contract.js').TeamTimeline>('team.app.timeline', { conversationRef: target.ref, limit: 1, expectedAccountKey: key }, controller.signal)).conversation]
            } catch { return [] }
          }))
          // A preference is presentation only; successful publication activates a conversation.
          extra.push(...batch.flat().filter(c => c.lastSeq > 0))
        }
        if (controller.signal.aborted || account !== key || token !== revision) return
        for (const c of extra) if (!pins.has(c.key) && allowed(c)) pins.set(c.key, c)
        const preferences = teamDirectoryPreferences.read(key)
        for (const [id, c] of pins) if (!teamEntryPinned(preferences, { kind: 'conversation', conversation: c }) &&
          !(c.side === 'team' && teamEntryPinned(preferences, { kind: 'folder', group: groupTeamConversations([c])[0]! }))) pins.delete(id)
        snapshot = { ...snapshot, items: itemsNow() }; emit()
      })().catch(() => { /* Optional sync errors are exposed by the preference owner. */ })
    }
    if (again) { const full = fullAgain; again = false; fullAgain = false; await refresh(false, !full) }
  }
  request = refresh
  discard = conversation => {
    ++revision
    for (const [id, c] of pins) if (c.side === conversation.side && c.channel.jotmoId === conversation.channel.jotmoId) pins.delete(id)
    const page = pages.get(conversation.side)
    if (page) pages.set(conversation.side, { ...page, items: page.items.filter(c => c.channel.jotmoId !== conversation.channel.jotmoId) })
    snapshot = { ...snapshot, items: snapshot.items.filter(c => c.side !== conversation.side || c.channel.jotmoId !== conversation.channel.jotmoId) }; emit()
    void refresh()
  }
  const stop = subscribeTeamMessageChanges((changed, receiptOnly) => { if (changed === key) void refresh(false, receiptOnly === true) })
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
