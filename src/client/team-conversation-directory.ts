import type {TeamWorkspaceFolder} from '../team-group-contract.js'
import { withoutTeamConversationMaterial } from '../team-message-projection.js'
import {teamChangeAffectsConversationPreview} from './team-source-read.js'
import { mergeTeamNotificationPolicy } from '../team-notification-contract.js'
import { callArkme } from './api.js'
import { subscribeTeamMessageChanges,subscribeTeamWorkspaceChanges } from './team-messaging-events.js'
import type { TeamChannel, TeamConversation, TeamPage, TeamSide, TeamConversationReadState } from '../team-app-contract.js'
import { teamDirectoryPreferences, teamEntryHidden, teamEntryPinned, type TeamDirectoryPreferences } from './team-directory-preferences.js'
import { openedTeamConversations, mergeOpenedTeamConversation } from './team-opened-conversations.js'

type Snapshot = { workspaceSupported?:boolean; workspaceFolders:TeamWorkspaceFolder[]; foldersError?:string; items: TeamConversation[]; hasMore: boolean; loading: boolean; hasLoaded: boolean; error?: string }
const empty: Snapshot = Object.freeze({ workspaceFolders:[], items: [], hasMore: false, loading: false, hasLoaded: false })
const listeners = new Set<() => void>()
let account = '', snapshot = empty, request: ((more?: boolean, readStateOnly?: boolean) => Promise<void>) | undefined
let discard: ((conversation: TeamConversation) => void) | undefined
export const subscribeTeamDirectory = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export const readTeamDirectory = (key: string): Snapshot => key === account ? projectedSnapshot : empty
export const refreshTeamDirectory = (key: string, more = false, readStateOnly = false): Promise<void> => key === account ? request?.(more, readStateOnly) ?? Promise.resolve() : Promise.resolve()
const pendingReads = new Map<string, number>()
// The read-state endpoint can learn a newer message before the directory preview changes.
const readStateFrontiers = new Map<string, number>()
let projectedSnapshot = empty
const emit = () => {
  projectedSnapshot = snapshot
  if (pendingReads.size > 0 || readStateFrontiers.size > 0) {
    const rows = new Map(snapshot.items.map(row => [row.key, row.lastSeq]))
    for (const key of pendingReads.keys()) if (!rows.has(key)) pendingReads.delete(key)
    for (const [key, frontier] of readStateFrontiers) {
      const last = rows.get(key)
      if (last === undefined || last >= frontier) readStateFrontiers.delete(key)
    }
  }
  if (pendingReads.size > 0) {
    const items = snapshot.items.map(row => {
      const sequence = pendingReads.get(row.key)
      if (sequence === undefined) return row
      if (row.myReadSeq >= sequence || row.lastSeq > sequence) {
        pendingReads.delete(row.key)
        return row
      }
      return row.unread ? { ...row, unread: 0, attentionUnread: 0 } : row
    })
    projectedSnapshot = items.some((item, index) => item !== snapshot.items[index]) ? { ...snapshot, items } : snapshot
  }
  for (const listener of listeners) listener()
}

/** Project only a proved latest read. Keep raw unread counts for failure and concurrent arrivals. */
export function markTeamDirectoryRead(accountKey: string, conversationKey: string, sequence: number): () => void {
  const row = snapshot.items.find(item => item.key === conversationKey)
  if (accountKey !== account || !row || sequence < Math.max(row.lastSeq, readStateFrontiers.get(conversationKey) ?? 0) || sequence <= row.myReadSeq
    || (pendingReads.get(conversationKey) ?? 0) >= sequence) return () => {}
  const owner = request
  pendingReads.set(conversationKey, sequence)
  emit()
  return () => {
    if (request !== owner || pendingReads.get(conversationKey) !== sequence) return
    pendingReads.delete(conversationKey)
    emit()
  }
}
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
  const itemsNow = () => {
    const items = new Map([...pins.values(), ...[...pages.values()].flatMap(p => p.items)].map(c => [c.key, c]))
    for (const c of openedTeamConversations.read(key)) items.set(c.key, mergeOpenedTeamConversation(c, items.get(c.key) ?? c))
    return [...items.values()].sort((a, b) => b.updatedAt - a.updatedAt || `${a.side}:${a.key}`.localeCompare(`${b.side}:${b.key}`))
  }
  let running: 'refresh' | 'more' | undefined
  let revision = 0, preferenceRefresh = 0
  let pendingRefresh: { readStateOnly: boolean; background: boolean } | undefined
  let pendingMore = false
  let folderRequest: AbortController | undefined
  let foldersReady: Promise<void> | undefined
  pendingReads.clear(); readStateFrontiers.clear()
  account = key; openedTeamConversations.activate(key); snapshot = { ...empty, items: itemsNow() }; emit()
  const stopOpened = openedTeamConversations.subscribe(changed => {
    if (changed !== key || controller.signal.aborted || account !== key) return
    ++revision
    snapshot = { ...snapshot, items: itemsNow() }; emit()
  })
  const refresh = async (more = false, readStateOnly = false, background = false) => {
    if (controller.signal.aborted || account !== key) return
    if (running) {
      if (more) {
        if (running !== 'more') pendingMore = true
      } else pendingRefresh = {
        readStateOnly: readStateOnly && (pendingRefresh?.readStateOnly ?? true),
        background: background && (pendingRefresh?.background ?? true),
      }
      return
    }
    running = more ? 'more' : 'refresh'
    const token = revision
    const priority = background ? { background: true } : {}
    const transport = background ? { priority: 'background' as const } : undefined
    if (!readStateOnly) { snapshot = { ...snapshot, loading: true }; emit() }
    let failure: string | undefined, accessLost = false
    if (!more && !readStateOnly) foldersReady = (async () => {
      // Folder IO stays optional, but a newer head owns its result and error.
      folderRequest?.abort()
      const folders=new AbortController();folderRequest=folders
      try {
        const value=await callArkme<TeamWorkspaceFolder[]>('team.app.workspace.request',{expectedAccountKey:key,...priority,request:{operation:'folders'}},folders.signal,transport)
        if(!Array.isArray(value))throw new Error('团队群文件夹暂时无法刷新')
        if(!folders.signal.aborted&&account===key&&token===revision){const {foldersError:_,...current}=snapshot;snapshot={...current,workspaceSupported:true,workspaceFolders:value};teamDirectoryPreferences.setWorkspaceAvailable(key,true)}
      } catch(e) {
        if(!folders.signal.aborted&&account===key&&token===revision) {
          if ((e as {body?:{code?:string}})?.body?.code === 'team-workspace-unsupported') {
            const {foldersError:_,...current}=snapshot
            snapshot={...current,workspaceSupported:false,workspaceFolders:[]}
            teamDirectoryPreferences.setWorkspaceAvailable(key,false)
          } else snapshot={...snapshot,workspaceFolders:[],foldersError:e instanceof Error?e.message:'团队群文件夹暂时无法刷新'}
        }
      } finally {
        if(folderRequest===folders)folderRequest=undefined
        if(!folders.signal.aborted&&account===key&&token===revision&&snapshot.hasLoaded) {
          emit()
        }
      }
    })()
    const preferenceToken = readStateOnly ? preferenceRefresh : ++preferenceRefresh
    const preferencesCurrent = () => !controller.signal.aborted && account === key && token === revision && preferenceToken === preferenceRefresh
    await Promise.all((['team', 'external'] as const).map(async side => {
      const previous = pages.get(side)
      if (more && !previous?.hasMore) return
      try {
        if (readStateOnly) {
          const targets = itemsNow().filter(c => c.side === side)
          if (!targets.length) return
          const states = new Map<string, TeamConversationReadState>()
          for (let i = 0; i < targets.length; i += 100) {
            const rows = await callArkme<TeamConversationReadState[]>('team.app.read-states', {
              conversationRefs: targets.slice(i, i + 100).map(c => c.ref), expectedAccountKey: key, ...priority,
            }, controller.signal, transport)
            for (const state of rows) states.set(state.key, state)
          }
          if (!controller.signal.aborted && account === key && token === revision) {
            const updated = new Map(targets.flatMap(c => {
              const state = states.get(c.key)
              if (!state) throw new Error('阅读状态返回不完整')
              if (!state.accessible) { accessLost = true; return [] }
              if (state.lastSeq < Math.max(c.lastSeq, readStateFrontiers.get(c.key) ?? 0) || state.myReadSeq < c.myReadSeq) return [[c.key, c] as const]
              if (state.lastSeq > c.lastSeq) readStateFrontiers.set(c.key, state.lastSeq)
              const pending = pendingReads.get(c.key)
              if (pending !== undefined && (state.lastSeq > pending || state.myReadSeq >= pending)) pendingReads.delete(c.key)
              return [[c.key, {...c, myReadSeq: state.myReadSeq, unread: state.unread, notificationPolicy:mergeTeamNotificationPolicy(c.notificationPolicy,state.notificationPolicy)}] as const]
            }))
            if (previous) pages.set(side, {...previous, items: previous.items.flatMap(c => updated.has(c.key) ? [updated.get(c.key)!] : [])})
            for (const [id, c] of pins) if (c.side === side) { if (updated.has(id)) pins.set(id, updated.get(id)!); else pins.delete(id) }
            openedTeamConversations.reconcile(key, c => c.side === side ? updated.get(c.key) : c)
          }
          return
        }
        if (more && !previous?.nextCursor) throw new Error('消息分页异常，请重试')
        let page = await callArkme<TeamPage<TeamConversation>>('team.app.conversations', { side, expectedAccountKey: key, ...priority, ...(more && previous?.nextCursor ? { cursor: previous.nextCursor } : {}) }, controller.signal, transport)
        if (more && page.hasMore && page.nextCursor === previous?.nextCursor) throw new Error('消息分页异常，请重试')
        const previousByKey=new Map(previous?.items.map(c=>[c.key,c])??[])
        const items = new Map([...(more ? previous?.items ?? [] : []), ...page.items.map(c=>({...c,notificationPolicy:mergeTeamNotificationPolicy(previousByKey.get(c.key)?.notificationPolicy,c.notificationPolicy)}))].map(c => [c.key, c]))
        const seen = new Set<string>()
        while (!more && items.size < (previous?.items.length ?? 0) && page.hasMore) {
          if (!page.nextCursor || seen.has(page.nextCursor)) throw new Error('消息分页异常，请重试')
          seen.add(page.nextCursor)
          page = await callArkme<TeamPage<TeamConversation>>('team.app.conversations', { side, expectedAccountKey: key, ...priority, cursor: page.nextCursor }, controller.signal, transport)
          for (const c of page.items) items.set(c.key, {...c,notificationPolicy:mergeTeamNotificationPolicy(items.get(c.key)?.notificationPolicy,c.notificationPolicy)})
        }
        if (!controller.signal.aborted && account === key && token === revision) {
          pages.set(side, { ...page, items: [...items.values()] })
          openedTeamConversations.reconcile(key, c => items.has(c.key) ? mergeOpenedTeamConversation(c, items.get(c.key)!) : c)
        }
      } catch (e) {
        failure = e instanceof Error ? e.message : '团队对话暂时无法刷新'
        if (!readStateOnly && token === revision) {
          if (previous) pages.set(side, { ...previous, items: previous.items.map(c => c.visitor ? { ...c, visitor: { ...c.visitor, memberType: 'unknown' } } : c) })
          for (const [id, c] of pins) if (c.side === side && c.visitor) pins.set(id, { ...c, visitor: { ...c.visitor, memberType: 'unknown' } })
          openedTeamConversations.reconcile(key, c => c.side === side && c.visitor ? { ...c, visitor: { ...c.visitor, memberType: 'unknown' } } : c)
        }
        if (token === revision && /team-(not_accessible|account-changed)|login-/.test(String((e as { body?: { code?: string } })?.body?.code))) {
          pages.delete(side); for (const [id, c] of pins) if (c.side === side) pins.delete(id)
          openedTeamConversations.reconcile(key, c => c.side === side ? undefined : c)
          accessLost = true
        }
      }
    }))
    running = undefined
    if (controller.signal.aborted || account !== key) return
    if (accessLost) ++revision
    const items = itemsNow()
    snapshot = { ...(snapshot.workspaceSupported===undefined?{}:{workspaceSupported:snapshot.workspaceSupported}),workspaceFolders:snapshot.workspaceFolders,...(snapshot.foldersError?{foldersError:snapshot.foldersError}:{}),items, hasMore: [...pages.values()].some(p => p.hasMore), loading: false, hasLoaded: true, ...(failure ? { error: failure } : {}) }; emit()
    if (!readStateOnly && preferencesCurrent()) {
      // Publish conversation rows first, then sync preferences once the folder scope is known.
      void (async () => {
        await foldersReady
        if (!preferencesCurrent()) return
        await teamDirectoryPreferences.hydrate(key, true, background)
        if (!preferencesCurrent()) return
        await teamDirectoryPreferences.reconcile(key, itemsNow(), controller.signal, background)
        if (!preferencesCurrent()) return
        // A preference query also carries an authority verdict. A denial must
        // retire old previews, rather than appear as an ordinary default row.
        const allowed = (c: TeamConversation) => teamDirectoryPreferences.canPresent(key, c)
        const before = itemsNow().length
        for (const [side, page] of pages) pages.set(side, { ...page, items: page.items.filter(allowed) })
        for (const [id, c] of pins) if (!allowed(c)) pins.delete(id)
        openedTeamConversations.reconcile(key, c => allowed(c) ? c : undefined)
        if (itemsNow().length !== before) { snapshot = { ...snapshot, items: itemsNow() }; emit() }
        const extra: TeamConversation[] = []
        const targets = teamDirectoryPreferences.missingPins(key, items)
        for (let i = 0; i < targets.length; i += 10) {
          const batch = await Promise.all(targets.slice(i, i + 10).map(async target => {
            try {
              if (target.kind === 'folder') return (await callArkme<TeamPage<TeamConversation>>('team.app.conversations', { teamRef: target.ref, side: 'team', limit: 1, expectedAccountKey: key, ...priority }, controller.signal, transport)).items
              return [(await callArkme<import('../team-app-contract.js').TeamTimeline>('team.app.timeline', { conversationRef: target.ref, limit: 1, expectedAccountKey: key, ...priority }, controller.signal)).conversation]
            } catch { return [] }
          }))
          // A pin does not activate a preview. Only publication or a validated
          // member-initiated contact can appear outside the ordinary page.
          extra.push(...batch.flat().filter(c => c.lastSeq > 0 || c.side === 'team' && c.memberInitiated === true))
        }
        if (!preferencesCurrent()) return
        for (const c of extra) if (!pins.has(c.key) && allowed(c)) pins.set(c.key, c)
        const preferences = teamDirectoryPreferences.read(key)
        for (const [id, c] of pins) if (!teamEntryPinned(preferences, { kind: 'conversation', conversation: c }) &&
          !(c.side === 'team' && teamEntryPinned(preferences, { kind: 'folder', group: groupTeamConversations([c])[0]! }))) pins.delete(id)
        snapshot = { ...snapshot, items: itemsNow() }; emit()
      })().catch(() => { /* Optional sync errors are exposed by the preference owner. */ })
    }
    if (pendingRefresh?.background === false) {
      const { readStateOnly } = pendingRefresh
      pendingRefresh = undefined
      await refresh(false, readStateOnly)
    } else if (pendingMore) {
      pendingMore = false
      await refresh(true)
    } else if (pendingRefresh) {
      const { readStateOnly } = pendingRefresh
      pendingRefresh = undefined
      await refresh(false, readStateOnly, true)
    }
  }
  request = refresh
  discard = conversation => {
    ++revision
    for (const [id, c] of pins) if (c.side === conversation.side && c.channel.jotmoId === conversation.channel.jotmoId) pins.delete(id)
    openedTeamConversations.reconcile(key, c => c.side === conversation.side && c.channel.jotmoId === conversation.channel.jotmoId ? undefined : c)
    const page = pages.get(conversation.side)
    if (page) pages.set(conversation.side, { ...page, items: page.items.filter(c => c.channel.jotmoId !== conversation.channel.jotmoId) })
    snapshot = { ...snapshot, items: snapshot.items.filter(c => c.side !== conversation.side || c.channel.jotmoId !== conversation.channel.jotmoId) }; emit()
    void refresh(false, false, true)
  }
  const stop = subscribeTeamMessageChanges((changed, receiptOnly,change) => {
    if (changed !== key) return
    if (!receiptOnly) {
      ++revision
      const invalidate=(row:TeamConversation)=>teamChangeAffectsConversationPreview(change,row)?withoutTeamConversationMaterial(row):row
      for (const [side,page] of pages) pages.set(side,{...page,items:page.items.map(invalidate)})
      for (const [id, row] of pins) pins.set(id, invalidate(row))
      openedTeamConversations.reconcile(key, invalidate)
      snapshot={...snapshot,items:snapshot.items.map(invalidate)};emit()
    }
    void refresh(false, receiptOnly === true, true)
  })
  const stopWorkspace=subscribeTeamWorkspaceChanges(changed=>{if(changed===key){++revision;snapshot={...snapshot,workspaceFolders:[]};emit();void refresh(false, false, true)}})
  const focus = () => { void refresh(false, false, true) }
  const timer = setInterval(() => { if (document.visibilityState === 'visible') focus() }, 60_000)
  window.addEventListener('focus', focus)
  window.addEventListener('online', focus)
  void refresh(false, false, true)
  return () => {
    controller.abort(); folderRequest?.abort(); stop(); stopOpened(); stopWorkspace(); clearInterval(timer); window.removeEventListener('focus', focus); window.removeEventListener('online', focus)
    if (request === refresh) { pendingReads.clear(); readStateFrontiers.clear(); account = ''; request = undefined; discard = undefined; snapshot = empty; openedTeamConversations.reset(key); emit() }
  }
}

export interface TeamConversationGroup {
  key: string; channel: TeamChannel; conversations: TeamConversation[]; latest?: TeamConversation
  activeAt:number; preview?:string; hasPublished:boolean; groupCount:number
  unread: number; attentionUnread: number; unreadExact: boolean
}
export function groupTeamConversations(conversations: readonly TeamConversation[], complete = true, workspaceFolders:readonly TeamWorkspaceFolder[] = []): TeamConversationGroup[] {
  const groups = new Map<string, Map<string, TeamConversation>>()
  for (const c of conversations) {
    if (c.side !== 'team') continue
    const group = groups.get(c.channel.jotmoId) ?? new Map<string, TeamConversation>()
    group.set(c.key, c); groups.set(c.channel.jotmoId, group)
  }
  const result:TeamConversationGroup[] = [...groups].map(([key, group]) => {
    const rows = [...group.values()].sort((a,b)=>b.updatedAt-a.updatedAt || a.key.localeCompare(b.key)), latest = rows[0]!
    return {key,channel:latest.channel,conversations:rows,latest,activeAt:latest.updatedAt,hasPublished:rows.some(c=>c.lastSeq>0),groupCount:0,unread:rows.reduce((count,c)=>count+Math.max(0,c.unread),0),attentionUnread:rows.reduce((count,c)=>count+(c.notificationPolicy?.muted?0:Math.max(0,c.unread)),0),unreadExact:complete}
  })
  for(const folder of workspaceFolders) {
    const current=result.find(group=>group.key===folder.channel.jotmoId)
    if(current) {
      current.unread+=folder.unread;current.attentionUnread+=folder.unread;current.groupCount=folder.groupCount;current.hasPublished||=folder.hasPublished
      if(folder.activityAt>=current.activeAt){current.activeAt=folder.activityAt;current.preview=folder.preview}
    } else result.push({key:folder.channel.jotmoId,channel:folder.channel,conversations:[],activeAt:folder.activityAt,preview:folder.preview,hasPublished:folder.hasPublished,groupCount:folder.groupCount,unread:folder.unread,attentionUnread:folder.unread,unreadExact:complete})
  }
  return result.sort((a,b)=>b.activeAt-a.activeAt||a.key.localeCompare(b.key))
}

type TeamDirectoryRow = { kind:'team'; conversation:TeamConversation; activeAtMillis:number; pinned:boolean }
  | { kind:'team-folder'; group:TeamConversationGroup; activeAtMillis:number; pinned:boolean }
/** Internal visitors share one team entry; external-facing conversations retain their direct entry. */
export function mergeTeamDirectoryRows<T extends { activeAtMillis: number; pinned: boolean }>(ordinary: readonly T[], teams: TeamConversation[], complete = true, preferences: TeamDirectoryPreferences = {}, workspaceFolders:readonly TeamWorkspaceFolder[] = []): (T | TeamDirectoryRow)[] {
  const result: (T | TeamDirectoryRow)[] = [...ordinary]
  const teamRows: TeamDirectoryRow[] = [
    ...groupTeamConversations(teams,complete,workspaceFolders).filter(group=>!teamEntryHidden(preferences,{kind:'folder',group})).map(group=>({kind:'team-folder' as const,group,activeAtMillis:group.activeAt,pinned:teamEntryPinned(preferences,{kind:'folder',group})})),
    ...teams.filter(c=>c.side==='external' && !teamEntryHidden(preferences,{kind:'conversation',conversation:c})).map(conversation=>({kind:'team' as const,conversation,activeAtMillis:conversation.updatedAt,pinned:teamEntryPinned(preferences,{kind:'conversation',conversation})})),
  ]
  for (const row of teamRows.sort((a,b)=>b.activeAtMillis-a.activeAtMillis)) {
    const index=result.findIndex(item=>Number(row.pinned)>Number(item.pinned) || row.pinned===item.pinned && item.activeAtMillis<row.activeAtMillis)
    result.splice(index<0?result.length:index,0,row)
  }
  return result
}
