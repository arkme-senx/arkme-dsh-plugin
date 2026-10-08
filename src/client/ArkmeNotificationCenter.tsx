import { officialNotifications, useOfficialNotifications } from './official-notification-store.js'
import { ArkmeOfficialNotificationDetail } from './ArkmeOfficialNotificationDetail.js'
import type { OfficialNotificationSnapshot } from './official-notification-store.js'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties } from 'react'
import type {
  ArkmeArrangementReminderEvent,
  ArkmeArrangementReminderPage,
  ArkmeAiLetterItem,
  ArkmeAiLetterPage,
  ArkmeAiLetterUnread,
  ArkmeWorldFeedPage,
  ArkmeWorldInteractionPage,
  ArkmeWorldInteractionSummary,
} from '../types.js'
import type { ReactionNotification } from '../reaction-contract.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeChatDirectory } from './chat-directory-store.js'
import { arkmeUi } from './ui-controller.js'
import { reactionNotifications } from './reaction-notifications.js'
import { tr, arkmeIntlLocale } from './locale.js'
import { arkmeTheme } from './arkme-theme.js'

export type ArkmeNotificationKind = 'official' | 'arrangement' | 'reaction' | 'world' | 'ai'

export interface ArkmeNotificationItem {
  id: string
  kind: ArkmeNotificationKind
  title: string
  preview: string
  atMillis: number
  unread: boolean
  arrangement?: ArkmeArrangementReminderEvent
  reaction?: ReactionNotification
  aiLetter?: ArkmeAiLetterItem
}

interface NotificationSnapshot {
  scope: string | undefined
  revision: number
  ready: boolean
  loading: boolean
  error: string | undefined
  arrangementItems: ArkmeArrangementReminderEvent[]
  worldItems: ArkmeNotificationItem[]
  worldUnreadCount: number
  worldSeenThroughSequence: number
  worldError: string | undefined
  aiItems: ArkmeNotificationItem[]
  aiUnreadCount: number
  aiLatestUnread: ArkmeAiLetterItem | undefined
  aiError: string | undefined
}

const EMPTY_SNAPSHOT: NotificationSnapshot = {
  scope: undefined,
  revision: 0,
  ready: false,
  loading: false,
  error: undefined,
  arrangementItems: [],
  worldItems: [],
  worldUnreadCount: 0,
  worldSeenThroughSequence: 0,
  worldError: undefined,
  aiItems: [],
  aiUnreadCount: 0,
  aiLatestUnread: undefined,
  aiError: undefined,
}

function accountScope(): string | undefined {
  const auth = arkmeAuthStore.getSnapshot().auth
  return auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : undefined
}

function compactText(value: string, limit = 180): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit).trimEnd()}…`
}

function dateLabel(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(arkmeIntlLocale(), {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)
}

function arrangementItem(event: ArkmeArrangementReminderEvent): ArkmeNotificationItem {
  const preview = compactText(event.description || event.title || tr('安排提醒'))
  return {
    id: `arrangement:${event.eventRef}`,
    kind: 'arrangement',
    title: event.title || tr('安排提醒'),
    preview,
    atMillis: event.eventAtMillis || event.remindAtMillis || event.updatedAtMillis || event.createdAtMillis,
    unread: event.read !== true,
    arrangement: event,
  }
}

function reactionItem(item: ReactionNotification): ArkmeNotificationItem {
  const expression = item.selections.at(-1)?.expression.text || tr('表态')
  return {
    id: `reaction:${item.id}:${item.revision}`,
    kind: 'reaction',
    title: `${item.actorUserId > 0 ? tr('收到表态') : tr('新通知')} · ${expression}`,
    preview: compactText(item.text || tr('点击查看原消息')),
    atMillis: item.selections.at(-1)?.at || item.sendAtMillis,
    unread: true,
    reaction: item,
  }
}

function worldItem(authorName: string, interactionRef: string, preview: string, atMillis: number): ArkmeNotificationItem {
  return {
    id: `world:${interactionRef}`,
    kind: 'world',
    title: `${authorName || '有人'} 回复了你的世界`,
    preview: compactText(preview || tr('查看世界互动')),
    atMillis,
    // The summary endpoint owns the unread count but does not expose a per-item
    // sequence. Keep the row neutral and use the authoritative aggregate badge.
    unread: false,
  }
}

function aiLetterItem(item: ArkmeAiLetterItem): ArkmeNotificationItem {
  return {
    id: `ai:${item.letterId}`,
    kind: 'ai',
    title: item.title || tr('AI 来信'),
    preview: compactText(item.summary || tr('查看 AI 来信')),
    atMillis: item.createdAtMillis,
    // The unread-count endpoint is authoritative for the aggregate badge.
    unread: false,
    aiLetter: item,
  }
}

class ArkmeNotificationStore {
  private snapshot: NotificationSnapshot = EMPTY_SNAPSHOT
  private listeners = new Set<() => void>()
  private controller: AbortController | undefined
  private inflight: Promise<void> | undefined

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getSnapshot = () => this.snapshot

  private publish(next: NotificationSnapshot): void {
    this.snapshot = { ...next, revision: this.snapshot.revision + 1 }
    for (const listener of this.listeners) listener()
  }

  async refresh(scope = accountScope()): Promise<void> {
    if (scope === undefined) {
      this.controller?.abort()
      this.controller = undefined
      this.inflight = undefined
      this.publish({ ...EMPTY_SNAPSHOT, scope })
      return
    }
    if (this.snapshot.scope === scope && this.inflight !== undefined) return this.inflight
    this.controller?.abort()
    const controller = new AbortController()
    this.controller = controller
    // Same-account refreshes keep their last projection; another account starts empty.
    const previous = this.snapshot.scope === scope ? this.snapshot : EMPTY_SNAPSHOT
    const operation = (async () => {
      this.publish({
        ...previous,
        scope,
        loading: true,
        error: undefined,
        worldError: undefined,
        aiError: undefined,
      })
      const [arrangementsResult, worldSummaryResult, worldFeedResult, aiUnreadResult, aiListResult] = await Promise.allSettled([
        callArkme<ArkmeArrangementReminderPage>('arrangements.reminders.list', {
          unreadOnly: false, limit: 50, offset: 0,
        }, controller.signal),
        callArkme<ArkmeWorldInteractionSummary>('world.interactions.summary', undefined, controller.signal),
        callArkme<ArkmeWorldFeedPage>('world.mine', { limit: 10, offset: 0 }, controller.signal),
        callArkme<ArkmeAiLetterUnread>('ai-letter.unread', undefined, controller.signal),
        callArkme<ArkmeAiLetterPage>('ai-letter.list', { periodType: 0, cursorStartAt: 0, limit: 20 }, controller.signal),
      ])
      if (controller.signal.aborted || this.controller !== controller) return

      let arrangementItems = this.snapshot.arrangementItems
      let error: string | undefined
      if (arrangementsResult.status === 'fulfilled') {
        arrangementItems = Array.isArray(arrangementsResult.value?.items) ? arrangementsResult.value.items : []
      }
      else error = arrangementsResult.reason instanceof Error ? arrangementsResult.reason.message : tr('通知暂时无法加载')

      let worldUnreadCount = this.snapshot.worldUnreadCount
      let worldSeenThroughSequence = this.snapshot.worldSeenThroughSequence
      let worldError: string | undefined
      if (worldSummaryResult.status === 'fulfilled') {
        worldUnreadCount = Math.max(0, Math.trunc(worldSummaryResult.value.unreadCount))
        worldSeenThroughSequence = Math.max(0, Math.trunc(worldSummaryResult.value.seenThroughSequence))
      } else {
        worldError = worldSummaryResult.reason instanceof Error ? worldSummaryResult.reason.message : tr('世界互动暂时无法加载')
      }

      let worldItems: ArkmeNotificationItem[] = []
      if (worldFeedResult.status === 'fulfilled') {
        const feedItems = Array.isArray(worldFeedResult.value?.items) ? worldFeedResult.value.items.slice(0, 10) : []
        const interactionResults = await Promise.allSettled(feedItems.map(feedItem => callArkme<ArkmeWorldInteractionPage>(
          'world.interactions.list', { recordRef: feedItem.recordRef, limit: 50, offset: 0 }, controller.signal,
        )))
        if (controller.signal.aborted || this.controller !== controller) return
        const seen = new Set<string>()
        interactionResults.forEach(result => {
          if (result.status !== 'fulfilled') return
          const interactions = Array.isArray(result.value?.items) ? result.value.items : []
          interactions.forEach(interaction => {
            if (seen.has(interaction.interactionRef)) return
            seen.add(interaction.interactionRef)
            worldItems.push(worldItem(
              interaction.authorName,
              interaction.interactionRef,
              interaction.textContent,
              interaction.publishedAtMillis || interaction.createdAtMillis,
            ))
          })
        })
        worldItems.sort((left, right) => right.atMillis - left.atMillis)
        if (interactionResults.some(result => result.status === 'rejected')) {
          worldError ??= tr('部分世界互动暂时无法加载')
          // Keep the last complete bounded page rather than accumulating partial pages.
          if (this.snapshot.worldItems.length > 0) worldItems = this.snapshot.worldItems
        }
      } else {
        worldItems = this.snapshot.worldItems
        worldError ??= worldFeedResult.reason instanceof Error ? worldFeedResult.reason.message : tr('世界互动暂时无法加载')
      }

      let aiUnreadCount = this.snapshot.aiUnreadCount
      let aiLatestUnread = this.snapshot.aiLatestUnread
      let aiError: string | undefined
      if (aiUnreadResult.status === 'fulfilled') {
        aiUnreadCount = Math.max(0, Math.trunc(aiUnreadResult.value.unreadCount))
        aiLatestUnread = aiUnreadResult.value.latestUnread
      } else {
        aiError = aiUnreadResult.reason instanceof Error ? aiUnreadResult.reason.message : tr('AI 来信暂时无法加载')
      }
      let aiItems = aiListResult.status === 'fulfilled'
        ? (Array.isArray(aiListResult.value?.items) ? aiListResult.value.items : []).map(aiLetterItem).sort((left, right) => right.atMillis - left.atMillis)
        : this.snapshot.aiItems
      if (aiItems.length === 0 && aiLatestUnread !== undefined) aiItems = [aiLetterItem(aiLatestUnread)]
      if (aiListResult.status === 'rejected' && aiError === undefined) {
        aiError = aiListResult.reason instanceof Error ? aiListResult.reason.message : tr('AI 来信暂时无法加载')
      }

      this.publish({
        ...this.snapshot,
        scope,
        ready: true,
        loading: false,
        error,
        arrangementItems,
        worldItems,
        worldUnreadCount,
        worldSeenThroughSequence,
        worldError,
        aiItems,
        aiUnreadCount,
        aiLatestUnread,
        aiError,
      })
    })()
    this.inflight = operation
    try { await operation } finally {
      if (this.inflight === operation) this.inflight = undefined
    }
  }

  async markArrangementRead(eventRef: string): Promise<void> {
    const normalized = eventRef.trim()
    if (normalized === '') return
    await callArkme('arrangements.reminders.mark-read', { eventRefs: [normalized] })
    const items = this.snapshot.arrangementItems.map(item => item.eventRef === normalized ? { ...item, read: true } : item)
    this.publish({ ...this.snapshot, arrangementItems: items })
  }

  async markAllArrangementRead(): Promise<void> {
    await callArkme('arrangements.reminders.mark-all-read', undefined)
    this.publish({ ...this.snapshot, arrangementItems: this.snapshot.arrangementItems.map(item => ({ ...item, read: true })) })
  }

  async markWorldViewed(): Promise<void> {
    const sequence = this.snapshot.worldSeenThroughSequence
    if (sequence <= 0) return
    const result = await callArkme<ArkmeWorldInteractionSummary>('world.interactions.mark-viewed', {
      seenThroughSequence: sequence,
    })
    this.publish({
      ...this.snapshot,
      worldUnreadCount: Math.max(0, Math.trunc(result.unreadCount)),
      worldSeenThroughSequence: Math.max(sequence, Math.trunc(result.seenThroughSequence)),
      worldItems: this.snapshot.worldItems.map(item => ({ ...item, unread: false })),
    })
  }

  async markAiRead(letterIds: readonly string[]): Promise<void> {
    const ids = [...new Set(letterIds.map(value => value.trim()).filter(value => value !== ''))]
    if (ids.length === 0) return
    const result = await callArkme<ArkmeAiLetterUnread>('ai-letter.mark-read', { letterIds: ids.slice(0, 50) })
    this.publish({
      ...this.snapshot,
      aiUnreadCount: Math.max(0, Math.trunc(result.unreadCount)),
      aiItems: this.snapshot.aiItems.map(item => ids.includes(item.aiLetter?.letterId ?? '') ? { ...item, unread: false } : item),
    })
  }
}

export const arkmeNotificationStore = new ArkmeNotificationStore()

function useNotificationItems(): {
  scope: string | undefined
  snapshot: NotificationSnapshot
  official: OfficialNotificationSnapshot
  reactionItems: ReactionNotification[]
  items: ArkmeNotificationItem[]
} {
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot).auth
  const scope = auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : undefined
  const official = useOfficialNotifications(scope)
  const storedSnapshot = useSyncExternalStore(arkmeNotificationStore.subscribe, arkmeNotificationStore.getSnapshot, arkmeNotificationStore.getSnapshot)
  const snapshot = storedSnapshot.scope === scope ? storedSnapshot : EMPTY_SNAPSHOT
  const reactionRevision = useSyncExternalStore(reactionNotifications.subscribe, reactionNotifications.getSnapshot, reactionNotifications.getSnapshot)
  useEffect(() => {
    const release = scope === undefined ? undefined : reactionNotifications.acquire(scope)
    void arkmeNotificationStore.refresh(scope)
    return release
  }, [scope])
  const reactionItems = useMemo(() => scope === undefined ? [] : reactionNotifications.forAccount(scope), [reactionRevision, scope])
  const items = useMemo(() => [
    ...official.items.map(item => ({ id: `official:${item.id}`, kind: 'official' as const, title: item.title, preview: item.summary, atMillis: item.publishedAtMillis, unread: item.readAtMillis === 0 })),
    ...snapshot.arrangementItems.map(arrangementItem),
    ...snapshot.worldItems,
    ...snapshot.aiItems,
    ...reactionItems.map(reactionItem),
  ].sort((left, right) => right.atMillis - left.atMillis), [official.items, reactionItems, snapshot.aiItems, snapshot.arrangementItems, snapshot.worldItems])
  return { scope, snapshot, official, reactionItems, items }
}

function NotificationBell({ size = 22 }: { size?: number }) {
  return <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
    <path d="M10 21h4" />
  </svg>
}

export function useArkmeNotificationSummary(): { ready: boolean; hasNotifications: boolean; unreadCount: number; preview: string; atMillis: number } {
  const { items, snapshot, official } = useNotificationItems()
  const unread = items.filter(item => item.kind !== 'official' && item.unread)
  const officialLatest = official.summary.latest
  const latest = officialLatest !== undefined && officialLatest.publishedAtMillis > (items[0]?.atMillis ?? 0) ? { title: officialLatest.title, preview: officialLatest.summary, atMillis: officialLatest.publishedAtMillis } : items[0]
  return {
    ready: snapshot.scope !== undefined && (snapshot.ready || official.ready),
    hasNotifications: official.summary.total > 0 || items.length > 0 || snapshot.worldUnreadCount > 0 || snapshot.aiUnreadCount > 0,
    unreadCount: official.summary.unreadCount + unread.length + snapshot.worldUnreadCount + snapshot.aiUnreadCount,
    preview: latest === undefined ? tr('官方、安排和互动通知') : `${latest.title}：${latest.preview}`,
    atMillis: latest?.atMillis ?? 0,
  }
}

const styles: Record<string, CSSProperties> = {
  shell: { display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%', background: arkmeTheme.base, color: arkmeTheme.text },
  header: { display: 'flex', alignItems: 'center', gap: 10, minHeight: 64, padding: '0 20px', borderBottom: `1px solid ${arkmeTheme.borderSoft}` },
  title: { margin: 0, flex: 1, fontSize: 20, lineHeight: '28px', fontWeight: 650 },
  action: { border: 0, borderRadius: 8, padding: '6px 8px', background: 'transparent', color: arkmeTheme.secondary, font: 'inherit', fontSize: 12, cursor: 'pointer' },
  filterBar: { display: 'flex', gap: 6, overflowX: 'auto', padding: '10px 14px 8px', borderBottom: `1px solid ${arkmeTheme.borderSoft}`, scrollbarWidth: 'none' },
  filterButton: { display: 'inline-flex', alignItems: 'center', gap: 5, flex: 'none', border: `1px solid ${arkmeTheme.borderSoft}`, borderRadius: 999, padding: '5px 10px', background: 'transparent', color: arkmeTheme.secondary, font: 'inherit', fontSize: 12, lineHeight: '16px', cursor: 'pointer', whiteSpace: 'nowrap' },
  filterButtonActive: { borderColor: arkmeTheme.accent, background: arkmeTheme.active, color: arkmeTheme.text },
  filterCount: { minWidth: 16, padding: '0 4px', borderRadius: 999, background: arkmeTheme.layer2, color: arkmeTheme.caption, fontSize: 10, lineHeight: '16px', textAlign: 'center' },
  list: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 12px 20px' },
  item: { width: '100%', display: 'flex', gap: 12, alignItems: 'flex-start', boxSizing: 'border-box', padding: '13px 10px', border: 0, borderRadius: 12, background: 'transparent', color: 'inherit', textAlign: 'left', font: 'inherit', cursor: 'pointer' },
  itemUnread: { background: arkmeTheme.layer2 },
  icon: { width: 34, height: 34, flex: 'none', display: 'grid', placeItems: 'center', borderRadius: 10, background: arkmeTheme.active, color: arkmeTheme.accent },
  content: { minWidth: 0, flex: 1 },
  top: { display: 'flex', gap: 8, alignItems: 'baseline' },
  itemTitle: { minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, lineHeight: '19px', fontWeight: 600 },
  time: { flex: 'none', color: arkmeTheme.caption, fontSize: 10 },
  preview: { marginTop: 3, color: arkmeTheme.secondary, fontSize: 12, lineHeight: '18px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  empty: { padding: '56px 24px', color: arkmeTheme.secondary, fontSize: 13, textAlign: 'center', lineHeight: '22px' },
  status: { padding: '12px 18px', color: arkmeTheme.secondary, fontSize: 12, lineHeight: '18px' },
}

function notificationKindLabel(kind: ArkmeNotificationKind): string {
  switch (kind) {
    case 'official': return tr('官方')
    case 'arrangement': return tr('安排')
    case 'reaction': return tr('表态')
    case 'world': return tr('世界')
    case 'ai': return tr('AI 来信')
  }
}

const notificationFilterKinds: readonly (ArkmeNotificationKind | 'all')[] = [
  'all', 'official', 'arrangement', 'reaction', 'world', 'ai',
]

function notificationFilterLabel(kind: ArkmeNotificationKind | 'all'): string {
  return kind === 'all' ? tr('全部') : notificationKindLabel(kind)
}

export function ArkmeNotificationCenter() {
  const { scope, snapshot, official, items } = useNotificationItems()
  const [officialDetail, setOfficialDetail] = useState<string>()
  const [actionError, setActionError] = useState('')
  const [allBusy, setAllBusy] = useState(false)
  useEffect(() => { setOfficialDetail(undefined); setActionError('') }, [scope])
  const [busyId, setBusyId] = useState<string | undefined>()
  const [activeKind, setActiveKind] = useState<ArkmeNotificationKind | 'all'>('all')
  const unreadCount = items.filter(item => item.kind !== 'official' && item.unread).length + official.summary.unreadCount + snapshot.worldUnreadCount + snapshot.aiUnreadCount
  const itemCounts = useMemo(() => {
    const counts: Record<ArkmeNotificationKind | 'all', number> = {
      all: items.length,
      official: 0,
      arrangement: 0,
      reaction: 0,
      world: 0,
      ai: 0,
    }
    for (const item of items) counts[item.kind] += 1
    counts.all += official.summary.total - counts.official
    counts.official = official.summary.total
    return counts
  }, [items, official.summary.total])
  const filteredItems = activeKind === 'all' ? items : items.filter(item => item.kind === activeKind)
  const openItem = useCallback(async (item: ArkmeNotificationItem) => {
    setBusyId(item.id)
    try {
      if (item.kind === 'official') { setOfficialDetail(item.id.slice('official:'.length)); return }
      if (item.kind === 'arrangement' && item.arrangement !== undefined) {
        await arkmeNotificationStore.markArrangementRead(item.arrangement.eventRef)
      } else if (item.kind === 'world') {
        await arkmeNotificationStore.markWorldViewed()
        arkmeUi.showWorld('mine')
      } else if (item.kind === 'ai' && item.aiLetter !== undefined) {
        await arkmeNotificationStore.markAiRead([item.aiLetter.letterId])
      } else if (item.kind === 'reaction' && item.reaction !== undefined && scope !== undefined) {
        await reactionNotifications.seen(scope, [item.reaction])
        const source = arkmeChatDirectory.getSnapshot().sources.find(candidate => candidate.sourceKey === item.reaction?.sourceKey)
        if (source !== undefined) arkmeUi.showConversationTarget(source, item.reaction.itemUid, item.reaction.sendAtMillis, item.reaction.recordOwnerUserId, undefined, true)
      }
    } finally {
      setBusyId(undefined)
    }
  }, [scope])
  const markAll = useCallback(async () => {
    if (unreadCount === 0 || allBusy) return
    const isCurrent = () => { const auth = arkmeAuthStore.getSnapshot().auth; return auth?.status === 'authenticated' && `${auth.environment}:${auth.userId}` === scope }
    setAllBusy(true)
    try {
    setActionError('')
    if (scope && official.summary.unreadCount > 0) { try { await officialNotifications.read(scope) } catch { setActionError(tr('部分官方通知未能标记已读，请重试')) } }
    if (!isCurrent()) return
    await arkmeNotificationStore.markAllArrangementRead().catch(() => undefined)
    if (!isCurrent()) return
    await arkmeNotificationStore.markWorldViewed().catch(() => undefined)
    if (!isCurrent()) return
    const aiIds = snapshot.aiItems.map(item => item.aiLetter?.letterId).filter((id): id is string => id !== undefined)
    if (snapshot.aiLatestUnread !== undefined) aiIds.push(snapshot.aiLatestUnread.letterId)
    await arkmeNotificationStore.markAiRead(aiIds).catch(() => undefined)
    if (scope !== undefined && isCurrent()) {
      const reactions = reactionNotifications.forAccount(scope)
      await reactionNotifications.seen(scope, reactions)
    }
    } finally { setAllBusy(false) }
  }, [scope, unreadCount, allBusy, official.summary.unreadCount, snapshot.aiItems, snapshot.aiLatestUnread])
  return <section style={styles.shell} aria-label={tr('通知')}>
    <header style={styles.header}>
      <span style={{ color: arkmeTheme.accent }}><NotificationBell size={21} /></span>
      <h2 style={styles.title}>{tr('通知')}{unreadCount > 0 ? ` (${unreadCount})` : ''}</h2>
      <button type="button" style={styles.action} disabled={unreadCount === 0 || allBusy} onClick={() => { void markAll() }}>{tr('全部已读')}</button>
    </header>
    {actionError && <div role="alert" style={styles.status}>{actionError}</div>}
    {officialDetail && scope ? <ArkmeOfficialNotificationDetail key={`${scope}:${officialDetail}`} id={officialDetail} scope={scope} onClose={() => setOfficialDetail(undefined)} /> : <>
    <div role="tablist" aria-label={tr('通知类型')} style={styles.filterBar}>
      {notificationFilterKinds.map(kind => {
        const selected = activeKind === kind
        return <button
          key={kind}
          type="button"
          role="tab"
          aria-selected={selected}
          aria-label={`${notificationFilterLabel(kind)} (${itemCounts[kind]})`}
          style={{ ...styles.filterButton, ...(selected ? styles.filterButtonActive : {}) }}
          onClick={() => { setActiveKind(kind) }}
        >
          <span>{notificationFilterLabel(kind)}</span>
          <span style={styles.filterCount}>{itemCounts[kind]}</span>
        </button>
      })}
    </div>
    {official.error && <div role="status" style={styles.status}>{tr('官方通知暂时不可用')} <button onClick={() => { void officialNotifications.refresh() }}>{tr('重试')}</button></div>}
    {snapshot.error !== undefined && <div role="alert" style={styles.status}>{snapshot.error}</div>}
    {snapshot.worldError !== undefined && snapshot.worldItems.length === 0 && <div role="status" style={styles.status}>{tr('世界互动暂时无法加载')}</div>}
    {snapshot.aiError !== undefined && snapshot.aiItems.length === 0 && <div role="status" style={styles.status}>{tr('AI 来信暂时无法加载')}</div>}
    {(snapshot.loading || official.loading) && items.length === 0 && <div role="status" style={styles.status}>{tr('正在加载通知…')}</div>}
    <div style={styles.list} role="list">
      {filteredItems.length === 0 && !snapshot.loading && !official.loading
        ? <div style={styles.empty}>{activeKind === 'all' ? tr('暂时没有通知') : `${notificationFilterLabel(activeKind)}${tr('暂时没有通知')}`}<br /><span style={{ fontSize: 12 }}>{activeKind === 'all' ? tr('官方、安排、互动和表态会集中显示在这里') : tr('切换其他类型查看通知')}</span></div>
        : filteredItems.map(item => <button
          key={item.id} type="button" role="listitem" disabled={busyId === item.id}
          style={{ ...styles.item, ...(item.unread ? styles.itemUnread : {}) }}
          aria-label={`${notificationKindLabel(item.kind)}：${item.title}`}
          onClick={() => { void openItem(item) }}
        >
          <span style={styles.icon}><NotificationBell size={18} /></span>
          <span style={styles.content}>
            <span style={styles.top}><strong style={styles.itemTitle}>{item.title}</strong><time style={styles.time}>{dateLabel(item.atMillis)}</time></span>
            <span style={styles.preview}>{notificationKindLabel(item.kind)} · {item.preview}</span>
          </span>
          {item.unread && <span aria-label={tr('未读')} style={{ width: 7, height: 7, flex: 'none', marginTop: 7, borderRadius: 999, background: '#ff5f57' }} />}
        </button>)}
      {(activeKind === 'official' || activeKind === 'all') && official.nextCursor && <button disabled={official.loading} onClick={() => { void officialNotifications.more() }}>{tr('加载更多官方通知')}</button>}
    </div>
    </>}
  </section>
}
