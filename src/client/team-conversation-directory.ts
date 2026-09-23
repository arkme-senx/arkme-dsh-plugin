import { callArkme } from './api.js'
import { subscribeTeamMessageChanges } from './team-messaging-events.js'
import type { TeamConversation, TeamPage, TeamSide } from '../team-app-contract.js'

type Snapshot = { items: TeamConversation[]; hasMore: boolean; loading: boolean; error?: string }
const empty: Snapshot = Object.freeze({ items: [], hasMore: false, loading: false })
const listeners = new Set<() => void>()
let account = '', snapshot = empty, request: ((more?: boolean) => Promise<void>) | undefined
let discard: ((conversation: TeamConversation) => void) | undefined
export const subscribeTeamDirectory = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export const readTeamDirectory = (key: string): Snapshot => key === account ? snapshot : empty
export const refreshTeamDirectory = (key: string, more = false): Promise<void> => key === account ? request?.(more) ?? Promise.resolve() : Promise.resolve()
const emit = () => { for (const listener of listeners) listener() }
export function discardTeamDirectory(key: string, conversation: TeamConversation): void {
  if (key !== account) return
  discard?.(conversation)
}

/** One account-scoped presentation source. Neither Chat storage nor readiness depends on it. */
export function startTeamDirectory(key: string): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}
  const controller = new AbortController(), pages = new Map<TeamSide, TeamPage<TeamConversation>>()
  let running = false, again = false, revision = 0
  account = key; snapshot = empty; emit()
  const refresh = async (more = false) => {
    if (controller.signal.aborted || account !== key) return
    if (running) { if (!more) again = true; return }
    running = true
    const token = revision
    snapshot = { ...snapshot, loading: true }; emit()
    let failure: string | undefined
    await Promise.all((['team', 'external'] as const).map(async side => {
      const previous = pages.get(side)
      if (more && !previous?.hasMore) return
      try {
        let page = await callArkme<TeamPage<TeamConversation>>('team.app.conversations', { side, ...(more && previous?.nextCursor ? { cursor: previous.nextCursor } : {}) }, controller.signal)
        const items = new Map([...(more ? previous?.items ?? [] : []), ...page.items].map(c => [c.key, c]))
        const seen = new Set<string>()
        while (!more && items.size < (previous?.items.length ?? 0) && page.hasMore) {
          if (!page.nextCursor || seen.has(page.nextCursor)) throw new Error('消息分页异常，请重试')
          seen.add(page.nextCursor)
          page = await callArkme<TeamPage<TeamConversation>>('team.app.conversations', { side, cursor: page.nextCursor }, controller.signal)
          for (const c of page.items) items.set(c.key, c)
        }
        if (!controller.signal.aborted && account === key && token === revision) pages.set(side, { ...page, items: [...items.values()] })
      } catch (e) {
        failure = e instanceof Error ? e.message : '团队对话暂时无法刷新'
        if (token === revision && /team-(not_accessible|account-changed)|login-/.test(String((e as { body?: { code?: string } })?.body?.code))) pages.delete(side)
      }
    }))
    running = false
    if (controller.signal.aborted || account !== key) return
    const items = [...pages.values()].flatMap(p => p.items).sort((a, b) => b.updatedAt - a.updatedAt || `${a.side}:${a.key}`.localeCompare(`${b.side}:${b.key}`))
    snapshot = { items, hasMore: [...pages.values()].some(p => p.hasMore), loading: false, ...(failure ? { error: failure } : {}) }; emit()
    if (again) { again = false; await refresh() }
  }
  request = refresh
  discard = conversation => {
    ++revision
    const page = pages.get(conversation.side)
    if (page) pages.set(conversation.side, { ...page, items: page.items.filter(c => c.channel.jotmoId !== conversation.channel.jotmoId) })
    snapshot = { ...snapshot, items: snapshot.items.filter(c => c.side !== conversation.side || c.channel.jotmoId !== conversation.channel.jotmoId) }; emit()
    void refresh()
  }
  const stop = subscribeTeamMessageChanges(changed => { if (changed === key) void refresh() })
  const focus = () => { void refresh() }
  const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 60_000)
  window.addEventListener('focus', focus)
  void refresh()
  return () => {
    controller.abort(); stop(); clearInterval(timer); window.removeEventListener('focus', focus)
    if (request === refresh) { account = ''; request = undefined; discard = undefined; snapshot = empty; emit() }
  }
}

/** Merges independent UI rows; preserves ordinary pinned order and object identity. */
export function mergeTeamDirectoryRows<T extends { activeAtMillis: number; pinned: boolean }>(ordinary: readonly T[], teams: TeamConversation[]): (T | { kind: 'team'; conversation: TeamConversation; activeAtMillis: number; pinned: false })[] {
  const result: (T | { kind: 'team'; conversation: TeamConversation; activeAtMillis: number; pinned: false })[] = [...ordinary]
  for (const conversation of teams) {
    const row = { kind: 'team' as const, conversation, activeAtMillis: conversation.updatedAt, pinned: false as const }
    const index = result.findIndex(item => !item.pinned && item.activeAtMillis < row.activeAtMillis)
    result.splice(index < 0 ? result.length : index, 0, row)
  }
  return result
}
