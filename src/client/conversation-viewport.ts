import { recordOwnerId } from '../record-owner-id.js'
import type { ArkmeUnifiedTimelineWindow } from '../unified-chat-timeline.js'
import { cachedConversationUnreadCoverage } from './conversation-unread.js'
import { cancelConversationFollow, conversationWindowActive, followConversationBottom, isConversationFollowing } from './conversation-bottom-follow.js'
import { useCallback, useLayoutEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react'
import {
  arkmeConversationRestoredScrollTop,
  type ArkmeConversationViewportSnapshot,
} from './conversation-memory-cache.js'

/** Viewport persistence only; message data and server cursors stay with their owners. */
export interface ArkmeConversationViewportStore {
  getViewport(sourceKey: string): ArkmeConversationViewportSnapshot | undefined
  storeViewport(sourceKey: string, viewport: ArkmeConversationViewportSnapshot): void
}

export interface ArkmeConversationViewportRestore {
  sourceKey: string
  viewport: ArkmeConversationViewportSnapshot | undefined
  /** Capture before replacing rows; latest-edge alignment belongs to the same paint. */
  followLatest?: boolean | undefined
}

const readingAnchors = new WeakMap<HTMLDivElement, HTMLElement>()

export function arkmeConversationViewport(root: HTMLDivElement, mode: 'auto' | 'messages' | 'history' | 'latest-anchor' = 'auto'): ArkmeConversationViewportSnapshot {
  const stickToBottom = (mode === 'auto' || mode === 'latest-anchor') && conversationWindowActive(root)
    && (isConversationFollowing(root) || root.scrollHeight - root.scrollTop - root.clientHeight <= 80)
  if (stickToBottom && mode !== 'latest-anchor') return { scrollTop: root.scrollTop, stickToBottom: true }
  const rootRect = root.getBoundingClientRect()
  const snapshot = (row: HTMLElement): ArkmeConversationViewportSnapshot | undefined => {
    if (mode === 'messages' && !row.dataset.arkmeConversationRow?.startsWith('message:')) return undefined
    const rowRect = row.getBoundingClientRect()
    if (rowRect.bottom <= rootRect.top || rowRect.top >= rootRect.bottom) return undefined
    const anchorId = row.dataset.arkmeConversationRow
    if (anchorId !== undefined) {
      readingAnchors.set(root, row)
      let messageAnchor: ArkmeConversationViewportSnapshot['messageAnchor']
      if (anchorId.startsWith('message:') && row.dataset.arkmeMessageItemUid) {
        const owner = recordOwnerId(row.dataset.arkmeMessageOwnerId)
        if (owner) messageAnchor = { itemUid: row.dataset.arkmeMessageItemUid, recordOwnerUserId: owner }
      }
      return {
        scrollTop: root.scrollTop,
        stickToBottom,
        anchorId,
        anchorOffset: rowRect.top - rootRect.top,
        ...(messageAnchor ? { messageAnchor } : {}),
        ...(row.dataset.offlineContextRef ? { contextRef: row.dataset.offlineContextRef }
          : row.dataset.arkmeSystemAnchorRef ? { systemRef: row.dataset.arkmeSystemAnchorRef } : {}),
      }
    }
  }
  // Any surviving visible row is a stable reading anchor. Reuse it through
  // small scrolls instead of walking every earlier mounted row on each event.
  const previous = readingAnchors.get(root)
  if (previous && root.contains?.(previous)) {
    const value = snapshot(previous)
    if (value) return value
  }
  for (const row of root.querySelectorAll<HTMLElement>('[data-arkme-conversation-row]')) {
    if (row === previous) continue
    const value = snapshot(row)
    if (value) return value
  }
  readingAnchors.delete(root)
  return { scrollTop: root.scrollTop, stickToBottom }
}

/** Read actual message/interaction rows only when opening a calendar; never count system notices. */
export function arkmeConversationReadingDate(root: HTMLDivElement | null, rows: readonly {
  id: string; kind: string; occurredAtMillis: number
}[]): string | undefined {
  if (root === null || root.clientHeight <= 0) return undefined
  const messages = rows.filter(row => row.kind === 'message' || row.kind === 'moment')
  // Use the actual bottom, not the wider auto-follow threshold: nearby history must retain its date.
  const atBottom = root.scrollHeight - root.scrollTop - root.clientHeight <= 2
  const rect = root.getBoundingClientRect()
  const ids = new Set(messages.map(row => row.id))
  const visible = [...root.querySelectorAll<HTMLElement>('[data-arkme-conversation-row]')].find(row => {
    const bounds = row.getBoundingClientRect()
    return ids.has(row.dataset.arkmeConversationRow ?? '') && bounds.bottom > rect.top && bounds.top < rect.bottom
  })
  const anchorId = atBottom ? messages.at(-1)?.id : visible?.dataset.arkmeConversationRow
  const timestamp = messages.find(row => row.id === anchorId)?.occurredAtMillis
  if (timestamp === undefined || !Number.isFinite(timestamp) || timestamp <= 0) return undefined
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return undefined
  return [String(date.getFullYear()).padStart(4, '0'), String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')].join('-')
}

export function arkmeConversationTargetScrollTop(root: HTMLDivElement, row: HTMLElement, align: 'start' | 'center'): number {
  const rootRect = root.getBoundingClientRect()
  const rowRect = row.getBoundingClientRect()
  const rowHeight = rowRect.height || rowRect.bottom - rowRect.top
  const offset = align === 'start' ? 0 : (root.clientHeight - rowHeight) / 2
  const top = root.scrollTop + rowRect.top - rootRect.top - offset
  return Math.max(0, Math.min(Math.max(0, root.scrollHeight - root.clientHeight), top))
}

/** Resolve the same explicit target for both virtual mounting and DOM locating. */
export function arkmeConversationTargetAnchor(rows: readonly { id: string; kind: string; item?: object; entryRef?: string }[], target: { itemUid: string; contextRef?: string; systemRef?: string }): string | undefined {
  if (target.systemRef) return rows.find(row => row.id === target.itemUid)?.id
  if (target.contextRef) return rows.find(row => row.kind === 'offline-context' && row.entryRef === target.contextRef)?.id
  return rows.find(row => row.kind === 'message' && row.item && 'itemUid' in row.item && row.item.itemUid === target.itemUid)?.id
}

export function arkmeConversationTargetRow(root: HTMLDivElement | null, target: { itemUid: string; momentId?: string; contextRef?: string; systemRef?: string }): HTMLElement | undefined {
  if (!root) return undefined
  if (target.systemRef) return [...root.querySelectorAll<HTMLElement>('[data-arkme-conversation-row]')].find(row => row.dataset.arkmeConversationRow === target.itemUid)
  if (target.contextRef) return [...root.querySelectorAll<HTMLElement>('[data-offline-context-ref]')]
    .find(row => row.dataset.offlineContextRef === target.contextRef)
  if (!target.momentId) return [...root.querySelectorAll<HTMLElement>('[data-arkme-message-item-uid]')]
    .find(row => row.dataset.arkmeMessageItemUid === target.itemUid)
  const id = `moment:${target.momentId}`
  return [...root.querySelectorAll<HTMLElement>('[data-arkme-conversation-row]')]
    .find(row => row.dataset.arkmeConversationRow === id)
}

export function arkmeConversationAnchorOffset(root: HTMLDivElement, anchorId: string | undefined): number | undefined {
  if (anchorId === undefined) return undefined
  const rootTop = root.getBoundingClientRect().top
  for (const row of root.querySelectorAll<HTMLElement>('[data-arkme-conversation-row]')) {
    if (row.dataset.arkmeConversationRow === anchorId) return row.getBoundingClientRect().top - rootTop
  }
  return undefined
}

/** Bind the shared scrollport to its committed conversation, never to an outgoing cleanup. */
export function useConversationViewport({ active, sourceKey, renderedSourceKey, bodyRef, store, pendingRestore, restoreIntent, readState, navigationRevision }: {
  active: boolean
  sourceKey: string
  renderedSourceKey: string
  bodyRef: RefObject<HTMLDivElement>
  store: ArkmeConversationViewportStore
  pendingRestore: MutableRefObject<ArkmeConversationViewportRestore | undefined>
  restoreIntent?: MutableRefObject<boolean | undefined>
  readState?: { through: number; latestSequence: number; window: ArkmeUnifiedTimelineWindow | undefined } | undefined
  navigationRevision?: number | undefined
}) {
  const ready = active && sourceKey !== '' && sourceKey === renderedSourceKey
  const currentRead = useRef(readState)
  currentRead.current = readState
  const [unreadAnchorId, setUnreadAnchorId] = useState<string>()
  const suspended = useRef<{ sourceKey: string; followLatest: boolean; pending: ArkmeConversationViewportRestore;
    tailId?: string | undefined; through?: number | undefined;
    checkedWindow?: ArkmeUnifiedTimelineWindow | undefined;
    coverage?: ReturnType<typeof cachedConversationUnreadCoverage>;
    attempted?: boolean; frontier?: number | undefined; mountAnchor?: string; mountPending?: boolean }>()
  const cancelResume = useCallback(() => {
    suspended.current = undefined
    setUnreadAnchorId(undefined)
  }, [])
  const resume = useCallback(() => {
    const saved = suspended.current, node = bodyRef.current
    if (!ready || !saved || saved.sourceKey !== sourceKey || !node || node.clientHeight <= 0 || !conversationWindowActive(node)) return false
    const pending = pendingRestore.current
    // A search/unread/calendar navigation made while inactive still wins.
    if (!saved.followLatest || pending && pending !== saved.pending
      && (pending.sourceKey !== sourceKey || pending.followLatest === undefined)) { cancelResume(); return false }
    const state = currentRead.current
    if (saved.attempted && pending === undefined && saved.checkedWindow === state?.window
      && saved.frontier === state?.latestSequence && !saved.mountPending) return true
    saved.attempted = true
    saved.frontier = state?.latestSequence
    saved.mountPending = false
    pendingRestore.current = undefined
    const rows = [...node.querySelectorAll<HTMLElement>('[data-arkme-conversation-row]')]
    const maximum = Math.max(0, node.scrollHeight - node.clientHeight)
    let start: number | undefined
    if (saved.through !== undefined && state) {
      if (saved.checkedWindow !== state.window) {
        saved.checkedWindow = state.window
        saved.coverage = cachedConversationUnreadCoverage(state.window, saved.through)
      }
      const first = saved.coverage?.firstUnread
      if (first) {
        const event = state.window?.events.find(event => event.kind === 'message' && event.item === first)
        const anchorId = event ? `message:${event.eventId}` : undefined
        const row = rows.find(row => row.dataset.arkmeConversationRow === anchorId)
        if (row) start = node.scrollTop + row.getBoundingClientRect().top - node.getBoundingClientRect().top
        // Mount the cached target through the existing virtual list, without fetching.
        else if (anchorId && saved.mountAnchor !== anchorId) {
          saved.mountAnchor = anchorId
          saved.mountPending = true
          setUnreadAnchorId(anchorId)
        }
      } else if (saved.coverage && saved.coverage.counts.length > 0
        && saved.through + saved.coverage.counts.length >= state.latestSequence) start = maximum
    } else {
      const tail = saved.tailId === undefined ? undefined : rows.find(row => row.dataset.arkmeConversationRow === saved.tailId)
      if (tail && tail !== rows.at(-1)) start = node.scrollTop + tail.getBoundingClientRect().bottom - node.getBoundingClientRect().top
    }
    cancelConversationFollow(node)
    if (start === undefined) {
      // Missing cache coverage is not permission to skip unread messages.
      const anchorOffset = arkmeConversationAnchorOffset(node, saved.pending.viewport?.anchorId)
      node.scrollTop = arkmeConversationRestoredScrollTop(saved.pending.viewport, {
        currentScrollTop: node.scrollTop, scrollHeight: node.scrollHeight,
        ...(anchorOffset === undefined ? {} : { anchorOffset }),
      })
      store.storeViewport(sourceKey, arkmeConversationViewport(node, 'history'))
      if (restoreIntent) restoreIntent.current = false
      return true
    }
    const top = Math.max(0, Math.min(maximum, start))
    cancelResume()
    if (top >= maximum - 1) followConversationBottom(node, false, 'instant')
    else node.scrollTop = top
    store.storeViewport(sourceKey, arkmeConversationViewport(node))
    if (restoreIntent) restoreIntent.current = top >= maximum - 1
    return true
  }, [ready, sourceKey, bodyRef, store, pendingRestore, restoreIntent, cancelResume])
  useLayoutEffect(() => {
    if (!ready) return
    const cached = store.getViewport(sourceKey)
    // An explicit navigation/paging request takes precedence over remembered reading.
    if (cached !== undefined && pendingRestore.current?.sourceKey !== sourceKey) {
      pendingRestore.current = { sourceKey, viewport: cached }
    }
    // Do not read DOM in cleanup: host mutations have already installed the next
    // conversation. Valid scroll events and completed restores own persistence.
  }, [ready, sourceKey, store, pendingRestore])

  useLayoutEffect(() => {
    const node = bodyRef.current
    if (!ready || !node) return
    const doc = node.ownerDocument, view = doc?.defaultView
    const suspend = () => {
      if (conversationWindowActive(node)) { resume(); return }
      if (node.clientHeight <= 0 || suspended.current?.sourceKey === sourceKey) return
      const followLatest = store.getViewport(sourceKey)?.stickToBottom === true || isConversationFollowing(node)
        || node.scrollHeight - node.scrollTop - node.clientHeight <= 80
      cancelConversationFollow(node)
      const viewport = arkmeConversationViewport(node, 'history')
      store.storeViewport(sourceKey, viewport)
      const pending = { sourceKey, viewport }
      const tail = [...node.querySelectorAll<HTMLElement>('[data-arkme-conversation-row]')].at(-1)
      suspended.current = { sourceKey, followLatest, pending,
        tailId: tail?.dataset.arkmeConversationRow, through: currentRead.current?.through }
      // Keep explicit navigation ahead of a suspended automatic latest update.
      if (!pendingRestore.current || pendingRestore.current.sourceKey === sourceKey && pendingRestore.current.followLatest) {
        pendingRestore.current = pending
      }
      if (restoreIntent) restoreIntent.current = false
    }
    view?.addEventListener('blur', suspend)
    view?.addEventListener('focus', resume)
    doc?.addEventListener('visibilitychange', suspend)
    const onInput = () => { if (conversationWindowActive(node)) cancelResume() }
    const inputEvents = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
    for (const type of inputEvents) node.addEventListener?.(type, onInput, { passive: true })
    return () => {
      cancelConversationFollow(node)
      suspended.current = undefined
      view?.removeEventListener('blur', suspend)
      view?.removeEventListener('focus', resume)
      doc?.removeEventListener('visibilitychange', suspend)
      for (const type of inputEvents) node.removeEventListener?.(type, onInput)
    }
  }, [ready, sourceKey, bodyRef, store, pendingRestore, restoreIntent, resume, cancelResume])

  useLayoutEffect(cancelResume, [sourceKey, store, navigationRevision, cancelResume])

  useLayoutEffect(() => {
    if (resume()) return
    const pending = pendingRestore.current
    const body = bodyRef.current
    if (!ready || body === null || body.clientHeight <= 0 || pending?.sourceKey !== sourceKey) return
    if (suspended.current && pending !== suspended.current.pending && pending.followLatest === undefined) {
      suspended.current.followLatest = false
    }
    const anchorOffset = arkmeConversationAnchorOffset(body, pending.viewport?.anchorId)
    const maximumScrollTop = Math.max(0, body.scrollHeight - body.clientHeight)
    if (pending.followLatest && pending.viewport?.stickToBottom) {
      const state = currentRead.current
      if (state) {
        const coverage = cachedConversationUnreadCoverage(state.window, state.through)
        const first = coverage?.firstUnread
        const event = first && state.window?.events.find(event => event.kind === 'message' && event.item === first)
        const offset = event ? arkmeConversationAnchorOffset(body, `message:${event.eventId}`) : undefined
        const unreadTop = offset === undefined ? undefined : body.scrollTop + offset
        const readingTop = anchorOffset !== undefined && pending.viewport.anchorOffset !== undefined
          ? body.scrollTop + anchorOffset - pending.viewport.anchorOffset : pending.viewport.scrollTop
        if (first && (unreadTop === undefined || unreadTop >= readingTop + body.clientHeight - 1 && unreadTop < maximumScrollTop - 1)
          || state.latestSequence > state.through && (coverage === undefined || state.through + coverage.counts.length < state.latestSequence)) {
          suspended.current = { sourceKey, followLatest: true, pending, through: state.through }
          if (resume()) return
        }
      }
      // A checkpoint may trim/prepend rows without changing total height. Keep
      // a surviving row at its pre-commit position before following the new tail.
      let rebased = false
      if (anchorOffset !== undefined && pending.viewport.anchorOffset !== undefined) {
        const correction = anchorOffset - pending.viewport.anchorOffset
        if (Math.abs(correction) > 1) {
          body.scrollTop = Math.max(0, Math.min(maximumScrollTop, body.scrollTop + correction))
          rebased = true
        }
      }
      // Actual new timeline arrivals resume normal motion after an explicit jump;
      // ResizeObserver retargets keep the existing jump/follow intent intact.
      followConversationBottom(body, rebased, 'animated')
    } else {
      cancelConversationFollow(body)
      body.scrollTop = arkmeConversationRestoredScrollTop(pending.viewport, {
        currentScrollTop: body.scrollTop,
        scrollHeight: body.scrollHeight,
        ...(anchorOffset === undefined ? {} : { anchorOffset }),
      })
    }
    store.storeViewport(sourceKey, arkmeConversationViewport(body))
    if (restoreIntent !== undefined) {
      // Deferred layout follows the requested position, not temporary geometry.
      restoreIntent.current = pending.viewport === undefined || pending.viewport.stickToBottom
    }
    pendingRestore.current = undefined
  })

  const remember = useCallback(() => {
    const body = bodyRef.current
    if (!ready || body === null || body.clientHeight <= 0) return undefined
    const viewport = arkmeConversationViewport(body)
    store.storeViewport(sourceKey, viewport)
    return viewport
  }, [ready, sourceKey, bodyRef, store])
  return { remember, cancelResume, unreadAnchorId }
}
