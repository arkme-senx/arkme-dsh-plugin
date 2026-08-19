import type { ArkmeArkoHistoryItem } from '../types.js'

export const ARKO_CONVERSATION_PREVIEW_FALLBACK = '对话并处理 Arkme 业务'

export interface ArkmeArkoPreviewCandidate {
  key: string
  text: string
  createdAtMillis?: number
  messageId?: number
}

export interface ArkmeArkoConversationPreviewSnapshot {
  revision: number
  userId?: number
  latestPreview?: string
  latestAtMillis?: number
  latestKey?: string
  latestMessageId?: number
}

export interface ArkmeArkoHistoryPreviewRequest {
  userId: number
  requestId: number
  surfaceRevision: number
}

export function normalizeArkoConversationPreview(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function latestArkoConversationPreview(
  candidates: readonly ArkmeArkoPreviewCandidate[],
): ArkmeArkoPreviewCandidate | undefined {
  return candidates
    .map((candidate, index) => ({
      candidate: { ...candidate, text: normalizeArkoConversationPreview(candidate.text) },
      index,
    }))
    .filter(entry => entry.candidate.text !== '')
    .sort((left, right) => {
      const leftAt = left.candidate.createdAtMillis ?? Number.MIN_SAFE_INTEGER
      const rightAt = right.candidate.createdAtMillis ?? Number.MIN_SAFE_INTEGER
      const leftMessageId = left.candidate.messageId ?? Number.MIN_SAFE_INTEGER
      const rightMessageId = right.candidate.messageId ?? Number.MIN_SAFE_INTEGER
      return rightAt - leftAt || rightMessageId - leftMessageId || right.index - left.index
    })[0]?.candidate
}

export function latestArkoConversationPreviewInDisplayOrder(
  candidates: readonly ArkmeArkoPreviewCandidate[],
): ArkmeArkoPreviewCandidate | undefined {
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index]
    if (candidate === undefined) continue
    const text = normalizeArkoConversationPreview(candidate.text)
    if (text !== '') return { ...candidate, text }
  }
  return undefined
}

export class ArkmeArkoConversationPreviewStore {
  private snapshot: ArkmeArkoConversationPreviewSnapshot = { revision: 0 }
  private readonly listeners = new Set<() => void>()
  private nextHistoryRequestId = 0
  private latestHistoryRequestId = 0
  private surfaceRevision = 0

  readonly getSnapshot = (): ArkmeArkoConversationPreviewSnapshot => this.snapshot

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  activateUser(userId: number | undefined): void {
    const normalizedUserId = userId !== undefined && Number.isSafeInteger(userId) && userId > 0
      ? userId
      : undefined
    if (this.snapshot.userId === normalizedUserId) return
    this.latestHistoryRequestId = ++this.nextHistoryRequestId
    this.surfaceRevision = 0
    this.publish({ revision: this.snapshot.revision + 1, ...(normalizedUserId === undefined ? {} : { userId: normalizedUserId }) })
  }

  setLatestFromSurface(userId: number, candidates: readonly ArkmeArkoPreviewCandidate[]): void {
    if (!Number.isSafeInteger(userId) || userId <= 0 || this.snapshot.userId !== userId) return
    const latest = latestArkoConversationPreviewInDisplayOrder(candidates)
    if (latest === undefined) return
    this.surfaceRevision += 1
    this.publishLatest(userId, latest)
  }

  beginHistoryRequest(userId: number): ArkmeArkoHistoryPreviewRequest | undefined {
    if (!Number.isSafeInteger(userId) || userId <= 0 || this.snapshot.userId !== userId) return undefined
    const requestId = ++this.nextHistoryRequestId
    this.latestHistoryRequestId = requestId
    return { userId, requestId, surfaceRevision: this.surfaceRevision }
  }

  setLatestFromHistory(
    request: ArkmeArkoHistoryPreviewRequest,
    items: readonly ArkmeArkoHistoryItem[],
  ): boolean {
    if (this.snapshot.userId !== request.userId
      || this.latestHistoryRequestId !== request.requestId
      || this.surfaceRevision !== request.surfaceRevision) return false
    const latest = latestArkoConversationPreview(items.map(item => ({
      key: `history:${String(item.messageId)}`,
      text: item.text,
      createdAtMillis: item.createdAtMillis,
      messageId: item.messageId,
    })))
    if (latest === undefined) {
      this.publish({ revision: this.snapshot.revision + 1, userId: request.userId })
    } else {
      this.publishLatest(request.userId, latest)
    }
    return true
  }

  private publishLatest(userId: number, latest: ArkmeArkoPreviewCandidate): void {
    const latestAtMillis = latest.createdAtMillis ?? 0
    if (this.snapshot.latestPreview === latest.text
      && this.snapshot.latestAtMillis === latestAtMillis
      && this.snapshot.latestKey === latest.key
      && this.snapshot.latestMessageId === latest.messageId) return
    this.publish({
      revision: this.snapshot.revision + 1,
      userId,
      latestPreview: latest.text,
      latestAtMillis,
      latestKey: latest.key,
      ...(latest.messageId === undefined ? {} : { latestMessageId: latest.messageId }),
    })
  }

  private publish(next: ArkmeArkoConversationPreviewSnapshot): void {
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }
}

export const arkmeArkoConversationPreviewStore = new ArkmeArkoConversationPreviewStore()
