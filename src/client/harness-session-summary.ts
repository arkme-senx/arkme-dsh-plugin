import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { UseProjection } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { SnapshotSelectorHook, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { createElement, useCallback, useEffect, useId, useState, useSyncExternalStore, type SyntheticEvent } from 'react'
import { DesktopIcon } from '@phosphor-icons/react/dist/csr/Desktop'
import { accountSessionKey, useAccountSessionCatalog } from './harness-account-sessions.js'
import { ArkmeTextTooltip } from './ArkmeTextTooltip.js'
import { isRemoteComputer } from './harness-session-origin.js'
import type {} from './harness-slots-contract.js'

const SLOT = 'conversation.session.header.actions'
const LOCALE = 'arkme.harness.sessionSummary'

// Public slot available in the supported host, without bundling its UI package.
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'arkme.harness.sessionSummary': 'count' | 'remote' | 'otherInstance' | 'historyLoading' | 'historyError' | 'syncPending' | 'syncComplete' | 'syncConflict' | 'syncUnsupported' | 'syncFailed' | 'syncDetails' | 'syncConflictDetails' | 'historyRefreshError' | 'historyRefreshDetails'
  }
}

/** Missing/changed projection schemas must not be presented as zero conversations. */
export function sessionTurnCount(value: unknown): number | undefined {
  if (typeof value !== 'object' || value === null || !('turns' in value)) return
  const turns = value.turns
  return typeof turns === 'number' && Number.isSafeInteger(turns) && turns >= 0 ? turns : undefined
}

export function SessionTurnCount({ useProjection, t }: { useProjection: UseProjection; t: TranslateNS<typeof LOCALE> }) {
  // The projection key is owned by the host's optional session-stats plugin.
  // Read the open runtime contract and validate its value instead of copying its schema/fold.
  const projected = (useProjection as (key: string) => unknown)('sessionStats')
  const turns = sessionTurnCount(projected)
  if (turns === undefined) return null
  return createElement('span', { 'data-arkme-session-turn-count': '', 'data-turns': turns }, t('count', { count: turns }))
}

export function SessionComputerLocation({ surface, sessionId, t }: { surface: Element; sessionId: string; t: TranslateNS<typeof LOCALE> }) {
  const { rows, localDesktopName } = useAccountSessionCatalog(surface)
  const row = rows.find(row => !row.archived && accountSessionKey(row) === sessionId)
  if (!row || row.local || (row.localAvailable ?? row.localTakeover)) return null
  const name = row.desktopName.trim()
  const label = t(isRemoteComputer(row, localDesktopName) ? 'remote' : 'otherInstance')
  return createElement('span', { 'data-arkme-session-computer': '', title: name ? `${label} · ${name}` : label, tabIndex: 0, style: { display: 'inline-flex', alignItems: 'center', gap: 4, marginInlineStart: 8 } },
    createElement(DesktopIcon, { size: 14, 'aria-hidden': true, style: { flexShrink: 0 } }),
    createElement('span', { 'data-arkme-session-remote-label': '' }, label),
    name && ' · ',
    name && createElement('span', { 'data-arkme-session-computer-name': '', title: name }, name))
}

/** Native view readiness and background synchronization are independent. */
export function SessionHistoryStatus({ surface, t, useChat = selector => selector(undefined) }: { surface: Element; t: TranslateNS<typeof LOCALE>; useChat?: SnapshotSelectorHook<unknown> }) {
  const hasNativeHistory = useChat(value => !!value && typeof value === 'object' && 'order' in value && Array.isArray(value.order) && value.order.length > 0)
  const subscribe = useCallback((notify: () => void) => {
    const observer = new MutationObserver(notify)
    observer.observe(surface, { attributes: true, attributeFilter: ['data-arkme-history-state', 'data-arkme-history-sync', 'data-arkme-projected-history-state'] })
    return () => observer.disconnect()
  }, [surface])
  const nativeState = useSyncExternalStore(subscribe, () => surface.getAttribute('data-arkme-history-state'))
  const projectedState = useSyncExternalStore(subscribe, () => surface.getAttribute('data-arkme-projected-history-state'))
  const state = projectedState === 'refresh-error' ? 'error' : projectedState ?? nativeState
  const hasHistory = projectedState ? projectedState === 'open' || projectedState === 'refresh-error' : hasNativeHistory
  const sync = useSyncExternalStore(subscribe, () => surface.getAttribute('data-arkme-history-sync'))
  const [anchor, setAnchor] = useState<HTMLElement | null>(null), hintId = useId()
  const showHint = (event: SyntheticEvent<HTMLElement>) => setAnchor(event.currentTarget)
  const closeHint = useCallback(() => setAnchor(null), [])
  useEffect(closeHint, [state, sync, hasHistory, closeHint])
  if (!hasHistory && (state === 'loading' || state === 'error')) {
    return createElement('span', { 'data-arkme-history-status': state, role: state === 'error' ? 'alert' : 'status', style: { marginInlineStart: 8 } }, t(state === 'error' ? 'historyError' : 'historyLoading'))
  }
  const labels = { pending: 'syncPending', syncing: 'syncPending', conflict: 'syncConflict', unsupported: 'syncUnsupported', failed: 'syncFailed' } as const
  const key = state === 'error' ? 'historyRefreshError' : labels[sync as keyof typeof labels]
  if (!key) return null
  const detail = state === 'error' ? 'historyRefreshDetails' : sync === 'conflict' ? 'syncConflictDetails' : 'syncDetails'
  return createElement('span', { 'data-arkme-history-sync-status': sync, style: { display: 'inline-flex', marginInlineStart: 8 } },
    createElement('button', { type: 'button', 'aria-describedby': anchor ? hintId : undefined,
      onFocus: showHint, onBlur: closeHint, onMouseEnter: showHint, onMouseLeave: closeHint,
      onClick: showHint, style: { border: 0, background: 'transparent', color: 'inherit', font: 'inherit', padding: 0, cursor: 'pointer', whiteSpace: 'nowrap' } }, t(key), ' ⓘ'),
    anchor && createElement(ArkmeTextTooltip, { anchor, id: hintId, text: t(detail), kind: 'history', onClose: closeHint }))
}

/** Add a session-scoped reader; paging, compaction and push updates stay host-owned. */
export function installHarnessSessionSummary(ctx: ClientContext, surface?: Element): () => void {
  if (typeof ctx.locale?.register !== 'function' || typeof ctx.slots.spec !== 'function') return () => {}
  const removeLocale = ctx.locale.register(LOCALE, {
    zh: { count: '{count} 次对话', remote: '非本机', otherInstance: '其他实例', historyLoading: '正在打开对话…', historyError: '历史暂时无法读取，请重新打开会话重试', syncPending: '正在同步', syncComplete: '历史已同步', syncConflict: '云端同步暂停', syncUnsupported: '暂存于本机', syncFailed: '云端暂未同步', syncDetails: '本机历史可以查看。云端同步尚未完成，其他设备可能暂时看不到完整内容。', syncConflictDetails: '本机记录与云端版本尚未核对一致。为保护已有记录，已暂停同步；本机历史仍可查看，其他设备可能显示不完整。', historyRefreshError: '更新暂不可用', historyRefreshDetails: '已显示的历史仍可查看。当前连接未能取得最新内容，恢复连接后会继续更新。' },
    en: { count: '{count} turns', remote: 'Remote', otherInstance: 'Other instance', historyLoading: 'Opening conversation…', historyError: 'History could not be loaded. Reopen this conversation to retry.', syncPending: 'Syncing', syncComplete: 'History synced', syncConflict: 'Cloud sync paused', syncUnsupported: 'Saved locally', syncFailed: 'Not yet synced', syncDetails: 'Local history is available. Other devices may not have the complete conversation until cloud sync finishes.', syncConflictDetails: 'The local and cloud versions could not be verified as equivalent. Sync is paused to protect existing records. Local history remains available.', historyRefreshError: 'Updates unavailable', historyRefreshDetails: 'Displayed history remains available. Updates resume when the connection recovers.' },
  })
  const removeSlot = ctx.slots.inject(SLOT, () => {
    const spec = ctx.slots.spec(SLOT)
    if (spec?.kind !== 'list' || spec.scope !== 'session') return () => {}
    const removeCount = ctx.slots.register({ name: SLOT, id: 'arkme-session-turn-count', order: 0, locale: LOCALE }, SessionTurnCount)
    const removeComputer = surface && ctx.slots.register({ name: SLOT, id: 'arkme-session-computer', order: 1, locale: LOCALE },
      props => createElement(SessionComputerLocation, { surface, sessionId: props.sessionId, t: props.t }))
    const removeHistory = surface && ctx.slots.register({ name: SLOT, id: 'arkme-session-history-status', order: 2, locale: LOCALE },
      props => createElement(SessionHistoryStatus, { surface, t: props.t, useChat: props.useChat }))
    return () => { removeHistory?.(); removeComputer?.(); removeCount() }
  })
  return () => { removeSlot(); removeLocale() }
}
