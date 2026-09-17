/** Display-only account-scoped summary. Official sessions remain the source of running/pending state. */
export const HARNESS_ACTIVITY_ATTRIBUTE = 'data-arkme-harness-activity'
export const HARNESS_ACTIVITY_EVENT = 'arkme:harness-activity'
export interface HarnessActivityItem { id: string; title: string }
export interface HarnessActivity {
  scope: string
  /** The native selection is also the destination of the Arkme entry. Null means a new conversation. */
  current?: HarnessActivityItem | null
  running: HarnessActivityItem[]
  unread: HarnessActivityItem[]
  pending: HarnessActivityItem[]
}
export interface ActivitySession {
  id: string; displayTitle: string; running: boolean
  origin?: string; parentId?: string; blank?: boolean; completed?: boolean; pendingInteraction?: string
}
export interface ActivityList {
  phase: string; ids: readonly string[]; byId: Readonly<Record<string, ActivitySession>>; current?: string | undefined
}
export type PendingInteractions = ReadonlyMap<string, { kind: string }>
type StorageFace = Pick<Storage, 'getItem' | 'setItem'>
const pendingKinds = new Set(['approval', 'plan-review', 'question'])

/** Only unread reminder ids are local; no copied sessions, histories or execution states. */
export class HarnessActivityTracker {
  private unread = new Set<string>()
  private previous = new Map<string, { active: boolean; completed: boolean }>()
  private readonly key: string
  private persisted = ''

  constructor(readonly scope: string, private readonly storage?: StorageFace) {
    this.key = `arkme.harness.unviewed.v1:${scope}`
    try {
      const saved: unknown = JSON.parse(storage?.getItem(this.key) ?? '[]')
      if (Array.isArray(saved)) this.unread = new Set(saved.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 512))
    } catch { /* Restricted storage must not affect native conversations. */ }
    this.persisted = JSON.stringify([...this.unread].sort())
  }

  update(list: ActivityList, archived: readonly string[], pending: PendingInteractions | undefined, visibleSession?: string): HarnessActivity {
    const result: HarnessActivity = { scope: this.scope, running: [], unread: [], pending: [] }
    if (list.phase !== 'ready') return result
    const current = list.current === undefined ? undefined : list.byId[list.current]
    if (current) result.current = { id: current.id, title: current.blank ? '新会话' : current.displayTitle || '未命名对话' }
    else if (list.current === undefined) result.current = null
    const hidden = new Set(archived)
    const groups = new Map<string, { item: HarnessActivityItem; running: boolean; pending: boolean; completed: boolean }>()
    for (const id of list.ids) {
      const session = list.byId[id]
      if (!session || session.origin === 'subagent' || hidden.has(id) || session.blank) continue
      groups.set(id, { item: { id, title: session.displayTitle || '未命名对话' }, running: false, pending: false, completed: session.completed === true })
    }
    for (const session of Object.values(list.byId)) {
      let root: ActivitySession | undefined = session
      const seen = new Set<string>()
      while (root?.origin === 'subagent' && root.parentId && !seen.has(root.id)) {
        seen.add(root.id); root = list.byId[root.parentId]
      }
      const group = root && groups.get(root.id)
      if (!group) continue
      group.running ||= session.running === true
      const kind = pending === undefined ? session.pendingInteraction : pending.get(session.id)?.kind
      group.pending ||= kind !== undefined && pendingKinds.has(kind)
    }
    for (const id of this.unread) if (!groups.has(id)) this.unread.delete(id)
    for (const [id, group] of groups) {
      const active = group.running || group.pending
      const previous = this.previous.get(id)
      if (active) this.unread.delete(id)
      else if (previous?.active || (group.completed && !previous?.completed)) this.unread.add(id)
      if (visibleSession === id) this.unread.delete(id)
      this.previous.set(id, { active, completed: group.completed })
      if (group.pending) result.pending.push(group.item)
      else if (group.running) result.running.push(group.item)
      else if (this.unread.has(id)) result.unread.push(group.item)
    }
    for (const id of this.previous.keys()) if (!groups.has(id)) this.previous.delete(id)
    const saved = JSON.stringify([...this.unread].sort())
    if (saved !== this.persisted) {
      this.persisted = saved
      try { this.storage?.setItem(this.key, saved) } catch { /* Keep the current page's reminders. */ }
    }
    return result
  }
}

export function parseHarnessActivity(raw: string | null, scope: string | undefined): HarnessActivity | undefined {
  if (!raw || !scope) return
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null || !('scope' in value) || value.scope !== scope) return
    const record = value as Record<string, unknown>
    const isItem = (item: unknown): item is HarnessActivityItem => typeof item === 'object' && item !== null && 'id' in item && typeof item.id === 'string' && 'title' in item && typeof item.title === 'string'
    if (record.current !== undefined && record.current !== null && !isItem(record.current)) return
    for (const key of ['running', 'unread', 'pending']) {
      const items = record[key]
      if (!Array.isArray(items) || !items.every(isItem)) return
    }
    return value as HarnessActivity
  } catch { return }
}
