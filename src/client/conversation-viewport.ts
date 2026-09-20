import { useCallback, useLayoutEffect, type MutableRefObject, type RefObject } from 'react'
import {
  arkmeConversationRestoredScrollTop,
  type ArkmeConversationViewportSnapshot,
} from './conversation-memory-cache.js'

/** Viewport persistence only; message data, cursors and access refs stay with their owners. */
export interface ArkmeConversationViewportStore {
  getViewport(sourceKey: string): ArkmeConversationViewportSnapshot | undefined
  storeViewport(sourceKey: string, viewport: ArkmeConversationViewportSnapshot): void
}

export interface ArkmeConversationViewportRestore {
  sourceKey: string
  viewport: ArkmeConversationViewportSnapshot | undefined
  /** Explicit newer-page navigation, not a saved reading position. */
  newerPageStartAnchorId?: string
}

export function arkmeConversationViewport(root: HTMLDivElement, messagesOnly = false): ArkmeConversationViewportSnapshot {
  const stickToBottom = !messagesOnly && root.scrollHeight - root.scrollTop - root.clientHeight <= 80
  if (stickToBottom) return { scrollTop: root.scrollTop, stickToBottom: true }
  const rootRect = root.getBoundingClientRect()
  for (const row of root.querySelectorAll<HTMLElement>('[data-arkme-conversation-row]')) {
    if (messagesOnly && !row.dataset.arkmeConversationRow?.startsWith('message:')) continue
    const rowRect = row.getBoundingClientRect()
    if (rowRect.bottom <= rootRect.top || rowRect.top >= rootRect.bottom) continue
    const anchorId = row.dataset.arkmeConversationRow
    if (anchorId !== undefined) {
      return {
        scrollTop: root.scrollTop,
        stickToBottom: false,
        anchorId,
        anchorOffset: rowRect.top - rootRect.top,
      }
    }
  }
  return { scrollTop: root.scrollTop, stickToBottom: false }
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

export function arkmeConversationTargetRow(root: HTMLDivElement | null, target: { itemUid: string; momentId?: string }): HTMLElement | undefined {
  if (!root) return undefined
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
export function useConversationViewport({ active, sourceKey, renderedSourceKey, bodyRef, store, pendingRestore, restoreIntent }: {
  active: boolean
  sourceKey: string
  renderedSourceKey: string
  bodyRef: RefObject<HTMLDivElement>
  store: ArkmeConversationViewportStore
  pendingRestore: MutableRefObject<ArkmeConversationViewportRestore | undefined>
  restoreIntent?: MutableRefObject<boolean | undefined>
}) {
  const ready = active && sourceKey !== '' && sourceKey === renderedSourceKey
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
    const pending = pendingRestore.current
    const body = bodyRef.current
    if (!ready || body === null || body.clientHeight <= 0 || pending?.sourceKey !== sourceKey) return
    const anchorOffset = arkmeConversationAnchorOffset(body, pending.viewport?.anchorId)
    const newerPageStartOffset = arkmeConversationAnchorOffset(body, pending.newerPageStartAnchorId)
    const maximumScrollTop = Math.max(0, body.scrollHeight - body.clientHeight)
    body.scrollTop = pending.newerPageStartAnchorId === undefined
      ? arkmeConversationRestoredScrollTop(pending.viewport, {
        currentScrollTop: body.scrollTop,
        scrollHeight: body.scrollHeight,
        ...(anchorOffset === undefined ? {} : { anchorOffset }),
      })
      : Math.max(0, Math.min(maximumScrollTop, newerPageStartOffset === undefined
        ? pending.viewport?.scrollTop ?? body.scrollTop
        : body.scrollTop + newerPageStartOffset))
    store.storeViewport(sourceKey, arkmeConversationViewport(body))
    if (restoreIntent !== undefined) {
      // Deferred layout follows the requested position, not temporary geometry.
      restoreIntent.current = pending.newerPageStartAnchorId === undefined
        && (pending.viewport === undefined || pending.viewport.stickToBottom)
    }
    pendingRestore.current = undefined
  })

  return useCallback(() => {
    const body = bodyRef.current
    if (!ready || body === null || body.clientHeight <= 0) return undefined
    const viewport = arkmeConversationViewport(body)
    store.storeViewport(sourceKey, viewport)
    return viewport
  }, [ready, sourceKey, bodyRef, store])
}
