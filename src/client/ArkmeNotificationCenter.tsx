import { recordingNotifications, useRecordingNotifications } from './recording-notification-store.js'
import { recordingNoticeTitle, recordingNoticePreview } from './ArkmeRecordingNotificationDetail.js'
import type { RecordingWorkflowNotice } from '../recording-workflow-contract.js'
import { arkmeEmojiTokenSafePrefix } from '../arkme-emoji-text.js'
import { ArkmeNotificationMessage } from './ArkmeNotificationMessage.js'
import { useNotificationScroll, useNotificationVisibleRead } from './use-notification-viewport.js'
import { CONVERSATION_SELECTOR_CSS } from './conversation-selector-style.js'
import conversationCss from './notification-conversation.css?inline'
import { readWorldNotifications, type WorldNotificationInteraction } from './world-notification-reader.js'
import { officialNotifications, useOfficialNotifications } from './official-notification-store.js'
import type { OfficialNotificationSnapshot } from './official-notification-store.js'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type {
  ArkmeArrangementReminderEvent,
  ArkmeArrangementReminderPage,
  ArkmeAiLetterItem,
  ArkmeAiLetterPage,
  ArkmeAiLetterUnread,
  ArkmeWorldInteractionSummary,
} from '../types.js'
import type { ReactionNotification } from '../reaction-contract.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeChatDirectory } from './chat-directory-store.js'
import { arkmeUi } from './ui-controller.js'
import { reactionNotifications } from './reaction-notifications.js'
import { expressionLabel } from './reaction-expression.js'
import { tr, arkmeIntlLocale } from './locale.js'

export type ArkmeNotificationKind = 'official' | 'arrangement' | 'reaction' | 'world' | 'ai' | 'recording'

export interface ArkmeNotificationItem {
  id: string
  kind: ArkmeNotificationKind
  title: string
  preview: string
  sourceLabel?: string
  atMillis: number
  unread: boolean
  arrangement?: ArkmeArrangementReminderEvent
  reaction?: ReactionNotification
  recording?: RecordingWorkflowNotice
  aiLetter?: ArkmeAiLetterItem
  worldInteractionRef?: string
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
  return normalized.length <= limit ? normalized : `${arkmeEmojiTokenSafePrefix(normalized, limit, 'codeUnits').trimEnd()}…`
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
  const preview = event.description || event.title || tr('安排提醒')
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

export function reactionItem(item: ReactionNotification): ArkmeNotificationItem {
  const selected = item.selections.at(-1)?.expression
  const expression = selected ? expressionLabel(selected) || tr('表态') : tr('表态')
  const source = item.source
  const sourceLabel = source && (source.kind === 'private_chat' || source.kind === 'group_chat')
    ? `${tr(source.kind === 'group_chat' ? '群聊' : '私聊')} · ${source.displayName}` : tr('会话暂不可用')
  return {
    id: `reaction:${item.id}:${item.revision}`,
    kind: 'reaction',
    title: `${item.actorName ? tr('收到{name}的表态', { name: item.actorName }) : tr('收到表态')} · ${expression}`,
    sourceLabel,
    preview: item.text || tr('点击查看原消息'),
    atMillis: item.selections.at(-1)?.at || item.sendAtMillis,
    unread: item.unread !== false,
    reaction: item,
  }
}

function worldItem(item: WorldNotificationInteraction): ArkmeNotificationItem {
  return {
    id: `world:${item.interactionRef}`, kind: 'world',
    title: tr(item.replyToComment ? '{name} 回复了你的评论' : '{name} 回复了你的世界', { name: item.authorName || tr('有人') }),
    preview: item.textContent || tr('查看世界互动'),
    atMillis: item.publishedAtMillis || item.createdAtMillis,
    unread: false, worldInteractionRef: item.interactionRef,
  }
}

function aiLetterItem(item: ArkmeAiLetterItem): ArkmeNotificationItem {
  return {
    id: `ai:${item.letterId}`,
    kind: 'ai',
    title: item.title || tr('AI 来信'),
    preview: item.summary || tr('查看 AI 来信'),
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
      const [arrangementsResult, worldSummaryResult, worldNotificationsResult, aiUnreadResult, aiListResult] = await Promise.allSettled([
        callArkme<ArkmeArrangementReminderPage>('arrangements.reminders.list', {
          unreadOnly: false, limit: 50, offset: 0,
        }, controller.signal, { priority: 'background' }),
        callArkme<ArkmeWorldInteractionSummary>('world.interactions.summary', undefined, controller.signal, { priority: 'background' }),
        readWorldNotifications(controller.signal),
        callArkme<ArkmeAiLetterUnread>('ai-letter.unread', undefined, controller.signal, { priority: 'background' }),
        callArkme<ArkmeAiLetterPage>('ai-letter.list', { periodType: 0, cursorStartAt: 0, limit: 20 }, controller.signal, { priority: 'background' }),
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

      const worldItems = worldNotificationsResult.status === 'fulfilled'
        ? worldNotificationsResult.value.map(worldItem) : this.snapshot.worldItems
      if (worldNotificationsResult.status === 'rejected') {
        worldError ??= worldNotificationsResult.reason instanceof Error ? worldNotificationsResult.reason.message : tr('世界互动暂时无法加载')
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

  async markArrangementRead(eventRef: string, scope = this.snapshot.scope, signal?: AbortSignal): Promise<void> {
    const normalized = eventRef.trim()
    if (normalized === '' || !scope || accountScope() !== scope) return
    await callArkme('arrangements.reminders.mark-read', { eventRefs: [normalized] }, signal)
    if (signal?.aborted || accountScope() !== scope || this.snapshot.scope !== scope) return
    const items = this.snapshot.arrangementItems.map(item => item.eventRef === normalized ? { ...item, read: true } : item)
    this.publish({ ...this.snapshot, arrangementItems: items })
  }

  async markAllArrangementRead(): Promise<void> {
    await callArkme('arrangements.reminders.mark-all-read', undefined)
    this.publish({ ...this.snapshot, arrangementItems: this.snapshot.arrangementItems.map(item => ({ ...item, read: true })) })
  }

  async markWorldViewed(sequence = this.snapshot.worldSeenThroughSequence, scope = this.snapshot.scope, signal?: AbortSignal): Promise<void> {
    if (sequence <= 0 || !scope || accountScope() !== scope) return
    const result = await callArkme<ArkmeWorldInteractionSummary>('world.interactions.mark-viewed', {
      seenThroughSequence: sequence,
    }, signal)
    if (signal?.aborted || accountScope() !== scope || this.snapshot.scope !== scope) return
    this.publish({
      ...this.snapshot,
      worldUnreadCount: Math.max(0, Math.trunc(result.unreadCount)),
      worldSeenThroughSequence: Math.max(sequence, Math.trunc(result.seenThroughSequence)),
      worldItems: this.snapshot.worldItems.map(item => ({ ...item, unread: false })),
    })
  }

  async markAiRead(letterIds: readonly string[], scope = this.snapshot.scope, signal?: AbortSignal): Promise<void> {
    const ids = [...new Set(letterIds.map(value => value.trim()).filter(value => value !== ''))]
    if (ids.length === 0 || !scope || accountScope() !== scope) return
    const result = await callArkme<ArkmeAiLetterUnread>('ai-letter.mark-read', { letterIds: ids.slice(0, 50) }, signal)
    if (signal?.aborted || accountScope() !== scope || this.snapshot.scope !== scope) return
    this.publish({
      ...this.snapshot,
      aiUnreadCount: Math.max(0, Math.trunc(result.unreadCount)),
      aiItems: this.snapshot.aiItems.map(item => item.aiLetter && ids.includes(item.aiLetter.letterId) ? { ...item, unread: false, aiLetter: { ...item.aiLetter, unread: false } } : item),
    })
  }
}

export const arkmeNotificationStore = new ArkmeNotificationStore()

function useNotificationItems(): {
  scope: string | undefined
  snapshot: NotificationSnapshot
  official: OfficialNotificationSnapshot
  recording: ReturnType<typeof useRecordingNotifications>
  reactionItems: ReactionNotification[]
  items: ArkmeNotificationItem[]
} {
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot).auth
  const scope = auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : undefined
  const official = useOfficialNotifications(scope)
  const recording = useRecordingNotifications(scope)
  const storedSnapshot = useSyncExternalStore(arkmeNotificationStore.subscribe, arkmeNotificationStore.getSnapshot, arkmeNotificationStore.getSnapshot)
  const snapshot = storedSnapshot.scope === scope ? storedSnapshot : EMPTY_SNAPSHOT
  const reactionRevision = useSyncExternalStore(reactionNotifications.subscribe, reactionNotifications.getSnapshot, reactionNotifications.getSnapshot)
  useEffect(() => {
    const release = scope === undefined ? undefined : reactionNotifications.acquireHistory(scope)
    void arkmeNotificationStore.refresh(scope)
    const refreshOnFocus = () => { void arkmeNotificationStore.refresh(scope); void reactionNotifications.refreshHistory() }
    window.addEventListener('focus', refreshOnFocus)
    return () => { release?.(); window.removeEventListener('focus', refreshOnFocus) }
  }, [scope])
  const reactionItems = useMemo(() => scope === undefined ? [] : reactionNotifications.forHistory(scope), [reactionRevision, scope])
  const items = useMemo(() => [
    ...official.items.map(item => ({ id: `official:${item.id}`, kind: 'official' as const, title: item.title, preview: item.summary, atMillis: item.publishedAtMillis, unread: item.readAtMillis === 0 })),
    ...recording.items.map(item => ({ id: `recording:${item.id}`, kind: 'recording' as const, title: recordingNoticeTitle(item), preview: recordingNoticePreview(item), atMillis: item.atMillis, unread: item.readAtMillis === 0, recording: item })),
    ...snapshot.arrangementItems.map(arrangementItem),
    ...snapshot.worldItems,
    ...snapshot.aiItems,
    ...reactionItems.map(reactionItem),
  ].sort((left, right) => right.atMillis - left.atMillis), [official.items, recording.items, reactionItems, snapshot.aiItems, snapshot.arrangementItems, snapshot.worldItems])
  return { scope, snapshot, official, recording, reactionItems, items }
}

export function useArkmeNotificationSummary(): { ready: boolean; hasNotifications: boolean; unreadCount: number; preview: string; atMillis: number } {
  const { items, snapshot, official, recording } = useNotificationItems()
  const unread = items.filter(item => item.kind !== 'official' && item.kind !== 'recording' && item.unread)
  const officialLatest = official.summary.latest
  let latest = officialLatest !== undefined && officialLatest.publishedAtMillis > (items[0]?.atMillis ?? 0) ? { title: officialLatest.title, preview: officialLatest.summary, atMillis: officialLatest.publishedAtMillis } : items[0]
  if (recording.latest && recording.latest.atMillis > (latest?.atMillis ?? 0)) latest = { title: recordingNoticeTitle(recording.latest), preview: recordingNoticePreview(recording.latest), atMillis: recording.latest.atMillis }
  return {
    ready: snapshot.scope !== undefined && (snapshot.ready || official.ready || recording.ready),
    hasNotifications: recording.total > 0 || official.summary.total > 0 || items.length > 0 || snapshot.worldUnreadCount > 0 || snapshot.aiUnreadCount > 0,
    unreadCount: recording.unreadCount + official.summary.unreadCount + unread.length + snapshot.worldUnreadCount + snapshot.aiUnreadCount,
    preview: latest === undefined ? tr('官方、安排和互动通知') : `${latest.title}：${compactText(latest.preview)}`,
    atMillis: latest?.atMillis ?? 0,
  }
}

function notificationKindLabel(kind: ArkmeNotificationKind): string {
  switch (kind) {
    case 'recording': return tr('录音')
    case 'official': return tr('官方')
    case 'arrangement': return tr('安排')
    case 'reaction': return tr('表态')
    case 'world': return tr('世界')
    case 'ai': return tr('AI 来信')
  }
}

const notificationFilterKinds: readonly (ArkmeNotificationKind | 'all')[] = [
  'all', 'official', 'arrangement', 'reaction', 'world', 'ai', 'recording',
]

function notificationFilterLabel(kind: ArkmeNotificationKind | 'all'): string {
  return kind === 'all' ? tr('全部') : notificationKindLabel(kind)
}

export function ArkmeNotificationCenter({ preview = false, headerAction }: { preview?: boolean; headerAction?: ReactNode } = {}) {
  const data = useNotificationItems()
  return <NotificationConversation key={`${data.scope ?? 'signed-out'}:${preview}`} data={data} preview={preview} headerAction={headerAction} />
}

function NotificationConversation({ data, preview, headerAction }: { data: ReturnType<typeof useNotificationItems>; preview: boolean; headerAction?: ReactNode }) {
  const { scope, snapshot, official, recording, items } = data
  const [actionError, setActionError] = useState('')
  const [busyId, setBusyId] = useState<string>()
  const [activeKind, setActiveKind] = useState<ArkmeNotificationKind | 'all'>('all')
  const [filterOpen, setFilterOpen] = useState(false)
  const filterRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const receipts = useRef(new Set<string>())
  const pending = useRef(new Set<string>())
  const filteredItems = useMemo(() => items.filter(item => activeKind === 'all' || item.kind === activeKind)
    .sort((a, b) => a.atMillis - b.atMillis || a.id.localeCompare(b.id)), [items, activeKind])
  const viewKey = `${scope}:${activeKind}`
  const scroll = useNotificationScroll(listRef, filteredItems, viewKey)
  const filterLoading = activeKind === 'recording' ? recording.loading && !recording.ready
    : activeKind === 'official' ? official.loading && !official.ready : snapshot.loading || official.loading || (recording.loading && !recording.ready)

  useEffect(() => {
    if (!filterOpen) return
    const close = (event: PointerEvent) => { if (event.target instanceof Node && !filterRef.current?.contains(event.target)) setFilterOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setFilterOpen(false); triggerRef.current?.focus() } }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    filterRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape) }
  }, [filterOpen])

  const acknowledge = useCallback(async (visible: readonly ArkmeNotificationItem[], signal: AbortSignal) => {
    if (!scope || signal.aborted || accountScope() !== scope) return
    const jobs: Promise<void>[] = []
    const submit = (keys: string[], operation: () => Promise<unknown>) => {
      if (!keys.length || keys.some(key => pending.current.has(key)) || keys.every(key => receipts.current.has(key))) return
      keys.forEach(key => pending.current.add(key))
      jobs.push((async () => {
        try {
          await operation()
          if (!signal.aborted && accountScope() === scope) keys.forEach(key => receipts.current.add(key))
        } catch { /* Retry visible receipts on the next foreground pass. */ }
        finally { keys.forEach(key => pending.current.delete(key)) }
      })())
    }
    const recordingRows = visible.flatMap(item => item.unread && item.recording ? [item.recording] : [])
    submit(recordingRows.map(item => `recording:${item.id}:${item.sequence}`), () => recordingNotifications.read(scope, recordingRows))
    const officialRows = visible.filter(item => item.kind === 'official' && item.unread)
    submit(officialRows.map(item => item.id), () => officialNotifications.read(scope, officialRows.map(item => item.id.slice('official:'.length))))
    for (const item of visible) {
      if (item.arrangement && item.unread) submit([item.id], () => arkmeNotificationStore.markArrangementRead(item.arrangement!.eventRef, scope, signal))
      if (item.aiLetter?.unread) submit([item.id], () => arkmeNotificationStore.markAiRead([item.aiLetter!.letterId], scope, signal))
    }
    const reactions = visible.flatMap(item => item.reaction && item.unread ? [item.reaction] : [])
    for (let offset = 0; offset < reactions.length; offset += 50) {
      const batch = reactions.slice(offset, offset + 50)
      submit(batch.map(item => `reaction:${item.id}:${item.revision}`), async () => {
        await reactionNotifications.seen(scope, batch)
        if (reactionNotifications.forHistory(scope).some(row => row.unread !== false && batch.some(item => item.id === row.id && item.revision === row.revision))) throw new Error('Receipt pending')
      })
    }
    // World exposes a conversation-level watermark, not per-message receipts.
    // Only viewing its newest loaded message may advance that captured server cursor.
    const newestWorld = snapshot.worldItems[0]
    if (!snapshot.loading && !snapshot.worldError && snapshot.worldUnreadCount > 0 && newestWorld && visible.some(item => item.id === newestWorld.id)) {
      const sequence = snapshot.worldSeenThroughSequence
      submit([`world:${sequence}`], () => arkmeNotificationStore.markWorldViewed(sequence, scope, signal))
    }
    await Promise.all(jobs)
  }, [scope, snapshot.loading, snapshot.worldError, snapshot.worldUnreadCount, snapshot.worldItems, snapshot.worldSeenThroughSequence])
  useNotificationVisibleRead(listRef, filteredItems, !!scope && !filterOpen && !preview, acknowledge, viewKey)

  const openItem = useCallback(async (item: ArkmeNotificationItem) => {
    if (preview || accountScope() !== scope) return
    setBusyId(item.id); setActionError('')
    try {
      if (item.kind === 'world' && item.worldInteractionRef) arkmeUi.showWorldInteraction(item.worldInteractionRef)
      else if (item.reaction && scope) {
        const reaction = item.reaction
        const source = arkmeChatDirectory.getSnapshot().sources.find(candidate => candidate.sourceKey === reaction.sourceKey) ?? reaction.source
        if (!source) throw new Error('Missing source')
        const page = await callArkme<import('../types.js').ArkmeTimelineAroundPage>('source.timeline-around', {
          sourceRef: source.sourceRef, itemUid: reaction.itemUid, recordOwnerUserId: reaction.recordOwnerUserId, beforeLimit: 1, afterLimit: 1,
        })
        if (accountScope() !== scope) return
        if (!page.items.some(message => message.itemUid === reaction.itemUid)) throw new Error('Missing message')
        arkmeUi.showConversationTarget(source, reaction.itemUid, reaction.sendAtMillis, reaction.recordOwnerUserId, undefined, true)
      }
    } catch (error) {
      if (accountScope() === scope) setActionError(item.kind === 'reaction' ? tr('暂时无法打开对应消息，请稍后重试') : error instanceof Error ? error.message : tr('通知操作失败，请重试'))
    } finally { if (accountScope() === scope) setBusyId(undefined) }
  }, [scope, preview])

  return <section className="arkme-notification-conversation" aria-label={tr('通知')}>
    <style>{CONVERSATION_SELECTOR_CSS}{conversationCss}</style>
    <header className="arkme-notification-header">
      <h2>{tr('通知')}{preview && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 400, opacity: .6 }}>{tr('预览中')}</span>}</h2>
      <div className="arkme-notification-filter" ref={filterRef}>
        <button ref={triggerRef} type="button" data-arkme-conversation-selector="" aria-label={tr('通知类型')} aria-haspopup="menu" aria-expanded={filterOpen} onClick={() => setFilterOpen(value => !value)}>
          <span>{notificationFilterLabel(activeKind)}</span><span aria-hidden><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
        </button>
        {filterOpen && <div role="menu" aria-label={tr('通知类型')} className="arkme-notification-filter-menu" onKeyDown={event => {
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))
          const current = options.indexOf(document.activeElement as HTMLButtonElement)
          const index = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
          options[index]?.focus()
        }}>
          {notificationFilterKinds.map(kind => <button type="button" role="menuitemradio" aria-checked={activeKind === kind} key={kind} onClick={() => { setActiveKind(kind); setFilterOpen(false); triggerRef.current?.focus() }}>
            <span>{notificationFilterLabel(kind)}</span><span aria-hidden>{activeKind === kind ? '✓' : ''}</span>
          </button>)}
        </div>}
      </div>
      {headerAction}
    </header>
    {actionError && <div role="alert" className="arkme-notification-status">{actionError}</div>}
    {recording.error && (activeKind === 'all' || activeKind === 'recording') && <div role="status" className="arkme-notification-status">{tr('录音通知暂时不可用')} <button onClick={() => { void recordingNotifications.refresh() }}>{tr('重试录音通知')}</button></div>}
    {reactionNotifications.historyError && (activeKind === 'all' || activeKind === 'reaction') && <div role="status" className="arkme-notification-status">{tr(reactionNotifications.historyError)} <button onClick={() => { void reactionNotifications.refreshHistory() }}>{tr('重试')}</button></div>}
    {official.error && (activeKind === 'all' || activeKind === 'official') && <div role="status" className="arkme-notification-status">{tr('官方通知暂时不可用')} <button onClick={() => { void officialNotifications.refresh() }}>{tr('重试')}</button></div>}
    {snapshot.error && (activeKind === 'all' || activeKind === 'arrangement') && <div role="alert" className="arkme-notification-status">{snapshot.error}</div>}
    {snapshot.worldError && (activeKind === 'all' || activeKind === 'world') && <div role="status" className="arkme-notification-status">{tr('世界互动暂时无法加载')}</div>}
    {snapshot.aiError && (activeKind === 'all' || activeKind === 'ai') && <div role="status" className="arkme-notification-status">{tr('AI 来信暂时无法加载')}</div>}
    {filterLoading && filteredItems.length === 0 && <div role="status" className="arkme-notification-status">{tr('正在加载通知…')}</div>}
    <div className="arkme-notification-body">
      <div ref={listRef} className="arkme-notification-scroll" onScroll={scroll.onScroll}>
        <div className="arkme-notification-messages">
          <div className="arkme-notification-history">
            {(activeKind === 'recording' || activeKind === 'all') && recording.nextCursor && <button type="button" className="arkme-notification-link" disabled={recording.loading} onClick={() => { void recordingNotifications.refresh(true) }}>{tr('加载更多录音通知')}</button>}
            {(activeKind === 'official' || activeKind === 'all') && official.nextCursor && <button type="button" className="arkme-notification-link" disabled={official.foregroundLoading} onClick={() => { void officialNotifications.more() }}>{tr('加载更多官方通知')}</button>}
          </div>
          <div role="list" aria-label={tr('通知消息')}>
            {filteredItems.length === 0 && !filterLoading && <div className="arkme-notification-empty">{activeKind === 'all' ? tr('暂时没有通知') : `${notificationFilterLabel(activeKind)}${tr('暂时没有通知')}`}<br />{tr('新的通知会显示在这里')}</div>}
            {scope && filteredItems.map((item, index) => <ArkmeNotificationMessage key={item.id} item={item} scope={scope} category={notificationKindLabel(item.kind)}
              timeLabel={index === 0 || item.atMillis - filteredItems[index - 1]!.atMillis >= 5 * 60_000 || new Date(item.atMillis).toDateString() !== new Date(filteredItems[index - 1]!.atMillis).toDateString() ? dateLabel(item.atMillis) : ''}
              readOnly={preview} busy={busyId === item.id} onOpen={item => { void openItem(item) }} />)}
          </div>
        </div>
      </div>
      {scroll.newMessages > 0 && <button className="arkme-notification-latest" type="button" onClick={scroll.toLatest}>{tr('新消息')} ↓</button>}
    </div>
  </section>
}
