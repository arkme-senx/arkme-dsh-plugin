import { createHash, createHmac } from 'node:crypto'
import type { ArkmeConversationWriteResult } from '../types.js'
import type {
  ArkmeExtensionCatalogItem,
  ArkmeExtensionRatingSummary,
  ArkmeExtensionReviewAvatarFallback,
  ArkmeExtensionReviewCreateInput,
  ArkmeExtensionReviewCreateResult,
  ArkmeExtensionReviewItem,
  ArkmeExtensionReviewOperation,
  ArkmeExtensionReviewPage,
  ArkmeExtensionReviewWireCreateResult,
  ArkmeExtensionReviewWireItem,
  ArkmeExtensionReviewWirePage,
} from '../extensions/types.js'
import { ProfileService } from './profile-service.js'
import { ArkmePluginError, ServiceRuntime } from './service.js'

export interface ArkmeExtensionAuthorProjection {
  displayName: string
  arkmeId?: string
  avatarRef?: string
  avatarFallback?: ArkmeExtensionReviewAvatarFallback
}

interface ArkmeExtensionReviewRefEntry {
  viewerUserId: number
  extensionId: string
  reviewId: string
  expiresAtMillis: number
}

export interface ArkmeRecordWriter {
  createTextForConversation(recordUid: string, textContent: string): Promise<ArkmeConversationWriteResult>
}

const ARKME_EXTENSION_REVIEW_REF_TTL_MILLIS = 30 * 60 * 1000
const MAX_ARKME_EXTENSION_REVIEW_REFS = 4096

function safeFailureMessage(error: unknown): string {
  if (error instanceof ArkmePluginError) return error.message
  if (error instanceof Error && error.message.trim() !== '') return error.message
  return '未知错误'
}

function stableExtensionReviewRecordUid(
  userId: number,
  extensionId: string,
  parentReviewId: string,
  clientMutationId: string,
): string {
  const hex = createHash('sha256')
    .update(`dsh-arkme:extension-review:${String(userId)}:${extensionId}:${parentReviewId}:${clientMutationId}`)
    .digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

export class ExtensionReviewService {
  private readonly extensionReviewRefs = new Map<string, ArkmeExtensionReviewRefEntry>()
  private readonly extensionReviewFlushes = new Map<number, Promise<void>>()

  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly profile: ProfileService,
    private readonly recordWriter: ArkmeRecordWriter,
  ) {}

  dispose(): void {
    this.extensionReviewRefs.clear()
    this.extensionReviewFlushes.clear()
  }

  async extensionAuthors(
    userIds: readonly number[],
    signal?: AbortSignal,
  ): Promise<Map<number, ArkmeExtensionAuthorProjection>> {
    const session = await this.runtime.requireSession()
    const profiles = await this.profile.publicProfileSummariesByUserIds(userIds, session, signal)
    const authors = await Promise.all([...profiles].map(async ([userId, profile]) => {
      const author: ArkmeExtensionAuthorProjection = {
        displayName: profile.displayName,
        ...(profile.arkmeId === undefined ? {} : { arkmeId: profile.arkmeId }),
        ...(profile.avatarUrl === undefined ? {} : { avatarRef: await this.profile.sealProfileImageRef(session.userId, userId) }),
        ...(profile.avatarFallback?.kind === 'phone_default' ? { avatarFallback: profile.avatarFallback } : {}),
      }
      return [userId, author] as const
    }))
    return new Map(authors)
  }

  async listExtensionReviews(
    extensionIdValue: string,
    options: { limit?: number; offset?: number; signal?: AbortSignal } = {},
  ): Promise<ArkmeExtensionReviewPage> {
    const session = await this.runtime.requireSession()
    const extensionId = this.normalizedExtensionReviewExtensionId(extensionIdValue)
    await this.flushPendingExtensionReviews(session.userId, options.signal).catch(() => undefined)
    const limit = Math.min(100, Math.max(1, Math.trunc(options.limit ?? 20)))
    const offset = Math.max(0, Math.trunc(options.offset ?? 0))
    const page = await this.runtime.extensionPost<ArkmeExtensionReviewWirePage>(
      '/api/public/v1/extensions/reviews/list',
      { extension_id: extensionId, limit, offset },
      options.signal,
      { lane: 'interactive-read', key: `extension-reviews:${extensionId}:${String(limit)}:${String(offset)}` },
    )
    const authors = await this.extensionAuthors(page.items.map(item => item.user_id), options.signal)
    const items = await Promise.all(page.items.map(async item => await this.extensionReviewItem(
      item, session.userId, extensionId, authors,
    )))
    const normalizedOffset = Math.max(0, Math.trunc(page.offset || offset))
    const rootCount = page.items.filter(item => (item.parent_review_id?.trim() ?? '') === '').length
    return {
      items,
      total: Math.max(0, Math.trunc(page.total)),
      limit: Math.max(1, Math.trunc(page.limit || limit)),
      offset: normalizedOffset,
      hasMore: page.has_more === true,
      ...(page.has_more === true ? { nextOffset: normalizedOffset + rootCount } : {}),
      ratingSummary: this.extensionRatingSummary(page.rating_summary),
    }
  }

  async createExtensionReview(
    input: ArkmeExtensionReviewCreateInput,
    signal?: AbortSignal,
  ): Promise<ArkmeExtensionReviewCreateResult> {
    const session = await this.runtime.requireSession()
    const extensionId = this.normalizedExtensionReviewExtensionId(input.extensionId)
    const textContent = input.textContent.trim()
    const clientMutationId = input.clientMutationId.trim()
    if (textContent === '' || [...textContent].length > 2000) {
      throw new ArkmePluginError('extension-review-text-invalid', '评论内容不能为空且不能超过 2000 个字符', false)
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/.test(clientMutationId)) {
      throw new ArkmePluginError('extension-review-mutation-invalid', '评论请求标识无效，请重试', false)
    }
    const parentReviewRef = input.parentReviewRef?.trim() ?? ''
    const parentReviewId = parentReviewRef === ''
      ? ''
      : this.openExtensionReviewRef(parentReviewRef, session.userId, extensionId).reviewId
    const rating = input.rating
    if (parentReviewId === '') {
      if (!Number.isSafeInteger(rating) || (rating ?? 0) < 1 || (rating ?? 0) > 5) {
        throw new ArkmePluginError('extension-review-rating-invalid', '发表评价时请选择 1 到 5 星', false)
      }
      const detail = await this.runtime.extensionPost<ArkmeExtensionCatalogItem | { extension: ArkmeExtensionCatalogItem }>(
        '/api/public/v1/extensions/detail',
        { extension_id: extensionId },
        signal,
        { lane: 'interactive-read', key: `extension-detail:${extensionId}` },
      )
      const extension = 'extension' in detail ? detail.extension : detail
      if (extension.owner_user_id === session.userId) {
        throw new ArkmePluginError(
          'extension-review-owner-forbidden',
          '扩展作者不能给自己的扩展评分，可以回复其他用户的评论',
          false,
          403,
        )
      }
    } else if (rating !== undefined) {
      throw new ArkmePluginError('extension-review-reply-rating-invalid', '回复评论不能携带评分', false)
    }
    const recordUid = stableExtensionReviewRecordUid(
      session.userId, extensionId, parentReviewId, clientMutationId,
    )
    const existing = (await this.runtime.stateStore.listExtensionReviewOperations(session.userId))
      .find(operation => operation.clientMutationId === clientMutationId)
    if (existing !== undefined && (existing.extensionId !== extensionId || existing.recordUid !== recordUid
      || existing.parentReviewId !== (parentReviewId || undefined) || existing.textContent !== textContent
      || existing.rating !== rating)) {
      throw new ArkmePluginError('extension-review-idempotency-mismatch', '同一评论请求标识不能用于不同内容', false, 409)
    }
    const operation: ArkmeExtensionReviewOperation = existing ?? {
      extensionId,
      recordUid,
      ...(parentReviewId === '' ? {} : { parentReviewId }),
      textContent,
      ...(rating === undefined ? {} : { rating }),
      clientMutationId,
      state: 'record_pending',
      attempts: 0,
      createdAtMillis: Date.now(),
    }
    if (existing === undefined) await this.runtime.stateStore.putExtensionReviewOperation(session.userId, operation)
    return await this.performExtensionReviewOperation(session.userId, operation, signal)
  }

  private async performExtensionReviewOperation(
    userId: number,
    operation: ArkmeExtensionReviewOperation,
    signal?: AbortSignal,
  ): Promise<ArkmeExtensionReviewCreateResult> {
    const record = await this.recordWriter.createTextForConversation(operation.recordUid, operation.textContent)
    if (record.localState !== 'synced') {
      await this.runtime.stateStore.markExtensionReviewOperation(
        userId, operation.clientMutationId, 'failed', record.error ?? '评论 Record 写入失败',
      )
      throw new ArkmePluginError(
        'extension-review-record-pending',
        record.error ?? '评论已保存到本地待重试队列，请稍后重试',
        true,
        503,
      )
    }
    await this.runtime.stateStore.markExtensionReviewOperation(userId, operation.clientMutationId, 'registry_pending')
    let result: ArkmeExtensionReviewWireCreateResult
    try {
      result = await this.runtime.extensionPost<ArkmeExtensionReviewWireCreateResult>(
        '/api/v1/extensions/reviews/create',
        {
          extension_id: operation.extensionId,
          record_uid: operation.recordUid,
          ...(operation.parentReviewId === undefined ? {} : { parent_review_id: operation.parentReviewId }),
          text_content: operation.textContent,
          ...(operation.rating === undefined ? {} : { rating: operation.rating }),
          client_mutation_id: operation.clientMutationId,
        },
        signal,
      )
    } catch (error) {
      const terminal = error instanceof ArkmePluginError && !error.retryable
        && [400, 403, 404, 409, 422].includes(error.httpStatus)
      if (terminal) {
        await this.runtime.stateStore.removeExtensionReviewOperation(userId, operation.clientMutationId)
        throw new ArkmePluginError(
          'extension-review-registry-rejected',
          `评论已写入首页，但市集未接受：${error.message}`,
          false,
          error.httpStatus,
          { cause: error },
        )
      }
      await this.runtime.stateStore.markExtensionReviewOperation(userId, operation.clientMutationId, 'failed', safeFailureMessage(error))
      throw new ArkmePluginError(
        'extension-review-registry-pending',
        '评论已写入首页，但同步到扩展详情失败；请保留当前内容并重试',
        true,
        503,
        { cause: error },
      )
    }
    const authors = await this.extensionAuthors([result.review.user_id], signal)
    const review = await this.extensionReviewItem(result.review, userId, operation.extensionId, authors)
    await this.runtime.stateStore.removeExtensionReviewOperation(userId, operation.clientMutationId)
    return {
      review,
      ratingSummary: this.extensionRatingSummary(result.rating_summary),
      idempotentReplay: result.idempotent_replay === true,
    }
  }

  private async flushPendingExtensionReviews(userId: number, signal?: AbortSignal): Promise<void> {
    const existing = this.extensionReviewFlushes.get(userId)
    if (existing !== undefined) return await existing
    const flush = (async () => {
      const operations = await this.runtime.stateStore.listExtensionReviewOperations(userId)
      for (const operation of operations) {
        if (signal?.aborted === true) break
        try { await this.performExtensionReviewOperation(userId, operation, signal) }
        catch { /* The durable operation remains available for the next refresh/retry. */ }
      }
    })()
    this.extensionReviewFlushes.set(userId, flush)
    try { await flush } finally { this.extensionReviewFlushes.delete(userId) }
  }

  private normalizedExtensionReviewExtensionId(value: string): string {
    const extensionId = value.trim()
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(extensionId)) {
      throw new ArkmePluginError('extension-review-extension-invalid', '扩展标识无效，请刷新扩展详情', false)
    }
    return extensionId
  }

  private extensionRatingSummary(raw: ArkmeExtensionRatingSummary | undefined): ArkmeExtensionRatingSummary {
    const histogram = Array.isArray(raw?.histogram) ? raw.histogram : []
    return {
      average: Math.max(0, Math.min(5, Number(raw?.average ?? 0))),
      count: Math.max(0, Math.trunc(Number(raw?.count ?? 0))),
      histogram: [0, 1, 2, 3, 4].map(index => Math.max(0, Math.trunc(Number(histogram[index] ?? 0)))) as [number, number, number, number, number],
    }
  }

  private async extensionReviewItem(
    item: ArkmeExtensionReviewWireItem,
    viewerUserId: number,
    extensionId: string,
    authors: ReadonlyMap<number, ArkmeExtensionAuthorProjection>,
  ): Promise<ArkmeExtensionReviewItem> {
    const reviewId = item.review_id.trim()
    const parentReviewId = item.parent_review_id?.trim() ?? ''
    const author = authors.get(Math.trunc(item.user_id))
    return {
      reviewRef: await this.extensionReviewRef(viewerUserId, extensionId, reviewId),
      ...(parentReviewId === '' ? {} : {
        parentReviewRef: await this.extensionReviewRef(viewerUserId, extensionId, parentReviewId),
      }),
      authorName: author?.displayName.trim() || 'Arkme 用户',
      ...(author?.arkmeId === undefined ? {} : { authorArkmeId: author.arkmeId }),
      ...(author?.avatarRef === undefined ? {} : { authorAvatarRef: author.avatarRef }),
      ...(author?.avatarFallback === undefined ? {} : { authorAvatarFallback: author.avatarFallback }),
      textContent: item.text_content.trim(),
      rating: Math.max(0, Math.min(5, Math.trunc(item.rating))),
      createdAtMillis: Math.max(0, Math.trunc(item.created_at)),
    }
  }

  private async extensionReviewRef(viewerUserId: number, extensionId: string, reviewId: string): Promise<string> {
    const digest = createHmac('sha256', await this.runtime.stateStore.uniqueCode())
      .update(`extension-review-v1:${String(viewerUserId)}:${extensionId}:${reviewId}`)
      .digest('base64url')
    const reviewRef = `arkme-extension-review-v1.${digest}`
    const now = Date.now()
    this.pruneExtensionReviewRefs(now)
    this.extensionReviewRefs.set(reviewRef, {
      viewerUserId,
      extensionId,
      reviewId,
      expiresAtMillis: now + ARKME_EXTENSION_REVIEW_REF_TTL_MILLIS,
    })
    return reviewRef
  }

  private openExtensionReviewRef(
    reviewRef: string,
    viewerUserId: number,
    extensionId: string,
  ): ArkmeExtensionReviewRefEntry {
    const normalized = reviewRef.trim()
    const entry = normalized.startsWith('arkme-extension-review-v1.')
      ? this.extensionReviewRefs.get(normalized)
      : undefined
    if (entry === undefined || entry.viewerUserId !== viewerUserId || entry.extensionId !== extensionId
      || entry.expiresAtMillis <= Date.now()) {
      this.extensionReviewRefs.delete(normalized)
      throw new ArkmePluginError('extension-review-ref-invalid', '评论引用无效或已过期，请刷新评论列表', false, 403)
    }
    return entry
  }

  private pruneExtensionReviewRefs(now: number): void {
    for (const [reviewRef, entry] of this.extensionReviewRefs) {
      if (entry.expiresAtMillis <= now) this.extensionReviewRefs.delete(reviewRef)
    }
    while (this.extensionReviewRefs.size >= MAX_ARKME_EXTENSION_REVIEW_REFS) {
      const oldest = this.extensionReviewRefs.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.extensionReviewRefs.delete(oldest)
    }
  }
}
