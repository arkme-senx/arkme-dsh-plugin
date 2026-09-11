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
