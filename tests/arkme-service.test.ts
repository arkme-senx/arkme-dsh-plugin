import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { ArkmePluginError, ArkmeService, type ArkmeServiceConfig } from '../src/arkme-service.js'
import type { ArkmeSessionCredentials } from '../src/keychain-store.js'
import type { ArkmeLongArticleDraft, ArkmePendingWrite } from '../src/types.js'
import type { ArkmeExtensionReviewOperation } from '../src/extensions/types.js'
import { ContactDirectoryService } from '../src/services/contact-directory-service.js'
import { MediaService } from '../src/services/media-service.js'
import { UnmarkedSpeakerService } from '../src/services/unmarked-speaker-service.js'
import type {
  ArkmeRecordCursor, ArkmeSelfRecordItem, ArkmeSelfRecordList, ArkmeSelfSummary, ArkmeSourceItem,
  ArkmeUserProfile, ArkmeUserProfileSnapshot,
} from '../src/types.js'

class MemorySessionStore {
  session: ArkmeSessionCredentials | undefined
  async read() { return this.session }
  async write(session: ArkmeSessionCredentials) { this.session = session }
  async delete() { this.session = undefined }
}

class MemoryStateStore {
  readonly pending = new Map<number, ArkmePendingWrite[]>()
  readonly cached = new Map<number, ArkmeSelfRecordItem[]>()
  readonly events: string[] = []
  readonly longArticleDrafts = new Map<string, ArkmeLongArticleDraft>()
  readonly extensionReviewOperations = new Map<number, ArkmeExtensionReviewOperation[]>()
  summary: ArkmeSelfSummary | undefined
  page: ArkmeSelfRecordList | undefined
  revisionValue = 0
  profile: ArkmeUserProfile | null = null
  async uniqueCode() { return 'dsh-device-1' }
  async revision(_userId: number) { return this.revisionValue }
  async cachedProfile(_userId: number): Promise<ArkmeUserProfileSnapshot> {
    return { profile: this.profile, cachedAtMillis: this.profile === null ? 0 : 1, revision: this.revisionValue }
  }
  async cacheProfile(_userId: number, profile: ArkmeUserProfile): Promise<ArkmeUserProfileSnapshot> {
    this.profile = profile
    this.revisionValue += 1
    return { profile, cachedAtMillis: 1, revision: this.revisionValue }
  }
  async cachedSnapshot(userId: number) {
    return {
      items: [...(this.cached.get(userId) ?? [])],
      hasMore: this.page?.hasMore ?? false,
      ...(this.page?.nextCursor === undefined ? {} : { nextCursor: this.page.nextCursor }),
      ...(this.summary === undefined ? {} : { summary: this.summary }),
      cachedAtMillis: this.page === undefined && this.summary === undefined ? 0 : 1,
      revision: this.revisionValue,
    }
  }
  async cacheSummary(_userId: number, summary: ArkmeSelfSummary) {
    this.summary = summary
    this.revisionValue += 1
  }
  async cachePage(userId: number, page: ArkmeSelfRecordList, _cursor?: ArkmeRecordCursor) {
    this.page = page
    const byUid = new Map((this.cached.get(userId) ?? []).map(item => [item.recordUid, item]))
    for (const item of page.items) byUid.set(item.recordUid, item)
    this.cached.set(userId, [...byUid.values()])
    this.events.push('cache-page')
    this.revisionValue += 1
  }
  async listPending(userId: number) { return [...(this.pending.get(userId) ?? [])] }
  async putPending(userId: number, item: ArkmePendingWrite) {
    this.pending.set(userId, [...(this.pending.get(userId) ?? []).filter(old => old.recordUid !== item.recordUid), item])
    this.cached.set(userId, [{
      recordUid: item.recordUid, sendAtMillis: item.sendAtMillis, title: '', textContent: item.textContent,
      templateKind: 1, status: 0, version: 0, localState: 'pending',
    }, ...(this.cached.get(userId) ?? []).filter(old => old.recordUid !== item.recordUid)])
    this.events.push('local-pending')
    this.revisionValue += 1
  }
  async markAttempt(userId: number, recordUid: string, error: string) {
    const item = (this.pending.get(userId) ?? []).find(candidate => candidate.recordUid === recordUid)
    if (item !== undefined) {
      item.attempts += 1
      item.lastError = error
    }
    this.revisionValue += 1
  }
  async markSynced(userId: number, recordUid: string, status: number) {
    this.pending.set(userId, (this.pending.get(userId) ?? []).filter(item => item.recordUid !== recordUid))
    this.cached.set(userId, (this.cached.get(userId) ?? []).map(item => item.recordUid === recordUid
      ? { ...item, status, localState: 'synced' }
      : item))
    this.events.push('local-synced')
    this.revisionValue += 1
  }
  async listExtensionReviewOperations(userId: number) {
    return [...(this.extensionReviewOperations.get(userId) ?? [])].map(item => ({ ...item }))
  }
  async putExtensionReviewOperation(userId: number, operation: ArkmeExtensionReviewOperation) {
    this.extensionReviewOperations.set(userId, [
      ...(this.extensionReviewOperations.get(userId) ?? [])
        .filter(item => item.clientMutationId !== operation.clientMutationId),
      { ...operation },
    ])
  }
  async markExtensionReviewOperation(
    userId: number,
    clientMutationId: string,
    state: ArkmeExtensionReviewOperation['state'],
    error?: string,
  ) {
    const operation = (this.extensionReviewOperations.get(userId) ?? [])
      .find(item => item.clientMutationId === clientMutationId)
    if (operation !== undefined) {
      operation.state = state
      operation.attempts += 1
      operation.lastError = error
    }
  }
  async removeExtensionReviewOperation(userId: number, clientMutationId: string) {
    this.extensionReviewOperations.set(userId, (this.extensionReviewOperations.get(userId) ?? [])
      .filter(item => item.clientMutationId !== clientMutationId))
  }
  async getLongArticleDraft(userId: number, sourceRef: string, itemUid?: string) {
    return this.longArticleDrafts.get(`${String(userId)}:${sourceRef}:${itemUid ?? ''}`)
  }
  async putLongArticleDraft(userId: number, draft: ArkmeLongArticleDraft) {
    this.longArticleDrafts.set(`${String(userId)}:${draft.sourceRef}:${draft.itemUid ?? ''}`, draft)
  }
  async removeLongArticleDraft(userId: number, sourceRef: string, itemUid?: string) {
    this.longArticleDrafts.delete(`${String(userId)}:${sourceRef}:${itemUid ?? ''}`)
  }
}

const config: ArkmeServiceConfig = {
  environment: 'test',
  authBaseUrl: 'https://auth.test',
  subjectBaseUrl: 'https://subject.test',
  recordBaseUrl: 'https://record.test',
  chatBaseUrl: 'https://chat.test',
  botBaseUrl: 'https://bot.test',
  imBaseUrl: 'https://im.test',
  webrtcBaseUrl: 'https://webrtc.test',
  worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test',
  intelligentBaseUrl: 'https://intelligent.test',
  routePath: '/arkme-self/api',
  audioBaseUrl: 'https://audio.test',
  requestTimeoutMs: 5000,
  maxTextLength: 20000,
  geetestCaptchaId: 'captcha-test-id-1234567890',
  interwovenMomentsEnabled: true,
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function jwtWithExpiry(exp: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url')
  return `${header}.${payload}.signature`
}

function userInfo(userId: number, phone = '13800138000'): Record<string, unknown> {
  return {
    user_id: userId,
    nick_name: `user-${userId}`,
    head_img: '',
    name_slug: `arkme-${userId}`,
    type: 1,
    create_at: 123,
    phone,
    email: '',
    has_bind_apple: false,
    has_bind_wechat: false,
    has_bind_google: false,
  }
}

function sourceRefFor(
  kind: 'private_chat' | 'group_chat', ownerRef: string, displayName: string, userId = 10001,
): string {
  const payload = Buffer.from(JSON.stringify({
    version: 1,
    userId,
    kind,
    ownerRef,
    displayName,
  }), 'utf8').toString('base64url')
  const signature = createHmac('sha256', 'dsh-device-1').update(payload).digest('base64url')
  return `arkme-source-v1.${payload}.${signature}`
}

describe('ArkmeService', () => {
  it('validates the signed source message before uploading extension attachments', async () => {
    const service = new ArkmeService(config, new MemorySessionStore(), new MemoryStateStore())
    const validationError = new ArkmePluginError('message-action-ref-invalid', '消息操作凭据无效', false)
    const sourceMessageExtensionContext = vi.fn(async () => { throw validationError })
    const extendSourceMessage = vi.fn()
    const uploadRefs = vi.fn(async () => [])
    Object.assign(service as unknown as Record<string, unknown>, {
      chat: { sourceMessageExtensionContext, extendSourceMessage },
      fileTransfers: { uploadRefs, cancelActive: vi.fn() },
    })

    await expect(service.extendSourceMessage(
      'opaque-source', 'invalid-action', '附件延展',
      '11111111-1111-4111-8111-111111111111', ['arkme-file-v1.22222222-2222-4222-8222-222222222222'],
    )).rejects.toBe(validationError)
    expect(sourceMessageExtensionContext).toHaveBeenCalledWith('opaque-source', 'invalid-action', {})
    expect(uploadRefs).not.toHaveBeenCalled()
    expect(extendSourceMessage).not.toHaveBeenCalled()
    service.dispose()
  })

  it('rejects a stale nested extension target before uploading attachments', async () => {
    const service = new ArkmeService(config, new MemorySessionStore(), new MemoryStateStore())
    const sourceMessageExtensionContext = vi.fn(async () => ({
      parentRecordUid: 'record-root',
      extensionCount: 1,
      extensions: [{ recordUid: 'record-current-child' }],
    }))
    const extendSourceMessage = vi.fn()
    const uploadRefs = vi.fn(async () => [])
    Object.assign(service as unknown as Record<string, unknown>, {
      chat: { sourceMessageExtensionContext, extendSourceMessage },
      fileTransfers: { uploadRefs, cancelActive: vi.fn() },
    })

    await expect(service.extendSourceMessage(
      'opaque-source', 'signed-action', '附件延展',
      '11111111-1111-4111-8111-111111111111', ['arkme-file-v1.22222222-2222-4222-8222-222222222222'],
      { parentRecordUid: 'record-stale-child' },
    )).rejects.toMatchObject({ code: 'source-message-extension-target-invalid', retryable: true })
    expect(sourceMessageExtensionContext).toHaveBeenCalledWith(
      'opaque-source', 'signed-action', { parentRecordUid: 'record-stale-child' },
    )
    expect(uploadRefs).not.toHaveBeenCalled()
    expect(extendSourceMessage).not.toHaveBeenCalled()
    service.dispose()
  })

  it('owns directory services, routes unmarked lists separately, injects media, and clears their refs', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const contactList = vi.spyOn(ContactDirectoryService.prototype, 'list')
      .mockImplementation(async section => ({ section, items: [], total: 0, hasMore: false }))
    const unmarkedList = vi.spyOn(UnmarkedSpeakerService.prototype, 'list')
      .mockResolvedValue({ section: 'unmarked-speakers', items: [], total: 0, hasMore: false })
    const unmarkedSegments = vi.spyOn(UnmarkedSpeakerService.prototype, 'segments')
      .mockImplementation(async function () {
        expect((this as unknown as { media?: unknown }).media).toBeInstanceOf(MediaService)
        return { items: [], total: 0, hasMore: false }
      })
    const contactDispose = vi.spyOn(ContactDirectoryService.prototype, 'dispose')
    const unmarkedDispose = vi.spyOn(UnmarkedSpeakerService.prototype, 'dispose')
    const service = new ArkmeService(config, sessions, new MemoryStateStore())

    await expect(service.listDirectory('contacts')).resolves.toMatchObject({ section: 'contacts' })
    await expect(service.listDirectory('unmarked-speakers')).resolves.toMatchObject({ section: 'unmarked-speakers' })
    await expect(service.unmarkedSpeakerSegments('candidate-ref')).resolves.toMatchObject({ hasMore: false })
    expect(contactList).toHaveBeenCalledOnce()
    expect(unmarkedList).toHaveBeenCalledOnce()

    await service.logout()
    expect(contactDispose).toHaveBeenCalledOnce()
    expect(unmarkedDispose).toHaveBeenCalledOnce()

    service.dispose()
    expect(contactDispose).toHaveBeenCalledTimes(2)
    expect(unmarkedDispose).toHaveBeenCalledTimes(2)
  })

  it('resolves the current Arkme access token for managed model calls without copying it elsewhere', async () => {
    const sessions = new MemorySessionStore()
    const accessToken = jwtWithExpiry(Math.floor(Date.now() / 1000) + 120)
    sessions.session = { userId: 10001, accessToken, refreshToken: 'refresh' }
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error('a fresh managed access credential must not call the network')
    })
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), fetchImpl)

    const credential = await service.resolveManagedAccessCredential()

    expect(credential.reveal()).toBe(accessToken)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('refreshes a managed access credential before it enters the final minute', async () => {
    const sessions = new MemorySessionStore()
    const expiringToken = jwtWithExpiry(Math.floor(Date.now() / 1000) + 30)
    const renewedToken = jwtWithExpiry(Math.floor(Date.now() / 1000) + 3600)
    sessions.session = { userId: 10001, accessToken: expiringToken, refreshToken: 'refresh' }
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('https://auth.test/api/public/v1/auth/new-short')
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer refresh')
      return json({ code: 200, data: { access_token: renewedToken } })
    })
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), fetchImpl)

    const credential = await service.resolveManagedAccessCredential()

    expect(credential.reveal()).toBe(renewedToken)
    expect(sessions.session?.accessToken).toBe(renewedToken)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('resolves extension authors with safe real and default avatar projections', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('https://auth.test/api/v1/auth/get-public-users-by-ids')
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access')
      expect(JSON.parse(String(init?.body))).toEqual({ user_ids: [77, 78, 79] })
      return json({ code: 200, data: { items: [
        {
          user_id: 77, nick_name: '真实头像', name_slug: 'publisher',
          head_img: 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/avatar.png?x-oss-signature=sig',
        },
        { user_id: 78, nick_name: '手机号头像', name_slug: '', head_img: 'phone_avatar://v1/7/林' },
        { user_id: 79, nick_name: '默认头像', name_slug: '', head_img: '' },
      ] } })
    })
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), fetchImpl)

    const authors = await service.extensionAuthors([79, 77, 78])
    expect(authors.get(77)).toEqual({
      displayName: '真实头像', arkmeId: 'publisher', avatarRef: expect.stringMatching(/^arkme-profile-image-v1\./),
    })
    expect(authors.get(78)).toEqual({
      displayName: '手机号头像', avatarFallback: { kind: 'phone_default', colorIndex: 7, label: '林' },
    })
    expect(authors.get(79)).toEqual({ displayName: '默认头像' })
  })

  it('writes extension reviews to Record first, hides raw record ids, and repairs registry failure on refresh', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    let registryAvailable = false
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      calls.push({ url, body })
      if (url === 'https://extension.test/api/public/v1/extensions/detail') {
        return json({ code: 0, data: { extension: {
          extension_id: body.extension_id, owner_user_id: 20002, name: '扩展', description: '', visibility: 'public',
        } } })
      }
      if (url === 'https://record.test/api/v1/records/create') {
        return json({ code: 0, data: { record_uid: body.record_uid, status: 1 } })
      }
      if (url === 'https://extension.test/api/v1/extensions/reviews/create') {
        if (!registryAvailable) return json({ code: 50001, message: 'temporary unavailable', data: null }, 500)
        return json({ code: 0, data: {
          review: {
            extension_id: body.extension_id, review_id: `rvw_${String(body.record_uid).slice(0, 8)}`, user_id: 10001,
            ...(body.parent_review_id === undefined ? {} : { parent_review_id: body.parent_review_id }),
            text_content: body.text_content, rating: body.rating ?? 0,
            created_at: 123,
          },
          rating_summary: { average: 5, count: 1, histogram: [0, 0, 0, 0, 1] },
          idempotent_replay: true,
        } })
      }
      if (url === 'https://extension.test/api/public/v1/extensions/reviews/list') {
        return json({ code: 0, data: {
          items: [
            { extension_id: 'ext-review-1', review_id: 'rvw_root', user_id: 10001, text_content: '值得推荐', rating: 5, created_at: 123 },
            { extension_id: 'ext-review-1', review_id: 'rvw_reply', parent_review_id: 'rvw_root', user_id: 20002, text_content: '谢谢反馈', rating: 0, created_at: 124 },
          ],
          total: 1, limit: 20, offset: 0, has_more: false,
          rating_summary: { average: 5, count: 1, histogram: [0, 0, 0, 0, 1] },
        } })
      }
      if (url === 'https://auth.test/api/v1/auth/get-public-users-by-ids') {
        const userIds = Array.isArray(body.user_ids) ? body.user_ids : []
        return json({ code: 200, data: { items: userIds.map(userId => ({
          user_id: userId, nick_name: userId === 10001 ? '我' : '作者', name_slug: `user-${String(userId)}`, head_img: '',
        })) } })
      }
      throw new Error(`unexpected ${url}`)
    })
    const service = new ArkmeService(
      { ...config, extensionPublishBaseUrl: 'https://extension.test' }, sessions, state, fetchImpl,
    )
    const input = {
      extensionId: 'ext-review-1', textContent: '值得推荐', rating: 5,
      clientMutationId: 'review-mutation-0001',
    }

    await expect(service.createExtensionReview(input)).rejects.toMatchObject({
      code: 'extension-review-registry-pending', retryable: true,
    })
    const recordCall = calls.find(call => call.url.endsWith('/api/v1/records/create'))
    const reviewCall = calls.find(call => call.url.endsWith('/api/v1/extensions/reviews/create'))
    expect(recordCall?.body).toMatchObject({ text_content: '值得推荐', template_kind: 1 })
    expect(reviewCall?.body).toMatchObject({
      extension_id: 'ext-review-1', record_uid: recordCall?.body.record_uid,
      text_content: '值得推荐', rating: 5, client_mutation_id: 'review-mutation-0001',
    })
    expect(await state.listExtensionReviewOperations(10001)).toMatchObject([{
      state: 'failed', clientMutationId: 'review-mutation-0001',
    }])

    registryAvailable = true
    const page = await service.listExtensionReviews('ext-review-1')
    expect(page).toMatchObject({
      ratingSummary: { average: 5, count: 1 },
      total: 1,
    })
    expect(page.items[1]).toMatchObject({ parentReviewRef: page.items[0]?.reviewRef, textContent: '谢谢反馈' })
    expect(await state.listExtensionReviewOperations(10001)).toEqual([])
    const successfulCreate = calls.filter(call => call.url.endsWith('/api/v1/extensions/reviews/create')).at(-1)!
    expect(successfulCreate.body.record_uid).toBe(recordCall?.body.record_uid)

    const result = await service.createExtensionReview({
      extensionId: input.extensionId, clientMutationId: 'review-mutation-0002', textContent: '回复内容',
      parentReviewRef: page.items[0]!.reviewRef,
    })
    expect(result.review.reviewRef).toMatch(/^arkme-extension-review-v1\./)
    const latestRecordUid = calls.filter(call => call.url.endsWith('/api/v1/records/create')).at(-1)?.body.record_uid
    expect(JSON.stringify(result)).not.toContain(String(latestRecordUid))
    expect(calls.filter(call => call.url.endsWith('/api/v1/extensions/reviews/create')).at(-1)?.body)
      .toMatchObject({ parent_review_id: 'rvw_root', text_content: '回复内容' })
  })

  it('rejects an extension owner rating before creating the home Record', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const fetchImpl = vi.fn<typeof fetch>(async input => {
      expect(String(input)).toBe('https://extension.test/api/public/v1/extensions/detail')
      return json({ code: 0, data: { extension: {
        extension_id: 'ext-review-owner', owner_user_id: 10001, name: '我的扩展', description: '', visibility: 'public',
      } } })
    })
    const service = new ArkmeService(
      { ...config, extensionPublishBaseUrl: 'https://extension.test' }, sessions, state, fetchImpl,
    )

    await expect(service.createExtensionReview({
      extensionId: 'ext-review-owner', textContent: '不能自评', rating: 4,
      clientMutationId: 'review-owner-mutation-0001',
    })).rejects.toMatchObject({
      code: 'extension-review-owner-forbidden', retryable: false, httpStatus: 403,
    })
    expect(await state.listExtensionReviewOperations(10001)).toEqual([])
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('preserves a terminal registry rejection and removes its retry operation', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const urls: string[] = []
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      urls.push(url)
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      if (url.endsWith('/api/public/v1/extensions/detail')) return json({ code: 0, data: { extension: {
        extension_id: body.extension_id, owner_user_id: 20002, name: '他人扩展', description: '', visibility: 'public',
      } } })
      if (url.endsWith('/api/v1/records/create')) {
        return json({ code: 0, data: { record_uid: body.record_uid, status: 1 } })
      }
      if (url.endsWith('/api/v1/extensions/reviews/create')) {
        return json({ code: 40301, message: '无权执行该操作', data: null }, 403)
      }
      throw new Error(`unexpected ${url}`)
    })
    const service = new ArkmeService(
      { ...config, extensionPublishBaseUrl: 'https://extension.test' }, sessions, state, fetchImpl,
    )

    await expect(service.createExtensionReview({
      extensionId: 'ext-review-terminal', textContent: '服务拒绝', rating: 4,
      clientMutationId: 'review-terminal-mutation-0001',
    })).rejects.toMatchObject({
      code: 'extension-review-registry-rejected', retryable: false, httpStatus: 403,
    })
    expect(await state.listExtensionReviewOperations(10001)).toEqual([])
    expect(urls).not.toContain('https://auth.test/api/v1/auth/refresh-token')
  })

  it('preserves an extension service validation error so the calling agent can correct the package', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const service = new ArkmeService(
      { ...config, extensionPublishBaseUrl: 'https://extension.test' },
      sessions,
      new MemoryStateStore(),
      async (input, init) => {
        expect(String(input)).toBe('https://extension.test/api/v1/extensions/publish-session/complete')
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access')
        return json({ code: 40001, message: 'client.js 禁止 import 或 require', data: null }, 400)
      },
    )

    await expect(service.extensionPost('/api/v1/extensions/publish-session/complete', {
      publish_session_id: 'pub_test',
    })).rejects.toMatchObject({
      code: 'arkme-code-40001',
      message: 'client.js 禁止 import 或 require（服务错误码 40001）',
      retryable: false,
      httpStatus: 400,
    } satisfies Partial<ArkmePluginError>)
  })

  it('reads the recording calendar from the Audio origin with bearer authorization', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('https://audio.test/api/v1/audio/get-calender-summary')
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access')
      expect(JSON.parse(String(init?.body))).toEqual({ from_stamp: 1_700_000_000_000, to_stamp: 1_700_172_800_000 })
      return json({ code: 200, data: {
        duration_ls: [0, 90_000],
        un_click_session_ids_per_day: [[], ['session-1', 'session-2']],
      } })
    })
    const service = new ArkmeService(config, sessions, state, fetchImpl)

    await expect(service.recordingCalendar(1_700_000_000_000, 1_700_172_800_000)).resolves.toEqual({
      fromStamp: 1_700_000_000_000,
      toStamp: 1_700_172_800_000,
      days: [
        { dateStamp: 1_700_000_000_000, durationMillis: 0, hasRecording: false, unreviewedCount: 0 },
        { dateStamp: 1_700_086_400_000, durationMillis: 90_000, hasRecording: true, unreviewedCount: 2 },
      ],
    })
  })

  it('loads the desktop 1970-01 lower-bound calendar and day transcript', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const lowerBound = new Date(1970, 0, 1).getTime()
    const timezoneOffset = -new Date(lowerBound).getTimezoneOffset() * 60_000
    const bodies: Record<string, unknown>[] = []
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      bodies.push(body)
      const url = String(input)
      if (url.endsWith('/api/v1/audio/get-calender-summary')) {
        return json({ code: 200, data: { duration_ls: [], un_click_session_ids_per_day: [] } })
      }
      if (url.endsWith('/api/v1/audio/one-day-trans')) {
        return json({ code: 200, data: { session_ls: [], child_ls: [] } })
      }
      if (url.endsWith('/api/v1/audio/get-speaker-ls')) {
        return json({ code: 200, data: { spk_ls: [] } })
      }
      throw new Error(`unexpected URL ${url}`)
    })

    await expect(service.recordingCalendar(lowerBound, lowerBound + 24 * 60 * 60 * 1_000))
      .resolves.toMatchObject({ fromStamp: lowerBound, days: [] })
    await expect(service.recordingTranscript(lowerBound)).resolves.toMatchObject({ state: 'empty', items: [] })
    expect(bodies).toContainEqual({ from_stamp: lowerBound, to_stamp: lowerBound + 24 * 60 * 60 * 1_000 })
    expect(bodies).toContainEqual({
      start_at: lowerBound,
      tz_offset: timezoneOffset === 0 ? 0 : timezoneOffset,
    })
  })

  it('reads record calendar buckets and day records from the Record origin', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const requests: Array<{ url: string; body: Record<string, unknown>; authorization: string }> = []
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({
        url: String(input),
        body,
        authorization: new Headers(init?.headers).get('Authorization') ?? '',
      })
      if (String(input).endsWith('/api/v1/records/privacy/visibility-snapshot')) {
        return json({ code: 0, data: { items: [], has_more: false } })
      }
      if (String(input).endsWith('/api/v1/calendar/buckets/query')) {
        return json({ code: 200, data: {
          timezone: 'Asia/Shanghai',
          daily_data: [{ bucket_date: '2026-08-21', count: 41, protected_count: 2, first_send_at: 1_787_310_000_000 }],
        } })
      }
      if (String(input).endsWith('/api/v1/calendar/records/query')) {
        return json({ code: 200, data: {
          timezone: 'Asia/Shanghai',
          items: [{
            record_uid: 'record-1',
            send_at: 1_787_310_000_000,
            is_uncategorized: true,
            record_core: {
              record_uid: 'record-1',
              send_at: 1_787_310_000_000,
              content_access_state: 1,
              title: '会议纪要',
              text_content: '讨论日历迁移',
              creation_source: 2,
              template_kind: 1,
              display_kind: 0,
              has_manual_edit: false,
              has_polish: true,
            },
            topic_core: { title: '前端重构' },
          }],
          has_more: true,
          next_cursor_send_at: 1_787_300_000_000,
          next_cursor_record_uid: 'record-next',
        } })
      }
      throw new Error(`unexpected ${String(input)}`)
    })

    await expect(service.calendarBuckets({
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      timezone: 'Asia/Shanghai',
    })).resolves.toMatchObject({
      scope: 'self',
      days: [{ bucketDate: '2026-08-21', count: 39, protectedCount: 0, hasRecords: true }],
    })
    await expect(service.calendarRecords({
      bucketDate: '2026-08-21',
      timezone: 'Asia/Shanghai',
      limit: 10,
      cursor: { sendAtMillis: 1_787_300_000_000, recordUid: 'record-next' },
    })).resolves.toMatchObject({
      scope: 'self',
      items: [{ recordUid: 'record-1', title: '会议纪要', textContent: '讨论日历迁移', topicTitle: '前端重构' }],
      nextCursor: { sendAtMillis: 1_787_300_000_000, recordUid: 'record-next' },
    })
    expect(requests.filter(item => !item.url.endsWith('/api/v1/records/privacy/visibility-snapshot'))).toMatchObject([
      {
        url: 'https://record.test/api/v1/calendar/buckets/query',
        authorization: 'Bearer access',
        body: {
          bucket_scope_kind: 1,
          bucket_scope_uid: '',
          start_date: '2026-08-01',
          end_date: '2026-08-31',
          timezone: 'Asia/Shanghai',
        },
      },
      {
        url: 'https://record.test/api/v1/calendar/records/query',
        authorization: 'Bearer access',
        body: {
          bucket_scope_kind: 1,
          bucket_scope_uid: '',
          bucket_date: '2026-08-21',
          timezone: 'Asia/Shanghai',
          limit: 10,
          cursor_send_at: 1_787_300_000_000,
          cursor_record_uid: 'record-next',
        },
      },
    ])
  })

  it('invalidates calendar cache and notifies clients after DSH Agent input is created', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    let calendarText = '旧缓存'
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url: String(input), body })
      if (String(input).endsWith('/api/v1/records/privacy/visibility-snapshot')) {
        return json({ code: 0, data: { items: [], has_more: false } })
      }
      if (String(input).endsWith('/api/v1/calendar/records/query')) {
        return json({ code: 200, data: {
          timezone: 'Asia/Shanghai',
          items: [{
            record_uid: 'record-calendar',
            send_at: 1_787_623_692_290,
            record_core: {
              record_uid: 'record-calendar',
              send_at: 1_787_623_692_290,
              content_access_state: 1,
              title: '',
              text_content: calendarText,
              creation_source: calendarText === '旧缓存' ? 0 : 3,
              template_kind: 1,
              display_kind: 0,
            },
          }],
          has_more: false,
        } })
      }
      if (String(input).endsWith('/api/v1/records/dsh-agent-input/create')) {
        calendarText = String(body.text_content)
        return json({ code: 0, data: { record_uid: body.record_uid, status: 1 } })
      }
      throw new Error(`unexpected ${String(input)}`)
    })
    const events: unknown[] = []
    service.subscribeChatRealtime(event => { events.push(event) })

    await expect(service.calendarRecords({
      bucketDate: '2026-08-25',
      timezone: 'Asia/Shanghai',
      limit: 20,
    })).resolves.toMatchObject({ items: [{ textContent: '旧缓存', creationSource: 0 }] })
    await expect(service.createDSHAgentInputText(
      'dc6eb132-1c9d-501d-a0d0-2fae884de198',
      '你好',
      1_787_623_692_290,
    )).resolves.toMatchObject({ recordUid: 'dc6eb132-1c9d-501d-a0d0-2fae884de198', status: 1 })
    await expect(service.calendarRecords({
      bucketDate: '2026-08-25',
      timezone: 'Asia/Shanghai',
      limit: 20,
    })).resolves.toMatchObject({ items: [{ textContent: '你好', creationSource: 3 }] })

    expect(requests.filter(item => item.url.endsWith('/api/v1/calendar/records/query'))).toHaveLength(2)
    expect(events).toEqual([expect.objectContaining({ type: 'projection-invalidated', projection: 'record' })])
  })

  it('loads recording day sections independently and refreshes an expired Audio bearer', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'expired', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const requests: Array<{ url: string; authorization: string; body: Record<string, unknown> }> = []
    let rejected = false
    const dayStamp = new Date(2023, 10, 15).getTime()
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      const authorization = new Headers(init?.headers).get('Authorization') ?? ''
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, authorization, body })
      if (url === 'https://audio.test/api/v1/audio/one-day-trans' && !rejected) {
        rejected = true
        return json({}, 401)
      }
      if (url === 'https://auth.test/api/public/v1/auth/new-short') {
        return json({ code: 200, data: { access_token: 'renewed' } })
      }
      if (url.endsWith('/api/v1/audio/one-day-trans')) {
        return json({ code: 200, data: {
          session_ls: [{ id: 'session-1', start_at: dayStamp + 1_000, duration: 6_000, belong_usr: 10001,
            spk_ls: [{ num: 1, spk_id: 'speaker-1' }] }],
          child_ls: [{ id: 'child-1', session_id: 'session-1', start_at: 500,
            asr: [{ s: 100, e: 800, n: 1, t: '今天很顺利', b: 0 }] }],
        } })
      }
      if (url.endsWith('/api/v1/audio/get-speaker-ls')) {
        return json({ code: 200, data: { spk_ls: [{ id: 'speaker-1', ref_usr_id: 20002, nick_name: '英梦华' }] } })
      }
      if (url.endsWith('/api/v1/auth/get-public-users-by-ids')) {
        return json({ code: 200, data: { items: [{
          user_id: 20002, nick_name: 'Jotmoer',
          head_img: 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/avatar.png?x-oss-signature=sig',
        }] } })
      }
      if (url.endsWith('/api/v1/summary/list-timeline-by-range') && body.kind === 1) {
        return json({ code: 200, data: { audio_summary_ls: [
          { id: 'timeline-1', kind: 1, status: 2, update_at: dayStamp + 5_000, answer: '09:00-09:30 早会' },
        ] } })
      }
      if (url.endsWith('/api/v1/summary/list-timeline-by-range') && body.kind === 2) {
        return json({ code: 500, message: '总结服务暂不可用' })
      }
      throw new Error(`unexpected URL ${url}`)
    })

    const day = await service.recordingDay(dayStamp)
    expect(day).toMatchObject({
      dateStamp: dayStamp,
      totalDurationMillis: 6_000,
      transcript: { state: 'ready', items: [{
        speakerLabel: '英梦华', speakerAvatarRef: expect.stringMatching(/^arkme-profile-image-v1\./), startAtMillis: dayStamp + 1_600,
      }] },
      timeline: { state: 'ready', items: [{ id: 'timeline-1', selectable: true }] },
      summary: { state: 'error', items: [] },
    })
    expect(sessions.session?.accessToken).toBe('renewed')
    expect(requests.filter(item => item.url.endsWith('/one-day-trans')).map(item => item.authorization))
      .toEqual(['Bearer expired', 'Bearer renewed'])
    expect(requests.filter(item => item.url.endsWith('/list-timeline-by-range')).map(item => item.body.kind).sort())
      .toEqual([1, 2])
  })

  it('refreshes and retries an Audio request rejected with HTTP 403', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'expired', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const authorizations: string[] = []
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      if (url === 'https://auth.test/api/public/v1/auth/new-short') {
        return json({ code: 200, data: { access_token: 'renewed' } })
      }
      authorizations.push(new Headers(init?.headers).get('Authorization') ?? '')
      if (authorizations.length === 1) return json({}, 403)
      return json({ code: 200, data: { duration_ls: [], un_click_session_ids_per_day: [] } })
    })

    await expect(service.recordingCalendar(1_700_000_000_000, 1_700_086_400_000))
      .resolves.toMatchObject({ days: [] })
    expect(authorizations).toEqual(['Bearer expired', 'Bearer renewed'])
    expect(sessions.session?.accessToken).toBe('renewed')
  })

  it('honors Retry-After as a service-wide admission cooldown', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    try {
      const sessions = new MemorySessionStore()
      sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
      const startedAt: number[] = []
      const service = new ArkmeService(config, sessions, new MemoryStateStore(), async () => {
        startedAt.push(Date.now())
        if (startedAt.length === 1) {
          return new Response('{}', { status: 429, headers: { 'Retry-After': '1' } })
        }
        return json({ code: 200, data: { duration_ls: [], un_click_session_ids_per_day: [] } })
      })
      const first = service.recordingCalendar(1_700_000_000_000, 1_700_086_400_000).catch(error => error as Error)
      await vi.advanceTimersByTimeAsync(0)
      await expect(first).resolves.toMatchObject({ upstreamStatus: 429, retryAfterMillis: 1_000 })

      const second = service.recordingCalendar(1_700_000_000_000, 1_700_086_400_000)
      await vi.advanceTimersByTimeAsync(999)
      expect(startedAt).toEqual([0])
      await vi.advanceTimersByTimeAsync(1)
      await expect(second).resolves.toMatchObject({ days: [] })
      expect(startedAt).toEqual([0, 1000])
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps transcript rows readable when the speaker directory fails', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const dayStamp = new Date(2023, 10, 15).getTime()
    const service = new ArkmeService(config, sessions, state, async input => {
      const url = String(input)
      if (url.endsWith('/api/v1/audio/get-speaker-ls')) {
        return json({ code: 500, message: '说话人服务暂不可用' })
      }
      return json({ code: 200, data: {
        session_ls: [{ id: 'session-1', start_at: dayStamp, duration: 2_000,
          spk_ls: [{ num: 6, spk_id: 'speaker-6' }] }],
        child_ls: [{ id: 'child-1', session_id: 'session-1', start_at: 0,
          asr: [{ s: 100, e: 900, n: 6, t: '继续讨论' }] }],
      } })
    })

    const transcript = await service.recordingTranscript(dayStamp)
    expect(transcript).toMatchObject({
      state: 'ready',
      identityCoverage: 'partial',
      items: [{ speakerLabel: '说话人 6', text: '继续讨论' }],
    })
    expect(transcript.items[0]).not.toHaveProperty('speakerIdentity')
    expect(transcript.items[0]).not.toHaveProperty('formalSpeakerId')
    expect(transcript.items[0]).not.toHaveProperty('assignmentSpeakerNumber')
  })

  it('seals recording pagination cursors to the signed-in account and rejects tampering', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const service = new ArkmeService(config, sessions, state, async () => {
      throw new Error('not used')
    })
    const payload = {
      version: 1 as const,
      dateStamp: new Date(2026, 7, 17).getTime(),
      content: 'transcript' as const,
      itemOffset: 50,
      textOffset: 0,
      fingerprint: 'transcript-fingerprint',
    }

    const cursor = await service.sealRecordingCursor(payload)
    expect(cursor).toMatch(/^arkme-recording-cursor-v1\./)
    await expect(service.openRecordingCursor(cursor)).resolves.toEqual(payload)

    const [prefix, encoded, signature] = cursor.split('.') as [string, string, string]
    const tamperedSignature = `${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`
    await expect(service.openRecordingCursor(`${prefix}.${encoded}.${tamperedSignature}`))
      .rejects.toMatchObject({ code: 'recording-cursor-invalid' })

    sessions.session = { userId: 10002, accessToken: 'other', refreshToken: 'other-refresh' }
    await expect(service.openRecordingCursor(cursor))
      .rejects.toMatchObject({ code: 'recording-cursor-invalid' })
  })

  it('completes QR login without exposing tokens in the auth snapshot', async () => {
    const sessions = new MemorySessionStore()
    const state = new MemoryStateStore()
    let scans = 0
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      requests.push({ url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> })
      if (url.endsWith('/wechat-oauth-login-qrcode')) {
        return json({
          code: 200,
          data: {
            url: 'https://jiwo.cc/app/login/wechat-desktop?scene_str=scene-1&target=test',
            scene_str: 'scene-1',
            poll_token: 'poll-secret',
            expire_seconds: 300,
          },
        })
      }
      if (url.endsWith('/wechat-oauth-login-poll')) {
        scans += 1
        return scans === 1
          ? json({ code: 200, data: { user_id: 0 } })
          : json({ code: 200, data: { user_id: 10001, access_token: 'access-secret', refresh_token: 'refresh-secret' } })
      }
      if (url.endsWith('/get-user-info')) return json({ code: 200, data: userInfo(10001) })
      throw new Error(`unexpected URL ${url}`)
    }
    const service = new ArkmeService(config, sessions, state, fetchImpl)

    const begun = await service.beginWechatLogin()
    expect(begun).toMatchObject({
      status: 'pending',
      qrContent: 'https://jiwo.cc/app/login/wechat-desktop?scene_str=scene-1&target=test',
    })
    expect(JSON.stringify(begun)).not.toContain('secret')
    expect(await service.pollWechatLogin(begun.attemptId!)).toMatchObject({ status: 'pending' })
    const authenticated = await service.pollWechatLogin(begun.attemptId!)
    expect(authenticated).toEqual({ status: 'authenticated', environment: 'test', userId: 10001 })
    expect(sessions.session).toEqual({ userId: 10001, accessToken: 'access-secret', refreshToken: 'refresh-secret' })
    expect(requests.find(request => request.url.endsWith('/wechat-oauth-login-poll'))?.body)
      .toMatchObject({ scene_str: 'scene-1', poll_token: 'poll-secret', unique_code: 'dsh-device-1' })
  })

  it('publishes a versioned provider capability and revision state', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    state.revisionValue = 9
    const service = new ArkmeService(config, sessions, state, async input => {
      expect(String(input)).toBe('https://auth.test/api/v1/auth/get-user-info')
      return json({ code: 200, data: userInfo(10001) })
    })

    expect(service.providerCapabilities()).toMatchObject({
      contractVersion: 1,
      provider: '@senguoyun/dsh-arkme',
      sdk: '@senguoyun/dsh-arkme/sdk',
      features: {
        cachedSnapshot: true,
        revisionPolling: true,
        userProfile: true,
        imageRead: true,
        recordCalendar: true,
        messageReadReceipts: true,
        messageReport: true,
        userBanManagement: true,
        groupOwnerGovernance: true,
        outgoingCall: true,
        contactAdd: true,
        conversationQuickAdd: true,
        myExtensions: true,
        extensionPublish: true,
        extensionManagement: true,
        extensionMetadataEdit: true,
        extensionIcons: true,
        extensionPreviews: true,
      },
      limits: { maxImageBytes: 2 * 1024 * 1024, maxMessageReadReceiptItems: 50 },
    })
    await expect(service.providerState()).resolves.toEqual({
      contractVersion: 1,
      environment: 'test',
      authStatus: 'authenticated',
      userId: 10001,
      revision: 10,
    })
  })

  it('publishes auth client config with the test-login guard', async () => {
    const service = new ArkmeService(config, new MemorySessionStore(), new MemoryStateStore(), async () => {
      throw new Error('not used')
    })

    expect(service.clientConfig()).toEqual({
      captchaId: 'captcha-test-id-1234567890',
      environment: 'test',
      testLoginEnabled: true,
      jiwoScanLoginEnabled: false,
      callAssetBasePath: '/arkme-self/api/call',
      voiceprintEnrollmentPath: '/arkme-self/api/voiceprint/enroll',
      recordingImportPath: '/arkme-self/api/recording/import',
      mediaPath: '/arkme-self/api/media',
      shareWebsite: 'https://app.arkme.ai',
      recordingWorkbenchEnabled: true,
    })
  })

  it('prepares an outgoing video call from a fresh Arkme private-chat source', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, body })
      if (url.endsWith('/api/v1/chats/detail')) return json({ code: 200, data: {
        session: { chat_session_uid: 'chat-private-1', session_kind: 1 },
        private_counterpart: { user_id: 20002, display_name_snapshot: '接口昵称' },
        private_supplement: { remark: '小林' },
      } })
      if (url.endsWith('/api/v1/auth/get-user-info')) return json({ code: 200, data: {
        ...userInfo(10001), nick_name: '我的昵称', head_img: '10001_avatar.png',
      } })
      if (url.endsWith('/api/v1/auth/get-public-users-by-ids')) return json({ code: 200, data: { items: [{
        user_id: 20002,
        nick_name: '公开昵称',
        head_img: 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/avatar.png?x-oss-signature=sig',
      }] } })
      if (url.endsWith('/api/v1/trtc/credentials')) return json({ code: 200, data: {
        sdk_app_id: 1400001, user_id: 'me__c1', user_sig: 'user-sig-secret',
      } })
      if (url.endsWith('/api/v1/trtc/create-room')) return json({ code: 200, data: {
        room_id: 'room-private-1', shared_topic_id: 99, callee_accounts: ['peer__c2'],
      } })
      throw new Error(`unexpected URL ${url}`)
    })

    const result = await service.prepareOutgoingCall({
      sourceRef: sourceRefFor('private_chat', 'chat-private-1', '旧名称'),
      mediaType: 'video',
      callRequestId: 'request-1',
    })

    expect(requests.map(item => item.url)).toEqual([
      'https://chat.test/api/v1/chats/detail',
      'https://auth.test/api/v1/auth/get-user-info',
      'https://auth.test/api/v1/auth/get-public-users-by-ids',
      'https://auth.test/api/v1/auth/get-public-users-by-ids',
      'https://webrtc.test/api/v1/trtc/credentials',
      'https://webrtc.test/api/v1/trtc/create-room',
    ])
    expect(requests.at(-1)?.body).toMatchObject({
      chat_session_uid: 'chat-private-1',
      callee_user_ids: [20002],
      call_media_type: 1,
      caller_name: '我的昵称',
    })
    expect(result).toMatchObject({
      callRequestId: 'request-1',
      displayName: '小林',
      peerAvatarRef: expect.stringMatching(/^arkme-profile-image-v1\./),
      bootstrap: {
        sdkAppId: 1400001,
        userId: 'me__c1',
        userSig: 'user-sig-secret',
        nickName: '我的昵称',
        avatar: '',
        outgoingOnly: true,
      },
      call: {
        roomId: 'room-private-1',
        mediaType: 'video',
        calleeAccounts: ['peer__c2'],
        calleeName: '小林',
        callerName: '我的昵称',
        timeoutSec: 30,
      },
    })
  })

  it('rejects a non-private outgoing source before contacting remote services', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const fetchImpl = vi.fn<typeof fetch>()
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), fetchImpl)

    await expect(service.prepareOutgoingCall({
      sourceRef: sourceRefFor('group_chat', 'group-1', '项目群'),
      mediaType: 'audio',
      callRequestId: 'request-1',
    })).rejects.toMatchObject({ code: 'call-source-invalid' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('returns only safe fields when a tool intent reaches calling', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async () => {
      throw new Error('not used')
    })
    const pending = service.requestOutgoingCall(
      sourceRefFor('private_chat', 'chat-private-1', '小林'),
      'video',
    )
    let claim: Awaited<ReturnType<ArkmeService['claimOutgoingCallIntent']>> = null
    await vi.waitFor(async () => {
      claim = await service.claimOutgoingCallIntent()
      expect(claim).not.toBeNull()
    })
    await service.resolveOutgoingCallIntent({
      intentId: claim!.intentId,
      claimToken: claim!.claimToken,
      outcome: { status: 'calling' },
    })

    await expect(pending).resolves.toEqual({ status: 'calling', displayName: '小林', mediaType: 'video' })
  })

  it('logs in with a test user only on the test environment', async () => {
    const sessions = new MemorySessionStore()
    const state = new MemoryStateStore()
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, body })
      if (url.endsWith('/get-user-info')) return json({ code: 200, data: userInfo(10009, '') })
      return json({ code: 200, data: { access_token: 'test-access', refresh_token: 'test-refresh' } })
    })

    await expect(service.testLogin(10009)).resolves.toEqual({
      status: 'binding-required',
      environment: 'test',
      userId: 10009,
    })
    expect(requests[0]).toMatchObject({
      url: 'https://auth.test/api/public/v1/auth/the-best-api-for-testing',
    })
    expect(requests[0]?.body).toEqual({
      user_id: 10009,
      unique_code: 'dsh-device-1',
      ref: 0,
      keep_cancel: true,
    })
    expect(sessions.session).toBeUndefined()
    const profileRequestCount = requests.filter(request => request.url.endsWith('/get-user-info')).length
    await expect(service.authStatus()).resolves.toEqual({
      status: 'binding-required',
      environment: 'test',
      userId: 10009,
    })
    expect(requests.filter(request => request.url.endsWith('/get-user-info'))).toHaveLength(profileRequestCount)
    await expect(service.cachedSnapshot()).rejects.toMatchObject({ code: 'login-required' })

    const prodService = new ArkmeService({ ...config, environment: 'prod' }, sessions, state, async () => {
      throw new Error('not used')
    })
    await expect(prodService.testLogin(10009)).rejects.toMatchObject({ code: 'test-login-disabled' })
  })

  it('promotes a pending binding session only after phone binding succeeds', async () => {
    const sessions = new MemorySessionStore()
    const state = new MemoryStateStore()
    let bound = false
    const requests: Array<{ url: string; authorization?: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      const headers = new Headers(init?.headers)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, authorization: headers.get('Authorization') ?? undefined, body })
      if (url.endsWith('/the-best-api-for-testing')) {
        return json({ code: 200, data: { access_token: 'pending-access', refresh_token: 'pending-refresh' } })
      }
      if (url.endsWith('/get-user-info')) return json({ code: 200, data: userInfo(10010, bound ? '13800138000' : '') })
      if (url.endsWith('/bind-phone-send-code')) return json({ code: 200, data: { result: 1 } })
      if (url.endsWith('/verify-bind-phone')) {
        bound = true
        return json({ code: 200, data: { result: 1 } })
      }
      throw new Error(`unexpected URL ${url}`)
    })

    await expect(service.testLogin(10010)).resolves.toEqual({
      status: 'binding-required',
      environment: 'test',
      userId: 10010,
    })
    expect(sessions.session).toBeUndefined()

    const captcha = {
      lot_number: 'lot-1',
      captcha_output: 'output-1',
      pass_token: 'pass-1',
      gen_time: '1700000000',
    }
    await expect(service.sendPhoneCode('13800138000', captcha)).resolves.toEqual({ sent: true })
    await expect(service.verifyPhoneCode('13800138000', '123456')).resolves.toEqual({
      status: 'authenticated',
      environment: 'test',
      userId: 10010,
    })
    expect(sessions.session).toEqual({ userId: 10010, accessToken: 'pending-access', refreshToken: 'pending-refresh' })
    expect(requests.find(request => request.url.endsWith('/bind-phone-send-code'))?.authorization).toBe('Bearer pending-access')
    expect(requests.find(request => request.url.endsWith('/verify-bind-phone'))?.authorization).toBe('Bearer pending-access')
  })

  it('restores a pending binding session after the provider is recreated', async () => {
    const sessions = new MemorySessionStore()
    const pendingSessions = new MemorySessionStore()
    const state = new MemoryStateStore()
    const requests: Array<{ url: string; authorization?: string; body: Record<string, unknown> }> = []
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      const headers = new Headers(init?.headers)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, authorization: headers.get('Authorization') ?? undefined, body })
      if (url.endsWith('/the-best-api-for-testing')) {
        return json({ code: 200, data: { access_token: 'pending-access', refresh_token: 'pending-refresh' } })
      }
      if (url.endsWith('/get-user-info')) return json({ code: 200, data: userInfo(10012, '') })
      throw new Error(`unexpected URL ${url}`)
    }
    const service = new ArkmeService(config, sessions, state, fetchImpl, pendingSessions)

    await expect(service.testLogin(10012)).resolves.toEqual({
      status: 'binding-required',
      environment: 'test',
      userId: 10012,
    })
    expect(sessions.session).toBeUndefined()
    expect(pendingSessions.session).toEqual({
      userId: 10012,
      accessToken: 'pending-access',
      refreshToken: 'pending-refresh',
    })

    const recreated = new ArkmeService(config, sessions, state, fetchImpl, pendingSessions)
    const profileRequestCount = requests.filter(request => request.url.endsWith('/get-user-info')).length
    await expect(recreated.authStatus()).resolves.toEqual({
      status: 'binding-required',
      environment: 'test',
      userId: 10012,
    })
    await expect(recreated.cachedSnapshot()).rejects.toMatchObject({ code: 'login-required' })
    expect(requests.filter(request => request.url.endsWith('/get-user-info'))).toHaveLength(profileRequestCount)
  })

  it('demotes a legacy active session when the profile still requires phone binding', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10011, accessToken: 'legacy-access', refreshToken: 'legacy-refresh' }
    const state = new MemoryStateStore()
    const service = new ArkmeService(config, sessions, state, async input => {
      expect(String(input)).toBe('https://auth.test/api/v1/auth/get-user-info')
      return json({ code: 200, data: userInfo(10011, '') })
    })

    await expect(service.authStatus()).resolves.toEqual({
      status: 'binding-required',
      environment: 'test',
      userId: 10011,
    })
    expect(sessions.session).toBeUndefined()
    await expect(service.cachedSnapshot()).rejects.toMatchObject({ code: 'login-required' })
  })

  it('reads an authenticated active session from the cached profile without another remote request', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10013, accessToken: 'active-access', refreshToken: 'active-refresh' }
    const state = new MemoryStateStore()
    let profileRequests = 0
    const service = new ArkmeService(config, sessions, state, async input => {
      expect(String(input)).toBe('https://auth.test/api/v1/auth/get-user-info')
      profileRequests += 1
      return json({ code: 200, data: userInfo(10013) })
    })

    await expect(service.refreshProfile()).resolves.toMatchObject({ profile: { userId: 10013 } })
    await expect(service.authStatus()).resolves.toEqual({
      status: 'authenticated',
      environment: 'test',
      userId: 10013,
    })
    expect(profileRequests).toBe(1)
  })

  it('reads and caches only a safe masked user profile projection', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      expect(String(input)).toBe('https://auth.test/api/v1/auth/get-user-info')
      expect(init?.method).toBe('GET')
      return json({
        code: 200,
        data: {
          user_id: 10001,
          nick_name: '昵称',
          real_name: '完整真实姓名',
          head_img: 'avatar-file-id',
          name_slug: 'legacy-name-slug',
          jotmo_id: 'arkme-10001',
          can_update_jotmo_id: true,
          type: 1,
          create_at: 123,
          phone: '13800138000',
          email: 'test@example.com',
          has_bind_apple: true,
          has_bind_wechat: true,
          wechat_nick_name: '微信昵称',
          has_bind_google: true,
        },
      })
    })

    const snapshot = await service.refreshProfile()
    expect(snapshot.profile).toEqual({
      userId: 10001,
      displayName: '昵称',
      nickname: '昵称',
      avatarRef: 'avatar-file-id',
      arkmeId: 'arkme-10001',
      canUpdateArkmeId: true,
      accountType: 1,
      createdAt: 123,
      bindings: { apple: true, wechat: true, google: true },
      bindingNames: { wechat: '微信昵称' },
      contact: { phoneMasked: '138****8000', emailMasked: 't***@example.com' },
    })
    expect(JSON.stringify(snapshot)).not.toContain('完整真实姓名')
    expect(JSON.stringify(snapshot)).not.toContain('13800138000')
    expect(JSON.stringify(snapshot)).not.toContain('test@example.com')
    await expect(service.cachedProfile()).resolves.toEqual(snapshot)
  })

  it('single-flights and TTL-caches authenticated profile reads', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const fetchImpl = vi.fn<typeof fetch>(async input => {
      expect(String(input)).toBe('https://auth.test/api/v1/auth/get-user-info')
      return json({ code: 200, data: userInfo(10001) })
    })
    const service = new ArkmeService(config, sessions, state, fetchImpl)

    const [first, concurrent, provider] = await Promise.all([
      service.authStatus(), service.authStatus(), service.providerState(),
    ])
    expect(first).toMatchObject({ status: 'authenticated', userId: 10001 })
    expect(concurrent).toEqual(first)
    expect(provider).toMatchObject({ authStatus: 'authenticated', userId: 10001 })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    await expect(service.authStatus()).resolves.toEqual(first)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('falls back to the legacy name slug when the Arkme ID is absent', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const service = new ArkmeService(config, sessions, state, async () => json({
      code: 200,
      data: {
        user_id: 10001,
        nick_name: '昵称',
        name_slug: 'legacy-name-slug',
        type: 1,
      },
    }))

    const snapshot = await service.refreshProfile()

    expect(snapshot.profile?.arkmeId).toBe('legacy-name-slug')
    expect(snapshot.profile).not.toHaveProperty('canUpdateArkmeId')
    await expect(service.cachedProfile()).resolves.toEqual(snapshot)
  })

  it('checks availability and sets the current user Arkme ID once', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const calls: Array<{ url: string; method?: string; body?: Record<string, unknown> }> = []
    let profileReads = 0
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      calls.push({
        url,
        ...(init?.method === undefined ? {} : { method: init.method }),
        ...(init?.body === undefined ? {} : {
          body: JSON.parse(String(init.body)) as Record<string, unknown>,
        }),
      })
      if (url.endsWith('/get-user-info')) {
        profileReads += 1
        return json({
          code: 200,
          data: {
            user_id: 10001,
            nick_name: '昵称',
            name_slug: 'legacy-name-slug',
            jotmo_id: profileReads === 1 ? 'legacy-name-slug' : 'New_id-01',
            can_update_jotmo_id: profileReads === 1,
            type: 1,
          },
        })
      }
      if (url.endsWith('/check-jotmo-id-available')) {
        return json({ code: 200, data: { available: true, name: 'New_id-01' } })
      }
      if (url.endsWith('/update-jotmo-id')) {
        return json({ code: 200, data: { name: 'New_id-01' } })
      }
      throw new Error(`unexpected ${url}`)
    })

    await expect(service.setArkmeIdOnce('  New_id-01  ')).resolves.toMatchObject({
      arkmeId: 'New_id-01',
      changed: true,
      canUpdate: false,
    })
    expect(calls.map(call => [call.method, new URL(call.url).pathname])).toEqual([
      ['GET', '/api/v1/auth/get-user-info'],
      ['POST', '/api/v1/auth/get-public-users-by-ids'],
      ['POST', '/api/v1/auth/check-jotmo-id-available'],
      ['POST', '/api/v1/auth/update-jotmo-id'],
      ['GET', '/api/v1/auth/get-user-info'],
    ])
    expect(calls[2]?.body).toEqual({ name: 'New_id-01', scene: 'user_update' })
    expect(calls[3]?.body).toEqual({ name: 'New_id-01' })
    expect(state.profile).toMatchObject({ arkmeId: 'New_id-01', canUpdateArkmeId: false })
  })

  it('does not consume the one-time change when the requested Arkme ID is already current', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const fetchImpl = vi.fn<typeof fetch>(async () => json({
      code: 200,
      data: {
        user_id: 10001,
        nick_name: '昵称',
        jotmo_id: 'Current_01',
        can_update_jotmo_id: true,
        type: 1,
      },
    }))
    const service = new ArkmeService(config, sessions, state, fetchImpl)

    await expect(service.setArkmeIdOnce('Current_01')).resolves.toMatchObject({
      arkmeId: 'Current_01', changed: false, canUpdate: true,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('rejects an Arkme ID change after the account has used its one-time update', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const fetchImpl = vi.fn<typeof fetch>(async () => json({
      code: 200,
      data: {
        user_id: 10001,
        nick_name: 'Lucis',
        jotmo_id: 'Lucis',
        can_update_jotmo_id: false,
        type: 1,
      },
    }))
    const service = new ArkmeService(config, sessions, state, fetchImpl)

    await expect(service.setArkmeIdOnce('Lucis666')).rejects.toMatchObject({
      code: 'arkme-id-modify-limited', retryable: false, httpStatus: 409,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('aborts the one-time Arkme ID write if the signed-in account changes after profile refresh', async () => {
    const sessions = new MemorySessionStore()
    const firstSession = { userId: 10001, accessToken: 'access-1', refreshToken: 'refresh-1' }
    const secondSession = { userId: 20002, accessToken: 'access-2', refreshToken: 'refresh-2' }
    sessions.session = secondSession
    vi.spyOn(sessions, 'read')
      .mockResolvedValueOnce(firstSession)
      .mockResolvedValueOnce(secondSession)
    const state = new MemoryStateStore()
    const fetchImpl = vi.fn<typeof fetch>(async () => json({
      code: 200,
      data: {
        user_id: 10001,
        nick_name: '旧账号',
        jotmo_id: 'Old_account',
        can_update_jotmo_id: true,
        type: 1,
      },
    }))
    const service = new ArkmeService(config, sessions, state, fetchImpl)

    await expect(service.setArkmeIdOnce('New_account')).rejects.toMatchObject({
      code: 'account-changed', retryable: false, httpStatus: 409,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('validates Arkme IDs locally and maps authoritative availability reasons', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/get-user-info')) return json({
        code: 200,
        data: { user_id: 10001, jotmo_id: 'legacy-id', can_update_jotmo_id: true, type: 1 },
      })
      if (url.endsWith('/check-jotmo-id-available')) return json({
        code: 200,
        data: { available: false, reason: 'taken', name: 'Taken_01' },
      })
      throw new Error(`unexpected ${url}`)
    })
    const service = new ArkmeService(config, sessions, state, fetchImpl)

    await expect(service.setArkmeIdOnce('1bad-id')).rejects.toMatchObject({
      code: 'arkme-id-leading-character-invalid', retryable: false,
    })
    await expect(service.setArkmeIdOnce('Taken_01')).rejects.toMatchObject({
      code: 'arkme-id-taken', retryable: false, httpStatus: 409,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })

  it('reconciles an unknown update outcome by reading back the current Arkme ID', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    let profileReads = 0
    const service = new ArkmeService(config, sessions, state, async (input) => {
      const url = String(input)
      if (url.endsWith('/get-user-info')) {
        profileReads += 1
        return json({
          code: 200,
          data: {
            user_id: 10001,
            jotmo_id: profileReads === 1 ? 'legacy-id' : 'Reconciled_01',
            can_update_jotmo_id: profileReads === 1,
            type: 1,
          },
        })
      }
      if (url.endsWith('/check-jotmo-id-available')) {
        return json({ code: 200, data: { available: true, name: 'Reconciled_01' } })
      }
      if (url.endsWith('/update-jotmo-id')) throw new TypeError('socket closed after write')
      throw new Error(`unexpected ${url}`)
    })

    await expect(service.setArkmeIdOnce('Reconciled_01')).resolves.toMatchObject({
      arkmeId: 'Reconciled_01', changed: true, canUpdate: false,
    })
    expect(profileReads).toBe(2)
  })

  it('authorizes and downloads only the current user private profile image', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const objectPath = 'd89f3a35931c386956c1a402a8e09941/10001/10001_1700000000_1_0.png'
    const requests: Array<{ url: string; authorization?: string; body?: Record<string, unknown> }> = []
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      requests.push({
        url,
        ...(init?.headers === undefined ? {} : {
          authorization: new Headers(init.headers).get('Authorization') ?? undefined,
        }),
        ...(init?.body === undefined ? {} : {
          body: JSON.parse(String(init.body)) as Record<string, unknown>,
        }),
      })
      if (url === 'https://auth.test/api/v1/synch/get/sts-credentials?md_5_user_id=d89f3a35931c386956c1a402a8e09941') {
        return json({
          code: 200,
          data: {
            access_key_id: 'test-access-key-id',
            access_key_secret: 'test-access-key-secret',
            security_token: 'test-security-token',
            expiration: new Date(Date.now() + 60_000).toISOString(),
          },
        })
      }
      if (url.startsWith(`https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/${objectPath}?`)) {
        const parsed = new URL(url)
        expect(parsed.searchParams.get('x-oss-process')).toBe('image/resize,w_512')
        expect(parsed.searchParams.get('security-token')).toBe('test-security-token')
        return new Response(png, {
          status: 200,
          headers: { 'Content-Type': 'image/png', 'Content-Length': String(png.byteLength) },
        })
      }
      throw new Error(`unexpected ${url}`)
    })

    const image = await service.readImage('10001_1700000000_1_0.png')
    expect(image).toMatchObject({ mediaType: 'image/png', bytes: png.byteLength })
    expect(Array.from(image.data)).toEqual(Array.from(png))
    expect(requests[0]).toMatchObject({
      url: 'https://auth.test/api/v1/synch/get/sts-credentials?md_5_user_id=d89f3a35931c386956c1a402a8e09941',
      authorization: 'Bearer access',
    })
    expect(requests[1]?.authorization).toBeUndefined()
    expect(requests[1]?.url).not.toContain('test-access-key-secret')
  })

  it('projects public Team member avatars as account-bound image references', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const avatarUrl = 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/avatar/member.png?x-oss-signature=member-avatar'
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    const requests: string[] = []
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
      const url = String(input)
      requests.push(url)
      if (url.endsWith('/api/v1/auth/get-public-user-by-jotmo-ids')) {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access')
        expect(JSON.parse(String(init?.body))).toEqual({ jotmo_ids: ['member_one', 'member_phone'] })
        return json({ code: 200, data: { items: [
          { user_id: 20001, jotmo_id: 'member_one', nick_name: '成员一', head_img: avatarUrl },
          { user_id: 20002, jotmo_id: 'member_phone', nick_name: '成员二', head_img: 'phone_avatar://v1/7/林' },
        ] } })
      }
      if (url === avatarUrl) return new Response(png, {
        status: 200,
        headers: { 'Content-Type': 'image/png', 'Content-Length': String(png.byteLength) },
      })
      throw new Error(`unexpected ${url}`)
    })

    const presentations = await service.publicAvatarPresentationsByArkmeIds(['member_one', 'member_phone'])
    expect(presentations.get('member_one')).toEqual({ avatarRef: expect.stringMatching(/^arkme-profile-image-v1\./) })
    expect(presentations.get('member_phone')).toEqual({
      avatarFallback: { kind: 'phone_default', colorIndex: 7, label: '林' },
    })
    const imageRef = presentations.get('member_one')!.avatarRef!
    await expect(service.readImage(imageRef)).resolves.toMatchObject({ mediaType: 'image/png', bytes: png.byteLength })
    expect(requests).toEqual([
      'https://auth.test/api/v1/auth/get-public-user-by-jotmo-ids',
      avatarUrl,
    ])
  })

  it('resolves the current user remote profile avatar through its opaque reference', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const avatarUrl = 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/avatar/self.png?x-oss-signature=own-avatar'
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    const service = new ArkmeService(config, sessions, state, async input => {
      const url = String(input)
      if (url.endsWith('/api/v1/auth/get-user-info')) return json({ code: 200, data: {
        user_id: 10001, nick_name: '我', head_img: avatarUrl, name_slug: 'me', type: 1,
      } })
      if (url === avatarUrl) {
        return new Response(png, {
          status: 200,
          headers: { 'Content-Type': 'image/png', 'Content-Length': String(png.byteLength) },
        })
      }
      throw new Error(`unexpected ${url}`)
    })

    const snapshot = await service.refreshProfile()
    const avatarRef = snapshot.profile!.avatarRef

    expect(avatarRef).toMatch(/^arkme-profile-image-v1\./)
    await expect(service.readImage(avatarRef)).resolves.toMatchObject({ mediaType: 'image/png', bytes: png.byteLength })
  })

  it('falls back to the signed-in user file asset avatar when no public avatar is available', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const assetRef = 'file_asset://01a03bce-e704-7073-a083-94ec6362e53d'
    const assetUrl = 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/avatar/self.png?x-oss-signature=asset-avatar'
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      if (url.endsWith('/api/v1/auth/get-user-info')) return json({ code: 200, data: {
        user_id: 10001, nick_name: '我', head_img: assetRef, name_slug: 'me', type: 1,
      } })
      if (url.endsWith('/api/v1/auth/get-public-users-by-ids')) return json({ code: 200, data: {
        items: [{ user_id: 10001, nick_name: '我', head_img: '' }],
      } })
      if (url.endsWith('/api/v1/files/assets/query')) {
        expect(JSON.parse(String(init?.body))).toEqual({ file_asset_uids: [assetRef.slice('file_asset://'.length)] })
        return json({ code: 0, data: { items: [{
          file_asset_uid: assetRef.slice('file_asset://'.length), status: 'ready', mime_type: 'image/png', preview_url: assetUrl,
        }] } })
      }
      if (url === assetUrl) return new Response(png, {
        status: 200, headers: { 'Content-Type': 'image/png', 'Content-Length': String(png.byteLength) },
      })
      throw new Error(`unexpected ${url}`)
    })

    const snapshot = await service.refreshProfile()
    expect(snapshot.profile).toMatchObject({
      avatarRef: expect.stringMatching(/^arkme-profile-image-v1\./), avatarAssetRef: assetRef,
    })
    await expect(service.readImage(snapshot.profile!.avatarRef)).resolves.toMatchObject({ mediaType: 'image/png', bytes: png.byteLength })
  })

  it('rejects cross-user profile image references before signing', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const fetchImpl = vi.fn<typeof fetch>()
    const service = new ArkmeService(config, sessions, state, fetchImpl)

    await expect(service.readImage('20002_1700000000_1_0.jpg')).rejects.toMatchObject({
      code: 'image-owner-mismatch',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects an invalid STS response before contacting OSS', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const fetchImpl = vi.fn<typeof fetch>(async () => json({ code: 200, data: {} }))
    const service = new ArkmeService(config, sessions, state, fetchImpl)

    await expect(service.readImage('10001_1700000000_1_0.png')).rejects.toMatchObject({
      code: 'image-sts-contract-invalid',
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('sends and verifies a mainland phone code with the environment test bypass', async () => {
    const sessions = new MemorySessionStore()
    const state = new MemoryStateStore()
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, body })
      if (url.endsWith('/phone-login-send-code')) return json({ code: 200, data: null })
      if (url.endsWith('/verify-phone-code-login')) {
        return json({
          code: 200,
          data: { ok: true, user_id: 10002, access_token: 'phone-access', refresh_token: 'phone-refresh' },
        })
      }
      if (url.endsWith('/get-user-info')) return json({ code: 200, data: userInfo(10002) })
      throw new Error(`unexpected URL ${url}`)
    })

    const captcha = {
      lot_number: 'lot-1',
      captcha_output: 'output-1',
      pass_token: 'pass-1',
      gen_time: '1700000000',
    }
    await expect(service.sendPhoneCode('138 0013 8000', captcha)).resolves.toEqual({ sent: true })
    await expect(service.verifyPhoneCode('13800138000', '123456')).resolves.toEqual({
      status: 'authenticated', environment: 'test', userId: 10002,
    })
    expect(requests[0]?.body).toEqual({ phone: '13800138000', pre: '86', is_test: true, ...captcha })
    expect(requests[1]?.body).toMatchObject({
      phone: '13800138000', pre: '86', code: '123456', token: '', unique_code: 'dsh-device-1',
    })
  })

  it('binds a phone to the current authenticated user instead of switching accounts', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const requests: Array<{ url: string; authorization?: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const headers = new Headers(init?.headers)
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, authorization: headers.get('Authorization') ?? undefined, body })
      if (url.endsWith('/bind-phone-send-code')) return json({ code: 200, data: { result: 1 } })
      if (url.endsWith('/verify-bind-phone')) return json({ code: 200, data: { result: 1 } })
      if (url.endsWith('/get-user-info')) return json({ code: 200, data: userInfo(10001) })
      throw new Error(`unexpected URL ${url}`)
    })

    const captcha = {
      lot_number: 'lot-1',
      captcha_output: 'output-1',
      pass_token: 'pass-1',
      gen_time: '1700000000',
    }
    await expect(service.sendPhoneCode('138 0013 8000', captcha)).resolves.toEqual({ sent: true })
    await expect(service.verifyPhoneCode('13800138000', '123456')).resolves.toEqual({
      status: 'authenticated', environment: 'test', userId: 10001,
    })
    expect(requests[0]).toMatchObject({
      url: 'https://auth.test/api/v1/auth/bind-phone-send-code',
      authorization: 'Bearer access',
      body: { phone: '13800138000', pre: '86', is_test: true, ...captcha },
    })
    expect(requests[1]).toMatchObject({
      url: 'https://auth.test/api/v1/auth/verify-bind-phone',
      authorization: 'Bearer access',
      body: { phone: '13800138000', pre: '86', code: '123456', is_test: true },
    })
    expect(sessions.session?.userId).toBe(10001)
  })

  it('reads uncategorized records and preserves stable cursor fields', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    let requestBody: Record<string, unknown> = {}
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      if (String(input).endsWith('/api/v1/records/privacy/visibility-snapshot')) {
        return json({ code: 0, data: { items: [], has_more: false } })
      }
      requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      return json({
        code: 0,
        data: {
          items: [{
            record_uid: 'record-1',
            send_at: 123,
            record_core: { text_content: 'hello', title: '', template_kind: 1, status: 1, version: 2 },
          }],
          has_more: true,
          next_cursor_send_at: 120,
          next_cursor_record_uid: 'record-next',
        },
      })
    })

    const result = await service.list(30, { sendAtMillis: 200, recordUid: 'cursor-record' })
    expect(requestBody).toEqual({
      limit: 30, cursor_send_at: 200, cursor_record_uid: 'cursor-record',
    })
    expect(result.items[0]).toMatchObject({ recordUid: 'record-1', textContent: 'hello', version: 2 })
    expect(result.nextCursor).toEqual({ sendAtMillis: 120, recordUid: 'record-next' })
    expect(state.cached.get(10001)?.[0]).toMatchObject({ recordUid: 'record-1', textContent: 'hello' })
  })

  it('lists and reads the send-to-self aggregate separately from default-category and topic sources', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      calls.push({ url, body })
      if (url.endsWith('/api/v1/records/privacy/visibility-snapshot')) {
        return json({ code: 0, data: { items: [], has_more: false } })
      }
      if (url.endsWith('/api/v1/topics/display/list')) return json({ code: 0, data: { items: [{
        topic_core: { topic_uid: 'topic-1', title: '工作', update_at: 100 },
        summary: { record_count: 2, latest_send_at: 109 },
        latest_record_core: { record_uid: 'record-latest', text_content: '最近内容', send_at: 109 },
      }, {
        topic_core: { topic_uid: 'topic-child', title: '周报', update_at: 98 },
        summary: { record_count: 1, latest_send_at: 97 },
      }, {
        topic_core: { topic_uid: 'topic-empty', title: '空主题', update_at: 999 },
        summary: { record_count: 0 },
      }] } })
      if (url.endsWith('/api/v1/topics/hierarchy/relations/list')) return json({ code: 0, data: { relations: [{
        rel_uid: 'relation-1', parent_topic_uid: 'topic-1', child_topic_uid: 'topic-child',
        rel_kind: 1, status: 1, sibling_order: 1,
      }] } })
      if (url.endsWith('/api/v1/records/uncategorized/summary')) {
        return json({ code: 0, data: { record_count: 7, words_count: 20, total_sec: 0 } })
      }
      if (url.endsWith('/api/v1/records/uncategorized/query')) return json({ code: 0, data: {
        items: [{
          record_uid: 'default-latest', send_at: 101,
          record_core: { title: '', text_content: '默认分类最近内容', template_kind: 1, status: 1, version: 1 },
        }],
        has_more: true,
      } })
      if (url.endsWith('/api/v1/home/feed/query')) return json({ code: 0, data: {
        items: [{
          record_uid: 'aggregate-default', source_kind: 1, send_at: 110,
          record_core: {
            record_uid: 'aggregate-default', owner_user_id: 10001, creator_user_id: 10001,
            title: '', text_content: '未分类内容', template_kind: 1, status: 1, version: 1, send_at: 110,
          },
        }, {
          record_uid: 'aggregate-topic', source_kind: 2, source_uid: 'topic-1', send_at: 109,
          topic_core: { topic_uid: 'topic-1', title: '工作', privacy_state: 1 },
          record_core: {
            record_uid: 'aggregate-topic', owner_user_id: 10001, creator_user_id: 10001,
            title: '', text_content: '主题聚合内容', template_kind: 1, status: 1, version: 1, send_at: 109,
          },
        }, {
          // The home-feed projection uses the legacy voice payload rather than
          // a media_refs entry.  It must still hydrate into the shared player.
          record_uid: 'aggregate-voice', source_kind: 1, send_at: 108,
          record_core: {
            record_uid: 'aggregate-voice', owner_user_id: 10001, creator_user_id: 10001,
            title: '', text_content: '语音转写内容', template_kind: 3, status: 1, version: 1, send_at: 108,
            record_duration_millis: 31_000,
            content_payload: {
              voice: { source_file_asset_uid: 'voice-asset-1', file_name: '语音.m4a', mime_type: 'audio/mp4', duration_millis: 31_000 },
            },
          },
        }],
        has_more: true, next_cursor_send_at: 108, next_cursor_record_uid: 'aggregate-next',
      } })
      if (url.endsWith('/api/v1/records/media/batch-list')) return json({ code: 0, data: { items: [{
        record_uid: 'aggregate-voice',
        items: [{
          file_asset_uid: 'voice-asset-1', file_kind: 2, file_name: '语音.m4a', mime_type: 'audio/mp4',
          size: 31, duration_sec: 31, download_url: 'https://media.test/aggregate-voice.m4a',
        }],
      }] } })
      if (url.endsWith('/api/v1/topics/display/detail')) return json({ code: 0, data: {
        records: [{ record_uid: 'record-1', creator_user_id: 10001, nickname: '我', text_content: '主题内容', send_at: 80, status: 1 }],
        has_more: true, next_cursor_send_at: 79, next_cursor_record_uid: 'record-next',
      } })
      if (url.endsWith('/api/v1/topics/records/create')) return json({ code: 0, data: { record_uid: body.record_uid, status: 1 } })
      throw new Error(`unexpected ${url}`)
    })

    const sources = await service.listSources('send_to_self', { limit: 20 })
    expect(sources.items.map(item => [item.kind, item.displayName, item.recordCount])).toEqual([
      ['send_to_self', '发给自己', undefined], ['default_category', '未分类', 7],
      ['topic', '工作', 2], ['topic', '周报', 1], ['topic', '空主题', 0],
    ])
    expect(sources.items[0]).toMatchObject({
      activeAtMillis: 109,
      latestPreview: '最近内容',
    })
    expect(sources.items[1]).toMatchObject({
      activeAtMillis: 101,
      latestPreview: '默认分类最近内容',
    })
    expect(sources.items[2]?.sourceRef).not.toContain('topic-1')
    expect(sources.items[3]?.parentSourceRef).toBe(sources.items[2]?.sourceRef)
    expect(sources.items[3]?.parentSourceRef).not.toContain('topic-1')
    const aggregateRef = sources.items[0]!.sourceRef
    await expect(service.readSource(aggregateRef, {
      cursor: { sendAtMillis: 111, itemUid: 'aggregate-cursor' },
    })).resolves.toMatchObject({
      source: { kind: 'send_to_self', displayName: '发给自己' },
      items: [
        { itemUid: 'aggregate-default', textContent: '未分类内容', isMe: true },
        { itemUid: 'aggregate-topic', textContent: '主题聚合内容', isMe: true, selfTopic: { title: '工作' } },
        {
          itemUid: 'aggregate-voice', textContent: '语音转写内容', isMe: true, templateKind: 3,
          contentBlocks: [{ kind: 'audio', fileAssetUid: 'voice-asset-1', durationSec: 31 }],
        },
      ],
      hasMore: true,
      nextCursor: { sendAtMillis: 108, itemUid: 'aggregate-next' },
    })
    expect(calls.find(call => call.url.endsWith('/api/v1/home/feed/query'))?.body).toEqual({
      limit: 30, source_kinds: [1, 2],
      cursor_send_at: 111, cursor_record_uid: 'aggregate-cursor',
    })
    const topicRef = sources.items[2]!.sourceRef
    await expect(service.readSource(topicRef)).resolves.toMatchObject({
      source: { kind: 'topic', displayName: '工作' },
      items: [{ textContent: '主题内容', isMe: true }],
      hasMore: true,
      nextCursor: { sendAtMillis: 79, itemUid: 'record-next' },
    })
    await expect(service.sendSourceText(topicRef, '写进主题', {
      recordUid: 'record-create-1',
      recordDurationMillis: 4_200,
      captureContext: {
        clientName: 'Google Chrome（DeepSeek Harness）', networkName: '网络已连接', electric: 88, charge: 1,
      },
    })).resolves.toMatchObject({
      itemUid: 'record-create-1', localState: 'synced',
    })
    expect(calls.at(-1)?.body).toMatchObject({
      topic_uid: 'topic-1', text_content: '写进主题', record_duration_millis: 4_200,
      capture_context: {
        client_name: 'Google Chrome（DeepSeek Harness）', network_name: '网络已连接', electric: 88, charge: 1,
      },
    })
    await service.listSources('send_to_self')
    expect(calls.filter(call => call.url.endsWith('/api/v1/topics/display/list'))).toHaveLength(2)
  })

  it('creates root topics and binds child topics without exposing server topic UIDs', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    let createCount = 0
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      calls.push({ url, body })
      if (url.endsWith('/api/v1/records/privacy/visibility-snapshot')) {
        return json({ code: 0, data: { items: [], has_more: false } })
      }
      if (url.endsWith('/api/v1/topics/display/list')) return json({ code: 0, data: { items: [{
        topic_core: { topic_uid: 'topic-parent', title: '工作', update_at: 100 },
        summary: { record_count: 2 },
      }] } })
      if (url.endsWith('/api/v1/topics/hierarchy/relations/list')) return json({ code: 0, data: { relations: [] } })
      if (url.endsWith('/api/v1/records/uncategorized/summary')) {
        return json({ code: 0, data: { record_count: 7, words_count: 20, total_sec: 0 } })
      }
      if (url.endsWith('/api/v1/topics/create')) {
        createCount += 1
        return json({ code: 0, data: { topic_uid: `topic-created-${createCount}`, status: 1 } })
      }
      if (url.endsWith('/api/v1/topics/hierarchy/bind')) return json({ code: 0, data: { relation: { status: 1 } } })
      throw new Error(`unexpected ${url}`)
    })

    const parent = (await service.listSources('send_to_self')).items.find(item => item.displayName === '工作')!
    const root = await service.createTopic('  旅行 ')
    const child = await service.createTopic('路线', parent.sourceRef)

    expect(root).toMatchObject({ source: { kind: 'topic', displayName: '旅行', recordCount: 0 } })
    expect(root.source).not.toHaveProperty('parentSourceRef')
    expect(child).toMatchObject({
      source: { kind: 'topic', displayName: '路线', parentSourceRef: parent.sourceRef, recordCount: 0 },
    })
    expect(root.source.sourceRef).not.toContain('topic-created-1')
    expect(child.source.sourceRef).not.toContain('topic-created-2')
    expect(calls.filter(call => call.url.endsWith('/api/v1/topics/create')).map(call => call.body)).toEqual([
      { title: '旅行', show_in_home: true, privacy_state: 1, extra: { source: 'dsh-arkme' } },
      { title: '路线', show_in_home: true, privacy_state: 1, extra: { source: 'dsh-arkme' } },
    ])
    expect(calls.find(call => call.url.endsWith('/api/v1/topics/hierarchy/bind'))?.body).toEqual({
      parent_topic_uid: 'topic-parent', child_topic_uid: 'topic-created-2',
    })
  })

  it('renames and safely dissolves a topic while promoting its direct children', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      calls.push({ url, body })
      if (url.endsWith('/api/v1/records/privacy/visibility-snapshot')) {
        return json({ code: 0, data: { items: [], has_more: false } })
      }
      if (url.endsWith('/api/v1/topics/display/list')) return json({ code: 0, data: { items: [
        { topic_core: { topic_uid: 'topic-parent', title: '工作', update_at: 100 } },
        { topic_core: { topic_uid: 'topic-child', title: '周报', update_at: 90 } },
      ] } })
      if (url.endsWith('/api/v1/topics/hierarchy/relations/list')) return json({ code: 0, data: {
        relations: [{ rel_kind: 1, status: 1, parent_topic_uid: 'topic-parent', child_topic_uid: 'topic-child', sibling_order: 1 }],
      } })
      if (url.endsWith('/api/v1/records/uncategorized/summary')) return json({ code: 0, data: { record_count: 0 } })
      if (url.endsWith('/api/v1/topics/display/detail')) return json({ code: 0, data: {
        records: [{ record_core: { record_uid: 'record-1' } }, { record_core: { record_uid: 'record-2' } }], has_more: false,
      } })
      if (url.endsWith('/api/v1/topics/records/bind') || url.endsWith('/api/v1/topics/records/unbind')) {
        return json({ code: 0, data: { rel_uid: `${String(body.topic_uid)}:${String(body.record_uid)}` } })
      }
      if (url.endsWith('/api/v1/topics/hierarchy/move')) return json({ code: 0, data: {
        topic_uid: 'topic-child', parent_topic_uid: '', sibling_order: 1,
      } })
      if (url.endsWith('/api/v1/topics/update')) return json({ code: 0, data: { topic_uid: body.topic_uid, updated: true } })
      throw new Error(`unexpected ${url}`)
    })

    const topics = (await service.listSources('send_to_self')).items.filter(item => item.kind === 'topic')
    const parent = topics.find(item => item.displayName === '工作')!
    const child = topics.find(item => item.displayName === '周报')!
    const renamed = await service.renameTopic(parent.sourceRef, '工作计划')
    const dissolved = await service.dissolveTopic(parent.sourceRef, undefined, [child.sourceRef])

    expect(renamed).toMatchObject({ displayName: '工作计划' })
    expect(renamed.sourceRef).not.toBe(parent.sourceRef)
    expect(dissolved).toEqual({ sourceRef: parent.sourceRef, movedChildSourceRefs: [child.sourceRef], movedRecordCount: 2 })
    expect(calls.filter(call => call.url.endsWith('/api/v1/topics/update')).map(call => call.body)).toEqual([
      {
        topic_uid: 'topic-parent', title: '工作计划', show_in_home: true,
        privacy_state: 1, status: 1, extra: { source: 'dsh-arkme' },
      },
      {
        topic_uid: 'topic-parent', title: '工作', show_in_home: true,
        privacy_state: 1, status: 2, extra: { source: 'dsh-arkme' },
      },
    ])
    expect(calls.find(call => call.url.endsWith('/api/v1/topics/hierarchy/move'))?.body).toEqual({
      topic_uid: 'topic-child', previous_parent_topic_uid: 'topic-parent', parent_topic_uid: '', insert_before_topic_uid: '',
    })
    expect(calls.filter(call => call.url.endsWith('/api/v1/topics/records/unbind')).map(call => call.body)).toEqual([
      { topic_uid: 'topic-parent', record_uid: 'record-1' },
      { topic_uid: 'topic-parent', record_uid: 'record-2' },
    ])
  })

  it('rolls back a newly created topic when child hierarchy binding fails', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const calls: Array<{ url: string, body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      calls.push({ url, body })
      if (url.endsWith('/api/v1/records/privacy/visibility-snapshot')) {
        return json({ code: 0, data: { items: [], has_more: false } })
      }
      if (url.endsWith('/api/v1/topics/display/list')) return json({ code: 0, data: { items: [{
        topic_core: { topic_uid: 'topic-parent', title: '工作', update_at: 100 },
      }] } })
      if (url.endsWith('/api/v1/topics/hierarchy/relations/list')) return json({ code: 0, data: { relations: [] } })
      if (url.endsWith('/api/v1/records/uncategorized/summary')) throw new Error('summary unavailable')
      if (url.endsWith('/api/v1/topics/create')) return json({ code: 0, data: { topic_uid: 'topic-created', status: 1 } })
      if (url.endsWith('/api/v1/topics/hierarchy/bind')) throw new Error('bind unavailable')
      if (url.endsWith('/api/v1/topics/update')) return json({ code: 0, data: { topic_uid: 'topic-created', updated: true } })
      throw new Error(`unexpected ${url}`)
    })

    const parent = (await service.listSources('send_to_self')).items.find(item => item.kind === 'topic')!
    await expect(service.createTopic('未绑定子主题', parent.sourceRef)).rejects.toMatchObject({
      code: 'topic-hierarchy-bind-failed',
      retryable: true,
    })
    expect(calls.find(call => call.url.endsWith('/api/v1/topics/update'))?.body).toEqual({
      topic_uid: 'topic-created',
      title: '未绑定子主题',
      show_in_home: true,
      privacy_state: 1,
      status: 2,
      extra: { source: 'dsh-arkme' },
    })
  })

  it('returns an explicit partial result only when hierarchy binding and rollback both fail', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const service = new ArkmeService(config, sessions, state, async input => {
      const url = String(input)
      if (url.endsWith('/api/v1/records/privacy/visibility-snapshot')) {
        return json({ code: 0, data: { items: [], has_more: false } })
      }
      if (url.endsWith('/api/v1/topics/display/list')) return json({ code: 0, data: { items: [{
        topic_core: { topic_uid: 'topic-parent', title: '工作', update_at: 100 },
      }] } })
      if (url.endsWith('/api/v1/topics/hierarchy/relations/list')) return json({ code: 0, data: { relations: [] } })
      if (url.endsWith('/api/v1/records/uncategorized/summary')) throw new Error('summary unavailable')
      if (url.endsWith('/api/v1/topics/create')) return json({ code: 0, data: { topic_uid: 'topic-created', status: 1 } })
      if (url.endsWith('/api/v1/topics/hierarchy/bind')) throw new Error('bind unavailable')
      if (url.endsWith('/api/v1/topics/update')) throw new Error('rollback unavailable')
      throw new Error(`unexpected ${url}`)
    })

    const parent = (await service.listSources('send_to_self')).items.find(item => item.kind === 'topic')!
    const result = await service.createTopic('未绑定子主题', parent.sourceRef)

    expect(result.warning).toContain('自动清理均未完成')
    expect(result.source).toMatchObject({ kind: 'topic', displayName: '未绑定子主题' })
    expect(result.source).not.toHaveProperty('parentSourceRef')
  })

  it('defers hierarchy depth authority to bind when the relation snapshot contains hidden ancestors', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    let createCalls = 0
    let bindCalls = 0
    let relationListCalls = 0
    const relations = [
      ['level-1', 'level-2'], ['level-2', 'level-3'], ['level-3', 'level-4'], ['level-4', 'topic-parent'],
    ].map(([parent, child]) => ({
      parent_topic_uid: parent, child_topic_uid: child, rel_kind: 1, status: 1,
    }))
    const service = new ArkmeService(config, sessions, state, async input => {
      const url = String(input)
      if (url.endsWith('/api/v1/records/privacy/visibility-snapshot')) {
        return json({ code: 0, data: { items: [], has_more: false } })
      }
      if (url.endsWith('/api/v1/topics/display/list')) return json({ code: 0, data: { items: [{
        topic_core: { topic_uid: 'topic-parent', title: '第五级', update_at: 100 },
      }] } })
      if (url.endsWith('/api/v1/topics/hierarchy/relations/list')) {
        relationListCalls += 1
        return json({ code: 0, data: { relations } })
      }
      if (url.endsWith('/api/v1/records/uncategorized/summary')) throw new Error('summary unavailable')
      if (url.endsWith('/api/v1/topics/create')) {
        createCalls += 1
        return json({ code: 0, data: { topic_uid: 'topic-created', status: 1 } })
      }
      if (url.endsWith('/api/v1/topics/hierarchy/bind')) {
        bindCalls += 1
        return json({ code: 0, data: { relation: { status: 1 } } })
      }
      throw new Error(`unexpected ${url}`)
    })

    const parent = (await service.listSources('send_to_self')).items.find(item => item.kind === 'topic')!
    await expect(service.createTopic('可创建子主题', parent.sourceRef)).resolves.toMatchObject({
      source: { displayName: '可创建子主题', parentSourceRef: parent.sourceRef },
    })
    expect(createCalls).toBe(1)
    expect(bindCalls).toBe(1)
    expect(relationListCalls).toBe(1)
  })

  it('keeps send-to-self sources available when the default summary is unavailable', async () => {
    for (const cachedSummary of [undefined, { recordCount: 5, wordsCount: 10, totalSec: 0 }]) {
      const sessions = new MemorySessionStore()
      sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
      const state = new MemoryStateStore()
      state.summary = cachedSummary
      const service = new ArkmeService(config, sessions, state, async input => {
        const url = String(input)
        if (url.endsWith('/api/v1/records/privacy/visibility-snapshot')) {
          return json({ code: 0, data: { items: [], has_more: false } })
        }
        if (url.endsWith('/api/v1/topics/display/list')) return json({ code: 0, data: { items: [] } })
        if (url.endsWith('/api/v1/records/uncategorized/summary')) throw new TypeError('summary unavailable')
        throw new Error(`unexpected ${url}`)
      })

      const sources = await service.listSources('send_to_self')
      expect(sources.items).toHaveLength(2)
      expect(sources.items[0]).toMatchObject({ kind: 'send_to_self', displayName: '发给自己' })
      expect(sources.items[1]).toMatchObject({ kind: 'default_category', displayName: '未分类' })
      expect(sources.items[1]?.recordCount).toBe(cachedSummary?.recordCount)
    }
  })

  it('invalidates opaque source references after an account switch', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const fetchImpl = vi.fn<typeof fetch>(async () => json({ code: 0, data: { items: [] } }))
    const service = new ArkmeService(config, sessions, state, fetchImpl)
    const source = (await service.listSources('send_to_self')).items[0]!
    const callsBeforeAccountSwitch = fetchImpl.mock.calls.length
    sessions.session = { userId: 10002, accessToken: 'other-access', refreshToken: 'other-refresh' }

    await expect(service.readSource(source.sourceRef)).rejects.toMatchObject({ code: 'source-ref-invalid' })
    expect(fetchImpl).toHaveBeenCalledTimes(callsBeforeAccountSwitch)
  })

  it('keeps the send-to-self list usable when the hierarchy endpoint is unavailable', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const service = new ArkmeService(config, sessions, state, async input => {
      const url = String(input)
      if (url.endsWith('/api/v1/records/privacy/visibility-snapshot')) {
        return json({ code: 0, data: { items: [], has_more: false } })
      }
      if (url.endsWith('/api/v1/topics/display/list')) return json({ code: 0, data: { items: [{
        topic_core: { topic_uid: 'topic-1', title: '工作', update_at: 100 },
      }] } })
      if (url.endsWith('/api/v1/topics/hierarchy/relations/list')) throw new Error('hierarchy unavailable')
      throw new Error(`unexpected ${url}`)
    })

    await expect(service.listSources('send_to_self')).resolves.toMatchObject({
      items: [
        { kind: 'send_to_self', displayName: '发给自己' },
        { kind: 'default_category' },
        { kind: 'topic', displayName: '工作' },
      ],
      hasMore: false,
    })
  })

  it('lists, reads, and sends private/group chat sources through the Chat owner', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    let joinRestrictionPageUserId = 20002
    let joinRestrictionNextCursor: unknown = { updated_at: 1_700_000_000_456, user_id: 20002 }
    let joinRestrictionItemsPresent = true
    let joinRestrictionSetUpdatedAt = 0
    let withdrawalAlreadyWithdrawn: unknown = false
    let removedMemberJoinRestricted: unknown = true
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      calls.push({ url, body })
      if (url.endsWith('/api/v1/chats/list')) return json({ code: 200, data: {
        items: [
          {
            session: { chat_session_uid: 'chat-private', session_kind: 1, title: '', last_seq: 8, last_active_at: 200 },
            private_counterpart: { user_id: 20002, display_name_snapshot: '小林' },
            current_policy: { mute_state: 1, notify_state: 1 },
            sort_active_at: 210,
            latest_preview: { record: { payload: { text_content: '你好' } } },
            unread_snapshot: { unread_count: 2, session_last_seq: 8 },
          },
          {
            session: {
              chat_session_uid: 'chat-group',
              session_kind: 2,
              title: '项目群',
              last_active_at: 190,
              rm_subject_id: 88010,
            },
            current_policy: { mute_state: 2, notify_state: 2 },
            sort_active_at: 195, unread_snapshot: { unread_count: 1, has_unread_attention: '1', unread_attention_count: 1 },
          },
        ],
        has_more: false,
      } })
      if (url.endsWith('/api/v1/chats/group-avatar-snapshots')) return json({ code: 200, data: {
        items: [{ chat_session_uid: 'chat-group', members: [{ user_id: 10001 }, { user_id: 20002 }] }],
      } })
      if (url.endsWith('/api/v1/chats/unread-snapshot')) return json({ code: 200, data: {
        summary: {
          badge_count: 0, muted_unread_count: 0, session_count_with_unread: 0,
          has_attention: false, summary_version: 1, updated_at: 1_700_000_000_001,
        },
      } })
      if (url.endsWith('/api/v1/chats/display-snapshots')) return json({ code: 200, data: {
        items: (body.chat_session_uids as string[]).map(uid => ({
          session: {
            chat_session_uid: uid, session_kind: uid === 'chat-group' ? 2 : 1,
            title: uid === 'chat-group' ? '项目群' : '', last_seq: 8, last_active_at: 220,
          },
          ...(uid === 'chat-private' ? { private_counterpart: { user_id: 20002, display_name_snapshot: '小林' } } : {}),
          unread_snapshot: { unread_count: 0, session_last_seq: 8 },
        })),
      } })
      if (url.endsWith('/api/v1/chat/timeline/tail')) return json({ code: 200, data: { items: [] } })
      if (url.endsWith('/api/v1/auth/get-public-users-by-ids')) return json({ code: 200, data: {
        items: [
          { user_id: 10001, nick_name: '我', head_img: 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/a/10001/me.png?x-oss-signature=me' },
          { user_id: 20002, nick_name: '小林', head_img: 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/a/20002/peer.png?x-oss-signature=peer' },
          { user_id: 30003, nick_name: '公开用户昵称小周' },
          { user_id: 40004, nick_name: '公开用户昵称小吴' },
          { user_id: 50005, nick_name: '公开用户昵称小赵' },
        ].filter(item => (body.user_ids as number[]).includes(item.user_id)),
      } })
      if (url.endsWith('/api/v1/chat/timeline/page')) return json({ code: 200, data: {
        items: [
          {
            relation: { rel_uid: 'chat-relation-1', record_uid: 'chat-record-1', sender_user_id: 20002, display_name_snapshot: '小林', attach_at: 180, seq: 7 },
            record: { status: 1, payload: { text_content: '聊天正文' } },
          },
          {
            relation: { rel_uid: 'chat-relation-2', record_uid: 'chat-record-2', sender_user_id: 10001, display_name_snapshot: '我', attach_at: 181, seq: 8 },
            record: { status: 1, payload: { text_content: '我的回复' } },
          },
          ...(body.chat_session_uid === 'chat-private' ? [{
            relation: { rel_uid: 'chat-relation-agent', record_uid: 'chat-record-agent', sender_user_id: 10001, display_name_snapshot: '我', attach_at: 182, seq: 9 },
            record: { status: 1, payload: { text_content: 'Agent 代发', creation_source: 1, agent_display_name: 'Codex' } },
          }] : []),
          {
            relation: { rel_uid: 'chat-relation-unavailable', record_uid: 'chat-record-unavailable', sender_user_id: 20002, attach_at: 179, seq: 6 },
            record: {},
          },
        ],
        has_more: true, next_before_seq: 6,
      } })
      if (url.endsWith('/api/v1/chats/records/send')) return json({ code: 200, data: {
        record_uid: body.record_uid, rel_uid: body.rel_uid, seq: 8,
      } })
      if (url.endsWith('/api/v1/chats/report')) return json({ code: 200, data: {
        report: { report_uid: 'report-1', status: 1 }, outcome: 'inserted',
      } })
      if (url.endsWith('/api/v1/chats/messages/withdraw')) return json({ code: 200, data: {
        chat_session_uid: body.chat_session_uid, rel_uid: body.rel_uid,
        withdrawn_at: 1_700_000_000_123, already_withdrawn: withdrawalAlreadyWithdrawn,
      } })
      if (url.endsWith('/api/v1/chats/members/list')) return json({ code: 200, data: {
        items: [
          { user_id: 10001, role: 1, status: 1, display_name_snapshot: '我', join_at: 1 },
          { user_id: 20002, role: 3, status: 1, display_name_snapshot: '群昵称小林', join_at: 2 },
        ],
      } })
      if (url.endsWith('/api/v1/chats/members/update')) return json({ code: 200, data: {
        chat_session_uid: body.chat_session_uid,
        item: { user_id: body.target_user_id, status: 3, join_restricted: removedMemberJoinRestricted },
      } })
      if (url.endsWith('/api/v1/chats/governance/join-restriction/page')) return json({ code: 200, data: {
        chat_session_uid: body.chat_session_uid,
        ...(joinRestrictionItemsPresent ? { items: [{
          user_id: joinRestrictionPageUserId, role: 3, status: 3, display_name_snapshot: '群昵称小林',
          restriction: { updated_by_user_id: 10001, updated_at: 1_700_000_000_456 },
        }] } : {}),
        next_cursor: joinRestrictionNextCursor,
      } })
      if (url.endsWith('/api/v1/chats/governance/join-restriction/set')) return json({ code: 200, data: {
        chat_session_uid: body.chat_session_uid, user_id: body.target_user_id,
        restricted: body.restricted, updated_at: joinRestrictionSetUpdatedAt,
      } })
      if (url.endsWith('/api/v1/chats/read-receipts/summary-list')) return json({ code: 200, data: {
        chat_session_uid: body.chat_session_uid,
        items: (body.items as Array<Record<string, unknown>>).map(item => ({
          chat_session_uid: body.chat_session_uid,
          record_uid: item.record_uid,
          seq: item.seq,
          read_count: body.chat_session_uid === 'chat-private' ? 1 : 1,
          unread_count: body.chat_session_uid === 'chat-private' ? 0 : 1,
          total_member_count: body.chat_session_uid === 'chat-private' ? 1 : 2,
          is_all_read: body.chat_session_uid === 'chat-private',
        })),
      } })
      if (url.endsWith('/api/v1/chats/read-receipts/detail')) return json({ code: 200, data: {
        chat_session_uid: body.chat_session_uid,
        record_uid: body.record_uid,
        seq: body.seq,
        items: [
          {
            user_id: 20002, member_name: '群昵称小林', display_name: '用户昵称小林',
            read_status: 'read', read_at: 220,
          },
          {
            user_id: 30003, remark: '', member_name: '群昵称小周', display_name: '用户昵称小周',
            read_status: 'unread', read_at: 0,
          },
          { user_id: 40004, display_name: '用户昵称小吴', read_status: 'read', read_at: 230 },
          { user_id: 50005, display_name: '群成员', read_status: 'unread', read_at: 0 },
        ],
      } })
      if (url.endsWith('/api/v1/chats/contacts/list')) return json({ code: 200, data: {
        items: [
          { user_id: 20002, remark: '备注小林' },
          { user_id: 30003, remark: '' },
        ],
        has_more: false,
      } })
      if (url.endsWith('/api/v1/bot/group/list')) return json({ code: 200, data: {
        subject_title: '项目群', can_current_user_add_bots: true, bots: [],
      } })
      if (url.endsWith('/api/v1/chats/cursor/update')) return json({ code: 200, data: {
        chat_session_uid: body.chat_session_uid,
        user_id: 10001,
        effective_read_seq: body.read_seq,
        read_at: 220,
        session_last_seq: 8,
        unread_count: 0,
        unread_attention_count: 0,
        has_unread_attention: false,
      } })
      throw new Error(`unexpected ${url}`)
    })
    const lastCall = (suffix: string) => calls.filter(call => call.url.endsWith(suffix)).at(-1)

    const sources = await service.listSources('root')
    expect(sources.items).toMatchObject([
      {
        kind: 'private_chat',
        sourceKey: expect.stringMatching(/^arkme-chat-source-v1\./),
        displayName: '小林',
        latestPreview: '你好',
        unreadCount: 2,
        latestSequence: 8,
        isMuted: false,
      },
      {
        kind: 'group_chat',
        sourceKey: expect.stringMatching(/^arkme-chat-source-v1\./),
        displayName: '项目群',
        isMuted: true,
        unreadCount: 1,
        hasUnreadMention: true,
      },
    ])
    const privateRef = sources.items[0]!.sourceRef
    const privateSourceKey = sources.items[0]!.sourceKey
    await expect(service.readSource(privateRef)).resolves.toMatchObject({
      items: [
        { textContent: '聊天正文', senderName: '小林', isMe: false, sequence: 7, avatarRef: expect.stringMatching(/^arkme-profile-image-v1\./) },
        { textContent: '我的回复', senderName: '我', isMe: true, sequence: 8, avatarRef: expect.stringMatching(/^arkme-profile-image-v1\./) },
        {
          textContent: 'Agent 代发',
          senderName: '我',
          isMe: true,
          sequence: 9,
          agentSource: { kind: 'agent', displayName: 'Codex', label: 'Codex代发' },
          avatarRef: expect.stringMatching(/^arkme-profile-image-v1\./),
        },
      ],
      nextCursor: { beforeSequence: 6 },
    })
    await expect(service.messageReadReceiptSummaries(privateRef, [
      { itemUid: 'chat-record-2', sequence: 8 },
    ])).resolves.toEqual({
      sourceRef: privateRef,
      conversationKind: 'private_chat',
      items: [{
        itemUid: 'chat-record-2',
        sequence: 8,
        readCount: 1,
        unreadCount: 0,
        totalMemberCount: 1,
        status: 'read',
      }],
    })
    expect(lastCall('/api/v1/chats/read-receipts/summary-list')?.body).toEqual({
      chat_session_uid: 'chat-private',
      items: [{ record_uid: 'chat-record-2', seq: 8 }],
    })
    const callsBeforeInvalidReceiptReads = calls.length
    await expect(service.messageReadReceiptSummaries(privateRef, [
      { itemUid: 'chat-record-2', sequence: 8 },
      { itemUid: 'chat-record-2', sequence: 8 },
    ])).rejects.toMatchObject({ code: 'message-read-receipt-items-invalid' })
    await expect(service.messageReadReceiptDetail(privateRef, 'chat-record-2', 8))
      .rejects.toMatchObject({ code: 'message-read-receipt-group-required' })
    expect(calls).toHaveLength(callsBeforeInvalidReceiptReads)
    await expect(service.sendSourceText(privateRef, '#项目 回复', { recordUid: 'record-send', relationUid: 'rel-send' })).resolves.toMatchObject({
      itemUid: 'record-send', sequence: 8, localState: 'synced',
    })
    expect(lastCall('/api/v1/chats/records/send')?.body).toMatchObject({
      chat_session_uid: 'chat-private',
      text_content: '#项目 回复',
      content_payload: {
        payload_kind: 1, schema_version: 1, text_state: 1,
        hash_tags: [{ tag: '项目', start_index: 0, length: 3 }],
      },
    })
    const clientEvents: unknown[] = []
    service.subscribeChatRealtime(event => { clientEvents.push(event) })
    await expect(service.markSourceRead(privateRef, 8)).resolves.toMatchObject({
      effectiveReadSequence: 8, unreadCount: 0,
    })
    expect(calls.find(call => call.url.endsWith('/api/v1/chats/cursor/update'))?.body)
      .toMatchObject({ chat_session_uid: 'chat-private', read_seq: 8 })
    expect(clientEvents[0]).toMatchObject({
      type: 'read-ack',
      sourceRef: privateRef,
      sourceKey: privateSourceKey,
      effectiveReadSequence: 8,
      unreadCount: 0,
    })
    const groupRef = sources.items[1]!.sourceRef
    await expect(service.listGroupBots(groupRef)).resolves.toMatchObject({ displayName: '项目群', items: [] })
    expect(calls.find(call => call.url.endsWith('/api/v1/bot/group/list'))?.body)
      .toEqual({ rm_subject_id: 88010 })
    const groupTimeline = await service.readSource(groupRef)
    expect(groupTimeline.items).toHaveLength(2)
    expect(groupTimeline.items.find(item => item.itemUid === 'chat-record-unavailable')).toBeUndefined()
    expect(groupTimeline.items[0]?.messageRef).toMatch(/^arkme-message-v1\./)
    expect(groupTimeline.items[0]?.messageWithdrawalRef).toMatch(/^arkme-message-withdrawal-v1\./)
    expect(groupTimeline.items[0]?.timelineItemKey).toMatch(/^arkme-chat-timeline-item-v1\./)
    expect(groupTimeline.items[1]?.messageRef).toBeUndefined()
    expect(groupTimeline.items[1]?.messageWithdrawalRef).toBeUndefined()
    await expect(service.messageReadReceiptSummaries(groupRef, [
      { itemUid: 'chat-record-2', sequence: 8 },
    ])).resolves.toMatchObject({
      conversationKind: 'group_chat',
      items: [{ status: 'partially_read', readCount: 1, unreadCount: 1 }],
    })
    await expect(service.messageReadReceiptDetail(groupRef, 'chat-record-2', 8)).resolves.toMatchObject({
      sourceRef: groupRef,
      itemUid: 'chat-record-2',
      sequence: 8,
      readCount: 2,
      unreadCount: 2,
      totalMemberCount: 4,
      items: [
        {
          memberRef: expect.stringMatching(/^arkme-chat-member-v1\./),
          displayName: '备注小林',
          readStatus: 'read',
          readAtMillis: 220,
          avatarRef: expect.stringMatching(/^arkme-profile-image-v1\./),
        },
        {
          memberRef: expect.stringMatching(/^arkme-chat-member-v1\./),
          displayName: '群昵称小周',
          readStatus: 'unread',
        },
        {
          memberRef: expect.stringMatching(/^arkme-chat-member-v1\./),
          displayName: '用户昵称小吴',
          readStatus: 'read',
          readAtMillis: 230,
        },
        {
          memberRef: expect.stringMatching(/^arkme-chat-member-v1\./),
          displayName: '公开用户昵称小赵',
          readStatus: 'unread',
        },
      ],
    })
    expect(calls.find(call => call.url.endsWith('/api/v1/chats/read-receipts/detail'))?.body).toEqual({
      chat_session_uid: 'chat-group', record_uid: 'chat-record-2', seq: 8,
    })
    expect(calls.filter(call => call.url.endsWith('/api/v1/chats/contacts/list'))).toMatchObject([
      { body: { limit: 50, offset: 0 } },
    ])
    await expect(service.reportMessage(groupTimeline.items[0]!.messageRef!, 2, {
      reason: '明确举报', requestUid: '019d8590-ebb4-7232-90f2-000000000001',
    })).resolves.toMatchObject({ reportUid: 'report-1', status: 1 })
    expect(lastCall('/api/v1/chats/report')?.body).toMatchObject({
      chat_session_uid: 'chat-group', rel_uid: 'chat-relation-1', report_type: 2,
      reason: '明确举报', request_uid: '019d8590-ebb4-7232-90f2-000000000001',
    })
    expect(lastCall('/api/v1/chats/report')?.body).not.toHaveProperty('created_at')
    await expect(service.withdrawGroupMessage(groupTimeline.items[0]!.messageWithdrawalRef!)).resolves.toMatchObject({
      messageWithdrawalRef: groupTimeline.items[0]!.messageWithdrawalRef,
      timelineItemKey: groupTimeline.items[0]!.timelineItemKey,
      withdrawnAtMillis: 1_700_000_000_123,
      alreadyWithdrawn: false,
    })
    expect(lastCall('/api/v1/chats/messages/withdraw')?.body).toEqual({ chat_session_uid: 'chat-group', rel_uid: 'chat-relation-1' })
    withdrawalAlreadyWithdrawn = undefined
    await expect(service.withdrawGroupMessage(groupTimeline.items[0]!.messageWithdrawalRef!)).rejects.toMatchObject({
      code: 'message-withdraw-invalid-response',
    })
    withdrawalAlreadyWithdrawn = false
    const members = await service.listSourceMembers(groupRef)
    const peerMemberRef = members.items.find(member => !member.isSelf)!.memberRef
    await expect(service.removeGroupMember(groupRef, peerMemberRef, { preventRejoin: true })).resolves.toMatchObject({
      memberRef: peerMemberRef, status: 'removed', joinRestricted: true,
    })
    expect(lastCall('/api/v1/chats/members/update')?.body).toEqual({
      chat_session_uid: 'chat-group', target_user_id: 20002, action: 2, prevent_rejoin: true,
    })
    removedMemberJoinRestricted = undefined
    await expect(service.removeGroupMember(groupRef, peerMemberRef)).rejects.toMatchObject({
      code: 'group-member-remove-invalid-response',
    })
    removedMemberJoinRestricted = false
    await expect(service.removeGroupMember(groupRef, peerMemberRef, { preventRejoin: true })).rejects.toMatchObject({
      code: 'group-member-remove-invalid-response',
    })
    removedMemberJoinRestricted = true
    await expect(service.removeGroupMember(groupRef, peerMemberRef)).resolves.toMatchObject({
      joinRestricted: true,
    })
    const restrictions = await service.listGroupJoinRestrictions(groupRef, { limit: 20 })
    expect(restrictions).toMatchObject({
      sourceRef: groupRef,
      items: [{
        memberRef: peerMemberRef,
        displayName: '小林',
        memberName: '群昵称小林',
        restrictedAtMillis: 1_700_000_000_456,
      }],
      nextCursor: expect.stringMatching(/^arkme-join-restriction-cursor-v1\./),
    })
    expect(calls.find(call => call.url.endsWith('/api/v1/chats/governance/join-restriction/page'))?.body)
      .toEqual({ chat_session_uid: 'chat-group', limit: 20 })
    joinRestrictionNextCursor = { updated_at: 1_700_000_000_456 }
    await expect(service.listGroupJoinRestrictions(groupRef)).rejects.toMatchObject({
      code: 'join-restrictions-invalid-response',
    })
    joinRestrictionNextCursor = { updated_at: 1_700_000_000_456, user_id: 20002 }
    joinRestrictionItemsPresent = false
    await expect(service.listGroupJoinRestrictions(groupRef)).rejects.toMatchObject({
      code: 'join-restrictions-invalid-response',
    })
    joinRestrictionItemsPresent = true
    joinRestrictionPageUserId = 0
    await expect(service.listGroupJoinRestrictions(groupRef)).rejects.toMatchObject({
      code: 'join-restrictions-invalid-response',
    })
    joinRestrictionPageUserId = 20002
    await expect(service.setGroupJoinRestriction(groupRef, peerMemberRef, false)).resolves.toEqual({
      sourceRef: groupRef, memberRef: peerMemberRef, restricted: false,
    })
    expect(lastCall('/api/v1/chats/governance/join-restriction/set')?.body)
      .toEqual({ chat_session_uid: 'chat-group', target_user_id: 20002, restricted: false })
    await expect(service.setGroupJoinRestriction(groupRef, peerMemberRef, true)).rejects.toMatchObject({
      code: 'join-restriction-invalid-response',
    })
    const messageRef = groupTimeline.items[0]!.messageRef!
    const [messagePrefix, encodedMessage, messageSignature] = messageRef.split('.') as [string, string, string]
    const crossSessionPayload = {
      ...JSON.parse(Buffer.from(encodedMessage, 'base64url').toString('utf8')) as Record<string, unknown>,
      chatSessionUid: 'chat-other',
    }
    const crossSessionRef = `${messagePrefix}.${Buffer.from(JSON.stringify(crossSessionPayload)).toString('base64url')}.${messageSignature}`
    const callsBeforeInvalidReferences = calls.length
    await expect(service.reportMessage(crossSessionRef, 2)).rejects.toMatchObject({ code: 'message-ref-invalid' })
    expect(calls).toHaveLength(callsBeforeInvalidReferences)

    sessions.session = { userId: 10002, accessToken: 'other-access', refreshToken: 'other-refresh' }
    await expect(service.reportMessage(messageRef, 2)).rejects.toMatchObject({ code: 'message-ref-invalid' })
    expect(calls).toHaveLength(callsBeforeInvalidReferences)
    service.dispose()
  }, 10_000)

  it('single-flights and TTL-caches identical Chat directory pages', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const fetchImpl = vi.fn<typeof fetch>(async input => {
      expect(String(input)).toBe('https://chat.test/api/v1/chats/list')
      return json({ code: 200, data: { items: [], has_more: false } })
    })
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), fetchImpl)

    const [first, concurrent] = await Promise.all([
      service.listSources('root', { limit: 50 }),
      service.listSources('root', { limit: 100 }),
    ])
    expect(first).toEqual(concurrent)
    expect(fetchImpl).toHaveBeenCalledOnce()
    await expect(service.listSources('root', { limit: 50 })).resolves.toEqual(first)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('keeps group avatar snapshots cached independently from a forced directory refresh', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    let directoryReads = 0
    let avatarReads = 0
    let profileReads = 0
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      if (url.endsWith('/api/v1/chats/list')) {
        directoryReads += 1
        return json({ code: 200, data: { items: [{
          session: { chat_session_uid: 'group-1', session_kind: 2, title: '群聊', last_active_at: 1 },
          unread_snapshot: { unread_count: 0 },
        }], has_more: false } })
      }
      if (url.endsWith('/api/v1/chats/group-avatar-snapshots')) {
        avatarReads += 1
        expect(body).toEqual({ chat_session_uids: ['group-1'] })
        return json({ code: 200, data: {
          items: [{ chat_session_uid: 'group-1', members: [{ user_id: 20001 }] }],
        } })
      }
      if (url.endsWith('/api/v1/auth/get-public-users-by-ids')) {
        profileReads += 1
        return json({ code: 200, data: { items: [{
          user_id: 20001,
          nick_name: '成员',
          head_img: 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/a/20001/member.png?x-oss-signature=member',
        }] } })
      }
      throw new Error(`unexpected ${url}`)
    })

    await service.listSources('root')
    await service.listSources('root', { refresh: true })

    expect(directoryReads).toBe(2)
    expect(avatarReads).toBe(1)
    expect(profileReads).toBe(1)
    expect(service.requestStats()).toMatchObject({
      'interactive-read:chat': { started: 2 },
      'background-read:chat': { started: 1 },
      'background-read:auth': { started: 1 },
    })
  })

  it('checkpoints successful Chat projections and retries only failed sessions', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const tailCalls = new Map<string, number>()
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      if (url.endsWith('/api/v1/chats/display-snapshots')) {
        return json({ code: 200, data: {
          items: (body.chat_session_uids as string[]).map(uid => ({
            session: { chat_session_uid: uid, session_kind: 2, title: `群聊-${uid}`, last_seq: 9, last_active_at: 100 },
            unread_snapshot: { unread_count: 1, session_last_seq: 9 },
          })),
        } })
      }
      if (url.endsWith('/api/v1/chat/timeline/tail')) {
        const uid = String(body.chat_session_uid)
        tailCalls.set(uid, (tailCalls.get(uid) ?? 0) + 1)
        if (uid === 'chat-2' && tailCalls.get(uid) === 1) return json({ code: 500, message: 'temporarily unavailable' })
        if (uid === 'chat-1') return json({ code: 200, data: { items: [{
          relation: {
            rel_uid: 'rel-mention-1', record_uid: 'rec-mention-1', sender_user_id: 20002,
            display_name_snapshot: '小林', attach_at: 101, seq: 9,
          },
          record: {
            status: 1,
            payload: {
              text_content: '@吴宏涛 测试',
              mention_metadata: {
                human_mentions: [{ user_id: 10001, display_name_snapshot: '吴宏涛', start_index: 0, length: 4 }],
              },
            },
          },
        }] } })
        return json({ code: 200, data: { items: [] } })
      }
      throw new Error(`unexpected ${url}`)
    })
    const events: unknown[] = []
    service.subscribeChatRealtime(event => { events.push(event) })
    const internal = service as unknown as {
      refreshChatSessionProjectionBatch(pending: Array<[string, number]>): Promise<Array<[string, number]>>
    }

    const failed = await internal.refreshChatSessionProjectionBatch([['chat-1', 9], ['chat-2', 9]])
    expect(failed).toEqual([['chat-2', 9]])
    expect(events[0]).toMatchObject({
      type: 'sessions-delta',
      updates: [{ source: { displayName: '群聊-chat-1', latestPreview: '@吴宏涛 测试', hasUnreadMention: true } }],
    })
    await expect(internal.refreshChatSessionProjectionBatch(failed)).resolves.toEqual([])
    expect(tailCalls).toEqual(new Map([['chat-1', 1], ['chat-2', 2]]))
  })

  it('publishes a renamed group projection to browser realtime subscribers', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async input => {
      const url = String(input)
      if (url.endsWith('/api/v1/chats/rename')) {
        return json({ code: 200, data: {
          session: {
            chat_session_uid: 'group-1', session_kind: 2, title: 'Harness3',
            last_active_at: 123, last_seq: 9,
          },
          unread_snapshot: { unread_count: 2, session_last_seq: 9 },
        } })
      }
      if (url.endsWith('/api/v1/chats/group-avatar-snapshots')) {
        return json({ code: 200, data: { items: [] } })
      }
      throw new Error(`unexpected ${url}`)
    })
    const events: unknown[] = []
    service.subscribeChatRealtime(event => { events.push(event) })

    await service.renameGroup(sourceRefFor('group_chat', 'group-1', 'harness2'), 'Harness3')

    expect(events).toEqual([expect.objectContaining({
      type: 'sessions-delta',
      updates: [expect.objectContaining({
        source: expect.objectContaining({
          kind: 'group_chat', displayName: 'Harness3', sourceKey: expect.any(String),
        }),
        sourceKey: expect.any(String),
        timelineItems: [],
      })],
    })])
  })

  it('keeps browser bootstrap reconciliation cache-aware and does not refresh the directory on upstream reconnect', () => {
    const service = new ArkmeService(
      config,
      new MemorySessionStore(),
      new MemoryStateStore(),
      vi.fn(),
    )
    const events: unknown[] = []
    service.subscribeChatRealtime(event => { events.push(event) })
    const internal = service as unknown as {
      handleChatRealtimeNotice(notice: {
        cause: 'reconcile'
        state: { revision: number; connected: boolean; connectionGeneration: number }
      }): void
    }

    expect(service.chatRealtimeInitialEvent()).toMatchObject({ type: 'reconcile', refresh: 'if-stale' })
    internal.handleChatRealtimeNotice({
      cause: 'reconcile', state: { revision: 1, connected: true, connectionGeneration: 1 },
    })
    expect(events).toEqual([expect.objectContaining({ type: 'reconcile', refresh: 'none', connected: true })])
  })

  it('invalidates send-to-self projections when another client changes Record data', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), vi.fn())
    const events: unknown[] = []
    service.subscribeChatRealtime(event => { events.push(event) })
    const internal = service as unknown as {
      source: { invalidateSourceListCache(userId: number, directory?: string): void }
      handleChatRealtimeNotice(notice: {
        cause: 'projection-invalidation'
        state: { revision: number; connected: boolean; connectionGeneration: number }
        projectionInvalidation: { eventUid: string; projection: string; eventAtMillis: number }
      }): void
    }
    const invalidate = vi.spyOn(internal.source, 'invalidateSourceListCache')

    internal.handleChatRealtimeNotice({
      cause: 'projection-invalidation',
      state: { revision: 2, connected: true, connectionGeneration: 1 },
      projectionInvalidation: { eventUid: 'projection-1', projection: 'record', eventAtMillis: 123456 },
    })

    await vi.waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith(10001, 'send_to_self')
      expect(events).toEqual([expect.objectContaining({ type: 'projection-invalidated', projection: 'record' })])
    })
  })

  it('polishes only enabled group text and preserves the original in the initial revision payload', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, body })
      if (url.endsWith('/api/v1/chats/ai-polish/settings/query')) return json({ code: 200, data: {
        config: { enabled: true, active_rule_uid: 'rule-1', update_at: 10 },
        rules: [{ rule_uid: 'rule-1', name: '友好表达', rule_text: '保持事实，语气友好。', rule_version: 2 }],
        viewer_role: 3, can_manage: false,
      } })
      if (url.endsWith('/api/v1/chats/ai-polish/text/polish')) return json({ code: 200, data: {
        task_uid: body.task_uid, attempt: 1, state: 1, action: 1,
        polished_text: '你好，方便帮我看一下吗？', rule_uid: 'rule-1', rule_version: 2,
        model_version: 'qwen-flash', prompt_version: 'group_text_polish_apply_v1',
      } })
      if (url.endsWith('/api/v1/chats/records/send')) return json({ code: 200, data: {
        record_uid: body.record_uid, rel_uid: body.rel_uid, seq: 9, audit_status: 1,
      } })
      throw new Error(`unexpected ${url}`)
    })
    const sourceRef = sourceRefFor('group_chat', 'group-1', '产品群')

    await expect(service.sendSourceText(sourceRef, '帮我看一下', {
      recordUid: 'record-polish-1', relationUid: 'relation-polish-1',
    })).resolves.toMatchObject({
      itemUid: 'record-polish-1', sequence: 9,
      aiPolish: {
        state: 'polished', originalText: '帮我看一下', polishedText: '你好，方便帮我看一下吗？',
      },
    })
    expect(requests.map(request => request.url)).toEqual([
      'https://chat.test/api/v1/chats/ai-polish/settings/query',
      'https://chat.test/api/v1/chats/ai-polish/text/polish',
      'https://chat.test/api/v1/chats/records/send',
    ])
    expect(requests[2]?.body).toMatchObject({
      chat_session_uid: 'group-1', record_uid: 'record-polish-1', rel_uid: 'relation-polish-1',
      text_content: '帮我看一下',
      initial_ai_polish: {
        original_text: '帮我看一下', polished_text: '你好，方便帮我看一下吗？',
        rule_uid: 'rule-1', rule_name: '友好表达', model: 'qwen-flash',
      },
    })
  })

  it('projects opaque member counts and sends a validated human mention without AI-polish rewriting', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const requests: Array<{ url: string; body: Record<string, unknown>; signal?: AbortSignal | null }> = []
    let memberActive = true
    let memberRequestFails = false
    let includeSameNameMember = false
    let rawMemberDisplayName = 'Tison'
    let rawMemberSnapshot = ''
    let rawMemberRemark = '成员接口备注'
    let privateRemark = '我的私有备注'
    let privateCounterpartSnapshot = 'Tison'
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, body, signal: init?.signal })
      if (url.endsWith('/api/v1/chats/members/list')) {
        if (memberRequestFails) throw new TypeError('member directory unavailable')
        return json({ code: 200, data: {
          items: body.active_only === true && !memberActive ? [] : [{
            user_id: 2001, role: 3, status: 1, join_at: 20,
            display_name: rawMemberDisplayName,
            display_name_snapshot: rawMemberSnapshot,
            remark: rawMemberRemark,
            extra: {
              record_count: 7, mention_count: 2, join_batch_at: 1_700_000_000_000,
              inviter_user_id: 10001, inviter_display_name: '我', invitee_display_name: '小林',
            },
          }, ...(includeSameNameMember ? [{
            user_id: 2002, role: 3, status: 1, join_at: 21,
            display_name: 'Tison', display_name_snapshot: 'Tison', remark: '', extra: {},
          }] : [])],
        } })
      }
      if (url.endsWith('/api/v1/chats/list')) return json({ code: 200, data: {
        items: [{
          session: { session_kind: 1 },
          private_counterpart: { user_id: 2001, display_name_snapshot: privateCounterpartSnapshot },
          private_supplement: { remark: privateRemark },
        }],
        has_more: false,
      } })
      if (url.endsWith('/api/v1/auth/get-public-users-by-ids')) return json({ code: 200, data: {
        items: [{ user_id: 2001, nick_name: 'Lin', name_slug: 'lin', head_img: '' }],
      } })
      if (url.endsWith('/api/v1/chats/members/records/page')) return json({ code: 200, data: {
        items: [{
          relation: {
            record_uid: 'member-record-1', rel_uid: 'member-relation-1', sender_user_id: 2001,
            display_name_snapshot: '小林', attach_at: 1700000000200, seq: 8,
          },
          record: { status: 1, payload: { record_uid: 'member-record-1', text_content: '成员快记' } },
        }],
        has_more: true,
        next_before_seq: 8,
      } })
      if (url.endsWith('/api/v1/chats/records/send')) return json({ code: 200, data: {
        record_uid: body.record_uid, rel_uid: body.rel_uid, seq: 18, audit_status: 1,
      } })
      throw new Error(`unexpected ${url}`)
    })
    const sourceRef = sourceRefFor('group_chat', 'group-mention', '协作群')
    const members = await service.listSourceMembers(sourceRef)
    expect(members.items[0]).toMatchObject({
      displayName: '我的私有备注',
      mentionDisplayName: 'Tison',
      mentionSecondaryName: '我的私有备注',
      recordCount: 7, mentionCount: 2,
      memberRef: expect.stringMatching(/^arkme-chat-member-v1\./),
      mentionRef: expect.stringMatching(/^arkme-chat-human-mention-v1\./),
    })
    expect(members.items[0]!.mentionRef).not.toBe(members.items[0]!.memberRef)
    const privateMembers = await service.listSourceMembers(
      sourceRefFor('private_chat', 'private-mention', '小林'),
    )
    expect(privateMembers.items[0]).not.toHaveProperty('mentionRef')
    expect(members.joinEvents).toMatchObject([{
      eventId: expect.stringMatching(/^arkme-chat-join-v1\./),
      action: 'invite', occurredAtMillis: 1_700_000_000_000,
      inviter: { displayName: '我', isSelf: true },
      invitees: [{ memberRef: members.items[0]?.memberRef, displayName: '小林', isSelf: false }],
    }])
    expect(requests.find(request => request.url.endsWith('/api/v1/chats/members/list'))?.body)
      .toMatchObject({ active_only: false })
    const memberRef = members.items[0]!.memberRef
    const mentionRef = members.items[0]!.mentionRef!
    expect(JSON.parse(Buffer.from(mentionRef.split('.')[1]!, 'base64url').toString('utf8'))).toEqual({
      version: 1,
      viewerUserId: 10001,
      chatSessionUid: 'group-mention',
      targetUserId: 2001,
      displayNameSnapshot: 'Tison',
    })
    rawMemberRemark = ''
    rawMemberSnapshot = '群内 Tison'
    const groupNamedMembers = await service.listSourceMembers(sourceRef)
    expect(groupNamedMembers.items[0]).toMatchObject({
      displayName: '我的私有备注',
      mentionDisplayName: '群内 Tison',
      mentionSecondaryName: '我的私有备注',
    })
    expect(JSON.parse(Buffer.from(groupNamedMembers.items[0]!.mentionRef!.split('.')[1]!, 'base64url').toString('utf8')))
      .toEqual({
        version: 1,
        viewerUserId: 10001,
        chatSessionUid: 'group-mention',
        targetUserId: 2001,
        displayNameSnapshot: '群内 Tison',
    })
    rawMemberSnapshot = ''

    rawMemberRemark = ''

    privateRemark = ''
    privateCounterpartSnapshot = '私聊旧快照'
    const noRemarkMembers = await service.listSourceMembers(sourceRef)
    expect(noRemarkMembers.items[0]).toMatchObject({
      displayName: '私聊旧快照',
      mentionDisplayName: 'Tison',
    })
    expect(noRemarkMembers.items[0]).not.toHaveProperty('mentionSecondaryName')
    expect(JSON.parse(Buffer.from(noRemarkMembers.items[0]!.mentionRef!.split('.')[1]!, 'base64url').toString('utf8')))
      .toEqual({
        version: 1,
        viewerUserId: 10001,
        chatSessionUid: 'group-mention',
        targetUserId: 2001,
        displayNameSnapshot: 'Tison',
      })

    rawMemberDisplayName = ''
    privateCounterpartSnapshot = ''
    const publicFallbackMembers = await service.listSourceMembers(sourceRef)
    expect(publicFallbackMembers.items[0]).toMatchObject({
      displayName: 'Lin',
      mentionDisplayName: 'Lin',
    })
    expect(publicFallbackMembers.items[0]).not.toHaveProperty('mentionSecondaryName')
    rawMemberDisplayName = 'Tison'
    rawMemberRemark = '我的私有备注'
    privateRemark = '我的私有备注'
    privateCounterpartSnapshot = 'Tison'
    await expect(service.sourceMemberRecords(sourceRef, `${memberRef}x`, 'owner'))
      .rejects.toMatchObject({ code: 'chat-member-ref-invalid' })
    await expect(service.sourceMemberRecords(sourceRefFor('group_chat', 'another-group', '另一个群'), memberRef, 'owner'))
      .rejects.toMatchObject({ code: 'chat-member-ref-invalid' })
    await expect(service.sourceMemberRecords(sourceRef, mentionRef, 'owner'))
      .rejects.toMatchObject({ code: 'chat-member-ref-invalid' })
    const previouslyIssuedMemberPayload = Buffer.from(JSON.stringify({
      version: 1, viewerUserId: 10001, chatSessionUid: 'group-mention', targetUserId: 2001,
    }), 'utf8').toString('base64url')
    const previouslyIssuedMemberRef = `arkme-chat-member-v1.${previouslyIssuedMemberPayload}.${createHmac('sha256', 'dsh-device-1')
      .update(previouslyIssuedMemberPayload).digest('base64url')}`
    await expect(service.sourceMemberRecords(sourceRef, previouslyIssuedMemberRef, 'owner', { limit: 10 }))
      .resolves.toMatchObject({ member: { memberRef: previouslyIssuedMemberRef, displayName: '我的私有备注' } })
    await expect(service.sourceMemberRecords(sourceRef, memberRef, 'mentioned', { limit: 10 }))
      .resolves.toMatchObject({
        member: { memberRef, displayName: '我的私有备注' },
        mode: 'mentioned',
        items: [{ itemUid: 'member-record-1', memberRef, textContent: '成员快记' }],
        hasMore: true,
        nextCursor: { beforeSequence: 8 },
      })

    const result = await service.sendSourceText(sourceRef, '  @Tison 请看  ', {
      recordUid: 'record-human-mention', relationUid: 'relation-human-mention',
      humanMentions: [{ mentionRef, startIndex: 2, length: 6 }],
    })
    expect(result).toMatchObject({ itemUid: 'record-human-mention', sequence: 18 })
    expect(requests.some(request => request.url.endsWith('/api/v1/chats/ai-polish/settings/query'))).toBe(false)
    expect(requests.at(-1)?.body).toMatchObject({
      chat_session_uid: 'group-mention',
      text_content: '@Tison 请看',
      content_payload: {
        payload_kind: 1,
        schema_version: 1,
        text_state: 1,
        mention_metadata: {
          schema_version: 1,
          source_checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
          human_mentions: [{ user_id: 2001, display_name_snapshot: 'Tison', start_index: 0, length: 6 }],
        },
      },
    })
    expect(JSON.stringify(requests.at(-1)?.body)).not.toContain('我的私有备注')

    await expect(service.sendSourceText(sourceRef, '@Tison 请看', {
      recordUid: 'record-v1-member-mention', relationUid: 'relation-v1-member-mention',
      humanMentions: [{ memberRef, startIndex: 0, length: 6 } as never],
    })).rejects.toMatchObject({ code: 'human-mention-invalid' })

    requests.length = 0
    await expect(service.sendSourceRich(sourceRef, {
      textContent: '  @Tison 图片  ',
      assets: [{
        fileAssetUid: 'asset-mention-image', fileName: 'mention.png', mimeType: 'image/png', size: 3, fileKind: 1,
      }],
      humanMentions: [{ mentionRef, startIndex: 2, length: 6 }],
    }, {
      recordUid: 'record-rich-human-mention', relationUid: 'relation-rich-human-mention',
    })).resolves.toMatchObject({ itemUid: 'record-rich-human-mention', sequence: 18 })
    expect(requests.at(-1)?.body).toMatchObject({
      template_kind: 2,
      text_content: '@Tison 图片',
      content_payload: {
        payload_kind: 2,
        media_refs: [{ file_asset_uid: 'asset-mention-image', render_role: 1 }],
        mention_metadata: {
          human_mentions: [{ user_id: 2001, display_name_snapshot: 'Tison', start_index: 0, length: 6 }],
        },
      },
    })

    await expect(service.sendSourceText(sourceRef, '😀 @Tison', {
      recordUid: 'record-utf16-human-mention', relationUid: 'relation-utf16-human-mention',
      humanMentions: [{ mentionRef, startIndex: 3, length: 6 }],
    })).resolves.toMatchObject({ itemUid: 'record-utf16-human-mention', sequence: 18 })
    expect(requests.at(-1)?.body).toMatchObject({
      text_content: '😀 @Tison',
      content_payload: {
        mention_metadata: {
          human_mentions: [{ user_id: 2001, display_name_snapshot: 'Tison', start_index: 3, length: 6 }],
        },
      },
    })

    includeSameNameMember = true
    const sameNameMembers = await service.listSourceMembers(sourceRef)
    const secondMentionRef = sameNameMembers.items.find(item => item.memberRef !== memberRef)?.mentionRef ?? ''
    expect(secondMentionRef).toMatch(/^arkme-chat-human-mention-v1\./)
    await expect(service.sendSourceText(sourceRef, '@Tison @Tison', {
      recordUid: 'record-same-name-human-mentions', relationUid: 'relation-same-name-human-mentions',
      humanMentions: [
        { mentionRef, startIndex: 0, length: 6 },
        { mentionRef: secondMentionRef, startIndex: 7, length: 6 },
      ],
    })).resolves.toMatchObject({ itemUid: 'record-same-name-human-mentions', sequence: 18 })
    expect(requests.at(-1)?.body).toMatchObject({
      content_payload: {
        mention_metadata: {
          human_mentions: [
            { user_id: 2001, display_name_snapshot: 'Tison', start_index: 0, length: 6 },
            { user_id: 2002, display_name_snapshot: 'Tison', start_index: 7, length: 6 },
          ],
        },
      },
    })
    includeSameNameMember = false

    await expect(service.sendSourceText(sourceRefFor('private_chat', 'private-mention', '小林'), '@Tison', {
      recordUid: 'record-private-human-mention', relationUid: 'relation-private-human-mention',
      humanMentions: [{ mentionRef, startIndex: 0, length: 6 }],
    })).rejects.toMatchObject({ code: 'mention-group-required' })

    const sendCountBeforeTamper = requests.filter(request => request.url.endsWith('/api/v1/chats/records/send')).length
    await expect(service.sendSourceText(sourceRef, '@Tison 请看', {
      recordUid: 'record-ambiguous-mention-ref', relationUid: 'relation-ambiguous-mention-ref',
      humanMentions: [{ mentionRef, memberRef, startIndex: 0, length: 6 } as never],
    })).rejects.toMatchObject({ code: 'human-mention-invalid' })
    await expect(service.sendSourceText(sourceRef, '@Tison', {
      recordUid: 'record-overlapping-human-mention', relationUid: 'relation-overlapping-human-mention',
      humanMentions: [
        { mentionRef, startIndex: 0, length: 6 },
        { mentionRef, startIndex: 0, length: 6 },
      ],
    })).rejects.toMatchObject({ code: 'human-mention-overlap' })
    await expect(service.sendSourceText(sourceRef, '@所有人', {
      recordUid: 'record-too-many-human-mentions', relationUid: 'relation-too-many-human-mentions',
      humanMentions: Array.from({ length: 51 }, () => ({ all: true as const, startIndex: 0, length: 4 })),
    })).rejects.toMatchObject({ code: 'human-mention-invalid' })
    await expect(service.sendSourceText(sourceRef, '@Lucis 请看', {
      recordUid: 'record-tampered-mention', relationUid: 'relation-tampered-mention',
      humanMentions: [{ mentionRef, startIndex: 0, length: 6 }],
    })).rejects.toMatchObject({ code: 'human-mention-text-mismatch' })
    await expect(service.sendSourceText(sourceRef, '@ Tison 请看', {
      recordUid: 'record-spaced-mention', relationUid: 'relation-spaced-mention',
      humanMentions: [{ mentionRef, startIndex: 0, length: 7 }],
    })).rejects.toMatchObject({ code: 'human-mention-text-mismatch' })
    expect(requests.filter(request => request.url.endsWith('/api/v1/chats/records/send')))
      .toHaveLength(sendCountBeforeTamper)

    await expect(service.sendSourceText(sourceRef, '@Tison 请看', {
      recordUid: 'record-member-ref-as-mention', relationUid: 'relation-member-ref-as-mention',
      humanMentions: [{ mentionRef: memberRef, startIndex: 0, length: 6 }],
    })).rejects.toMatchObject({ code: 'chat-mention-ref-invalid' })
    await expect(service.sendSourceText(sourceRef, '@Tison 请看', {
      recordUid: 'record-tampered-mention-ref', relationUid: 'relation-tampered-mention-ref',
      humanMentions: [{ mentionRef: `${mentionRef}x`, startIndex: 0, length: 6 }],
    })).rejects.toMatchObject({ code: 'chat-mention-ref-invalid' })
    await expect(service.sendSourceText(sourceRefFor('group_chat', 'another-group', '另一个群'), '@Tison 请看', {
      recordUid: 'record-cross-group-mention-ref', relationUid: 'relation-cross-group-mention-ref',
      humanMentions: [{ mentionRef, startIndex: 0, length: 6 }],
    })).rejects.toMatchObject({ code: 'chat-mention-ref-invalid' })

    rawMemberDisplayName = 'Lucis'
    rawMemberSnapshot = 'Lucis'
    await expect(service.sendSourceText(sourceRef, '@Lucis 请看', {
      recordUid: 'record-current-name-substitution', relationUid: 'relation-current-name-substitution',
      humanMentions: [{ mentionRef, startIndex: 0, length: 6 }],
    })).rejects.toMatchObject({ code: 'human-mention-text-mismatch' })
    await expect(service.sendSourceText(sourceRef, '@Tison 请看', {
      recordUid: 'record-selected-name-snapshot', relationUid: 'relation-selected-name-snapshot',
      humanMentions: [{ mentionRef, startIndex: 0, length: 6 }],
    })).resolves.toMatchObject({ itemUid: 'record-selected-name-snapshot', sequence: 18 })

    const selfMentionPayload = Buffer.from(JSON.stringify({
      version: 1, viewerUserId: 10001, chatSessionUid: 'group-mention', targetUserId: 10001,
      displayNameSnapshot: '我',
    }), 'utf8').toString('base64url')
    const selfMentionRef = `arkme-chat-human-mention-v1.${selfMentionPayload}.${createHmac('sha256', 'dsh-device-1')
      .update(`arkme-chat-human-mention-v1.${selfMentionPayload}`).digest('base64url')}`
    await expect(service.sendSourceText(sourceRef, '@我 请看', {
      recordUid: 'record-self-human-mention', relationUid: 'relation-self-human-mention',
      humanMentions: [{ mentionRef: selfMentionRef, startIndex: 0, length: 2 }],
    })).rejects.toMatchObject({ code: 'human-mention-self-invalid' })

    memberActive = false
    await expect(service.sendSourceText(sourceRef, '@Tison 请看', {
      recordUid: 'record-stale-mention', relationUid: 'relation-stale-mention',
      humanMentions: [{ mentionRef, startIndex: 0, length: 6 }],
    })).rejects.toMatchObject({ code: 'chat-member-ref-stale' })

    memberRequestFails = true
    const allResult = await service.sendSourceText(sourceRef, '@所有人 请看', {
      recordUid: 'record-all-mention', relationUid: 'relation-all-mention',
      humanMentions: [{ all: true, startIndex: 0, length: 4 }],
    })
    expect(allResult).toMatchObject({ itemUid: 'record-all-mention', sequence: 18 })
    expect(requests.at(-1)?.body).toMatchObject({
      chat_session_uid: 'group-mention',
      text_content: '@所有人 请看',
      content_payload: {
        payload_kind: 1,
        schema_version: 1,
        text_state: 1,
        mention_metadata: {
          schema_version: 1,
          source_checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
          human_mentions: [{ user_id: 0, display_name_snapshot: '所有人', start_index: 0, length: 4 }],
        },
      },
    })

    await expect(service.sendSourceRich(sourceRef, {
      textContent: '@所有人 图片',
      assets: [{
        fileAssetUid: 'asset-all-mention-image', fileName: 'all.png', mimeType: 'image/png', size: 3, fileKind: 1,
      }],
      humanMentions: [{ all: true, startIndex: 0, length: 4 }],
    }, {
      recordUid: 'record-rich-all-mention', relationUid: 'relation-rich-all-mention',
    })).resolves.toMatchObject({ itemUid: 'record-rich-all-mention', sequence: 18 })
    expect(requests.at(-1)?.body).toMatchObject({
      template_kind: 2,
      content_payload: {
        payload_kind: 2,
        media_refs: [{ file_asset_uid: 'asset-all-mention-image', render_role: 1 }],
        mention_metadata: {
          human_mentions: [{ user_id: 0, display_name_snapshot: '所有人', start_index: 0, length: 4 }],
        },
      },
    })
  })

  it('keeps the ordinary member projection when group join events are disabled', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    let memberRequestBody: Record<string, unknown> | undefined
    const service = new ArkmeService(
      { ...config, chatMemberJoinEventsEnabled: false },
      sessions,
      new MemoryStateStore(),
      async (input, init) => {
        const url = String(input)
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        if (url.endsWith('/api/v1/chats/members/list')) {
          memberRequestBody = body
          return json({ code: 200, data: { items: [{
            user_id: 2001, role: 3, status: 1, join_at: 20, display_name_snapshot: '小林',
            extra: { inviter_user_id: 10001, inviter_display_name: '我' },
          }] } })
        }
        if (url.endsWith('/api/v1/auth/get-public-users-by-ids')) {
          return json({ code: 200, data: { items: [{ user_id: 2001, nick_name: 'Lin', head_img: '' }] } })
        }
        throw new Error(`unexpected ${url}`)
      },
    )

    const members = await service.listSourceMembers(sourceRefFor('group_chat', 'group-join-disabled', '协作群'))
    expect(members.items).toHaveLength(1)
    expect(members).not.toHaveProperty('joinEvents')
    expect(memberRequestBody).toMatchObject({ active_only: true })
  })

  it('fails open to the unchanged group send when polish settings cannot be read', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, body })
      if (url.endsWith('/api/v1/chats/ai-polish/settings/query')) throw new TypeError('settings unavailable')
      if (url.endsWith('/api/v1/chats/records/send')) return json({ code: 200, data: {
        record_uid: body.record_uid, rel_uid: body.rel_uid, seq: 4, audit_status: 1,
      } })
      throw new Error(`unexpected ${url}`)
    })

    const result = await service.sendSourceText(
      sourceRefFor('group_chat', 'group-2', '稳定性群'),
      '原样发送',
      { recordUid: 'record-plain-1', relationUid: 'relation-plain-1' },
    )
    expect(result).not.toHaveProperty('aiPolish')
    expect(requests[1]?.body).toEqual({
      chat_session_uid: 'group-2', record_uid: 'record-plain-1', rel_uid: 'relation-plain-1',
      template_kind: 1, text_content: '原样发送', send_at: expect.any(Number),
    })
  })

  it('sends the original once after polish failure and retries against the same record relation', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, body })
      if (url.endsWith('/api/v1/chats/ai-polish/settings/query')) return json({ code: 200, data: {
        config: { enabled: true, active_rule_uid: 'rule-1', update_at: 10 },
        rules: [{ rule_uid: 'rule-1', name: '友好表达', rule_text: '友好', rule_version: 1 }],
      } })
      if (url.endsWith('/api/v1/chats/ai-polish/text/polish')) return json({ code: 200, data: {
        task_uid: body.task_uid, attempt: 1, state: 2, action: 0, failure_message: 'provider timeout',
      } })
      if (url.endsWith('/api/v1/chats/records/send')) return json({ code: 200, data: {
        record_uid: body.record_uid, rel_uid: body.rel_uid, seq: 5, audit_status: 1,
      } })
      if (url.endsWith('/api/v1/chats/ai-polish/text/retry-apply')) return json({ code: 200, data: {
        task_uid: body.task_uid, attempt: 2, state: 1, action: 1,
        record_uid: body.record_uid, rel_uid: body.rel_uid, polished_text: '重试后润色文', record_version: 2,
      } })
      throw new Error(`unexpected ${url}`)
    })

    const sent = await service.sendSourceText(
      sourceRefFor('group_chat', 'group-3', '重试群'),
      '重试原文',
      { recordUid: 'record-retry-1', relationUid: 'relation-retry-1' },
    )
    expect(sent.aiPolish).toMatchObject({ state: 'failed', retryRef: expect.any(String) })
    const retried = await service.retryGroupAiPolish(sent.aiPolish!.retryRef!)
    expect(retried.aiPolish).toEqual({
      state: 'polished', originalText: '重试原文', polishedText: '重试后润色文',
    })
    expect(requests.filter(request => request.url.endsWith('/api/v1/chats/records/send'))).toHaveLength(1)
    expect(requests.at(-1)?.body).toMatchObject({
      chat_session_uid: 'group-3', record_uid: 'record-retry-1', rel_uid: 'relation-retry-1',
      original_text: '重试原文', attempt: 2,
    })
  })

  it('lets an active regular member generate a rule and writes it only after confirmation', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    let enabled = false
    const savedRules: Array<Record<string, unknown>> = []
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, body })
      if (url.endsWith('/api/v1/chats/ai-polish/settings/query')) return json({ code: 200, data: {
        config: { enabled, active_rule_uid: enabled ? 'candidate-1' : '', update_at: 10 }, rules: savedRules,
        viewer_role: 3, can_manage: true,
      } })
      if (url.endsWith('/api/v1/chats/ai-polish/rules/generate')) return json({ code: 200, data: {
        candidate: { candidate_uid: 'candidate-1', name: '清晰友好', rule_text: '表达清晰友好并保留事实。', prompt_version: 'v1' },
      } })
      if (url.endsWith('/api/v1/chats/ai-polish/rules/upsert')) {
        const rule = { rule_uid: 'candidate-1', name: body.name, rule_text: body.rule_text }
        savedRules.push(rule)
        return json({ code: 200, data: { rule, outcome: 'inserted' } })
      }
      if (url.endsWith('/api/v1/chats/ai-polish/settings/update')) {
        enabled = true
        return json({ code: 200, data: {
        config: { enabled: true, active_rule_uid: 'candidate-1', update_at: body.update_at }, outcome: 'updated',
      } })
      }
      throw new Error(`unexpected ${url}`)
    })
    const ref = sourceRefFor('group_chat', 'group-4', '规则群')

    const candidate = await service.generateGroupAiPolishRuleForSource(ref, '清晰友好')
    expect(candidate).toMatchObject({
      groupName: '规则群', ruleName: '清晰友好', ruleText: '表达清晰友好并保留事实。',
      confirmationRef: expect.any(String),
    })
    expect(requests.some(request => request.url.endsWith('/rules/upsert'))).toBe(false)
    expect(requests.some(request => request.url.endsWith('/settings/update'))).toBe(false)

    await expect(service.confirmEnableGroupAiPolish(candidate.confirmationRef)).resolves.toEqual({
      groupName: '规则群', enabled: true, ruleName: '清晰友好', changed: true,
    })
    expect(requests.slice(-3).map(request => request.url)).toEqual([
      'https://chat.test/api/v1/chats/ai-polish/rules/upsert',
      'https://chat.test/api/v1/chats/ai-polish/settings/update',
      'https://chat.test/api/v1/chats/ai-polish/settings/query',
    ])
  })

  it('resolves one exact group name before generating its rule', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, body })
      if (url.endsWith('/api/v1/chats/list')) return json({ code: 200, data: {
        items: [
          { session: { chat_session_uid: 'group-exact', session_kind: 2, title: '产品群' }, unread_snapshot: {} },
          { session: { chat_session_uid: 'group-similar', session_kind: 2, title: '产品群二期' }, unread_snapshot: {} },
        ],
        has_more: false,
      } })
      if (url.endsWith('/api/v1/chats/group-avatar-snapshots')) return json({ code: 200, data: { items: [] } })
      if (url.endsWith('/api/v1/chats/ai-polish/settings/query')) return json({ code: 200, data: {
        config: { enabled: false, active_rule_uid: '', update_at: 1 }, rules: [], can_manage: true,
      } })
      if (url.endsWith('/api/v1/chats/ai-polish/rules/generate')) return json({ code: 200, data: {
        candidate: { candidate_uid: 'candidate-exact', name: '简洁', rule_text: '表达简洁。' },
      } })
      throw new Error(`unexpected ${url}`)
    })

    await expect(service.generateGroupAiPolishRule('产品群', '表达简洁')).resolves.toMatchObject({
      groupName: '产品群', ruleName: '简洁', ruleText: '表达简洁。',
    })
    expect(requests.find(request => request.url.endsWith('/rules/generate'))?.body)
      .toMatchObject({ chat_session_uid: 'group-exact', instruction: '表达简洁' })
  })

  it('does not guess when multiple groups have the same exact name', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async input => {
      const url = String(input)
      if (url.endsWith('/api/v1/chats/list')) return json({ code: 200, data: {
        items: [
          { session: { chat_session_uid: 'group-same-1', session_kind: 2, title: '同名群' }, unread_snapshot: {} },
          { session: { chat_session_uid: 'group-same-2', session_kind: 2, title: '同名群' }, unread_snapshot: {} },
        ],
        has_more: false,
      } })
      if (url.endsWith('/api/v1/chats/group-avatar-snapshots')) return json({ code: 200, data: { items: [] } })
      throw new Error(`unexpected ${url}`)
    })

    await expect(service.inspectGroupAiPolishByName('同名群')).rejects.toMatchObject({
      code: 'group-name-ambiguous', httpStatus: 409,
    })
  })

  it('restores historical polish previews and rule notices in the group timeline', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async input => {
      const url = String(input)
      if (url.endsWith('/api/v1/chat/timeline/page')) return json({ code: 200, data: {
        items: [{
          relation: { record_uid: 'record-history-1', sender_user_id: 10001, display_name_snapshot: '我', attach_at: 500, seq: 8 },
          record: {
            status: 1, version: 2,
            payload: {
              text_content: '历史润色文', has_polish: true,
              ai_polish_preview: { original_text: '历史原文', polished_text: '历史润色文' },
            },
          },
        }],
        has_more: false,
      } })
      if (url.endsWith('/api/v1/auth/get-public-users-by-ids')) return json({ code: 200, data: {
        items: [{ user_id: 10001, nick_name: '我', head_img: '' }],
      } })
      if (url.endsWith('/api/v1/chats/ai-polish/settings/query')) return json({ code: 200, data: {
        config: { enabled: true, active_rule_uid: 'rule-history', update_at: 400 },
        rules: [{ rule_uid: 'rule-history', name: '友好规则', rule_text: '表达友好。', rule_version: 1 }],
        viewer_role: 1, can_manage: true,
      } })
      if (url.endsWith('/api/v1/chats/ai-polish/notices/query')) return json({ code: 200, data: {
        notices: [{
          notice_uid: 'notice-1', source_key: 'config:400', notice_kind: 1,
          actor_display_name_snapshot: '产品经理小林', rule_text: '表达友好。', created_at: 450,
        }],
      } })
      throw new Error(`unexpected ${url}`)
    })

    await expect(service.readSource(sourceRefFor('group_chat', 'group-history', '历史群'))).resolves.toMatchObject({
      items: [{
        itemUid: 'record-history-1', textContent: '历史润色文', recordVersion: 2,
        aiPolish: { state: 'polished', originalText: '历史原文', polishedText: '历史润色文' },
      }],
      aiPolishSettings: {
        groupName: '历史群', enabled: true, canManage: true, activeRuleName: '友好规则',
      },
      aiPolishNotices: [{
        noticeUid: 'notice-1', message: '产品经理…开启了 AI 润色：表达友好。', createdAtMillis: 450,
      }],
    })
  })

  it('sends Agent-authored direct text by recipient Jotmo ID through the Chat owner facade', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const signal = new AbortController().signal
    const requests: Array<{
      url: string
      authorization: string | null
      body: Record<string, unknown>
      signal: AbortSignal | null
    }> = []
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      requests.push({
        url: String(input),
        authorization: new Headers(init?.headers).get('Authorization'),
        body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
        signal: init?.signal as AbortSignal | null,
      })
      if (String(input).endsWith('/api/v1/agent/profile/query')) return json({ code: 200, data: {
        display_name: 'Codex',
        version: 1,
      } })
      return json({ code: 200, data: {
        chat_session_uid: 'chat-direct-1',
        record_uid: 'record-direct-1',
        rel_uid: 'relation-direct-1',
        seq: 11,
        target_kind: 'direct',
      } })
    })

    await expect(service.sendDirectText(' zhangsan_01 ', ' 你好，这是 Agent 代发消息 ', {
      recordUid: 'record-direct-1',
      relationUid: 'relation-direct-1',
      sendAtMillis: 1787036400000,
      signal,
    })).resolves.toEqual({
      recipientArkmeId: 'zhangsan_01',
      chatSessionUid: 'chat-direct-1',
      recordUid: 'record-direct-1',
      relationUid: 'relation-direct-1',
      sequence: 11,
      targetKind: 'direct',
    })
    const sendRequest = requests.find(request => request.url.endsWith('/api/v1/chats/agent/records/send'))
    expect(sendRequest).toMatchObject({
      url: 'https://chat.test/api/v1/chats/agent/records/send',
      authorization: 'Bearer access',
      body: {
        recipient_jotmo_id: 'zhangsan_01',
        record_uid: 'record-direct-1',
        rel_uid: 'relation-direct-1',
        text_content: '你好，这是 Agent 代发消息',
        creation_source: 1,
        send_at: 1787036400000,
      },
    })
    expect(sendRequest?.signal).toBeInstanceOf(AbortSignal)
    expect(sendRequest?.signal?.aborted).toBe(false)
    expect(sendRequest?.body).not.toHaveProperty('chat_session_uid')
    expect(sendRequest?.body).not.toHaveProperty('template_kind')
  })

  it('uses cached Arkme Agent profile name when timeline only reports a generic Agent source', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      if (url.endsWith('/api/v1/agent/profile/query')) return json({ code: 200, data: {
        display_name: '海底捞',
        version: 2,
      } })
      if (url.endsWith('/api/v1/chat/timeline/page')) return json({ code: 200, data: {
        items: [{
          relation: { record_uid: 'agent-record-1', sender_user_id: 10001, display_name_snapshot: '我', attach_at: 1787036400000, seq: 11 },
          record: { status: 1, payload: { text_content: '缓存名字代发', creation_source: 1 } },
        }],
        has_more: false,
      } })
      if (url.endsWith('/api/v1/auth/get-public-users-by-ids')) return json({ code: 200, data: {
        items: [{ user_id: 10001, nick_name: '我', head_img: '' }],
      } })
      throw new Error(`unexpected ${url} ${JSON.stringify(body)}`)
    })

    await expect(service.arkoProfile()).resolves.toMatchObject({ displayName: '海底捞', version: 2 })
    await expect(service.readSource(sourceRefFor('private_chat', 'chat-agent-1', '小林'))).resolves.toMatchObject({
      items: [{
        itemUid: 'agent-record-1',
        senderName: '我',
        isMe: true,
        textContent: '缓存名字代发',
        agentSource: { kind: 'agent', displayName: '海底捞', label: '海底捞代发' },
      }],
    })
  })

  it('rejects an empty direct recipient before any Chat write', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const fetchImpl = vi.fn<typeof fetch>()
    const service = new ArkmeService(config, sessions, state, fetchImpl)

    await expect(service.sendDirectText('   ', '不应发送')).rejects.toMatchObject({ code: 'direct-recipient-invalid' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('hydrates opaque avatar refs and reuses authorized profile URLs for large images with stale content types', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const privateAvatar = 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/a/20002/20002_avatar.png?x-oss-signature=private-signature'
    const groupAvatar = 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/import/avatar/member.png?x-oss-signature=group-signature'
    const png = new Uint8Array(2 * 1024 * 1024 + 1)
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2])
    let profileReads = 0
    let imageDownloads = 0
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      if (url.endsWith('/api/v1/chats/list')) return json({ code: 200, data: {
        items: [
          {
            session: { chat_session_uid: 'private-1', session_kind: 1, last_active_at: 2 },
            private_counterpart: { user_id: 20002, display_name_snapshot: '旧名称' },
            private_supplement: { remark: '联系人备注' },
            unread_snapshot: { unread_count: 0 },
          },
          {
            session: { chat_session_uid: 'group-1', session_kind: 2, title: '群聊', last_active_at: 1 },
            unread_snapshot: { unread_count: 0 },
          },
        ],
      } })
      if (url.endsWith('/api/v1/chats/group-avatar-snapshots')) {
        expect(body).toEqual({ chat_session_uids: ['group-1'] })
        return json({ code: 200, data: {
          items: [{
            chat_session_uid: 'group-1', member_count: 2,
            strategy: 'owner_recent_speakers', computed_at: 1787036400000,
            members: [{ user_id: 20003 }, { user_id: 20002 }],
          }],
        } })
      }
      if (url.endsWith('/api/v1/auth/get-public-users-by-ids')) {
        profileReads += 1
        return json({ code: 200, data: {
          items: [
            { user_id: 20002, nick_name: '联系人', head_img: privateAvatar },
            { user_id: 20003, nick_name: '群成员', head_img: groupAvatar },
          ].filter(item => (body.user_ids as number[]).includes(item.user_id)),
        } })
      }
      if (url === privateAvatar || url === groupAvatar) {
        imageDownloads += 1
        return new Response(png, { status: 200, headers: { 'Content-Type': 'image/jpeg' } })
      }
      throw new Error(`unexpected ${url}`)
    })

    const sources = await service.listSources('root')
    expect(sources.items[0]).toMatchObject({ displayName: '联系人备注' })
    expect(sources.items[0]?.avatarRef).toMatch(/^arkme-profile-image-v1\./)
    expect(sources.items[1]?.avatarRefs).toHaveLength(2)
    expect(sources.items[1]?.groupAvatar).toMatchObject({
      memberCount: 2,
      strategy: 'owner_recent_speakers',
      computedAtMillis: 1787036400000,
      slots: [{ avatarRef: expect.stringMatching(/^arkme-profile-image-v1\./) }, { avatarRef: expect.any(String) }],
    })
    expect(JSON.stringify(sources)).not.toContain('x-oss-signature')
    expect(profileReads).toBe(1)

    const sourceCache = (service as unknown as { source: {
      cachedChatSource(userId: number, chatSessionUid: string): ArkmeSourceItem | undefined
      chatSourceFromBundle(
        bundle: Record<string, unknown>,
        session: ArkmeSessionCredentials,
        cached: ArkmeSourceItem | undefined,
        timelineItems: [],
      ): Promise<ArkmeSourceItem>
    } }).source
    const cachedPrivate = sourceCache.cachedChatSource(10001, 'private-1')
    const cachedGroup = sourceCache.cachedChatSource(10001, 'group-1')
    expect(cachedPrivate).toMatchObject({
      peerUserId: 20002,
      avatarRef: sources.items[0]?.avatarRef,
    })
    expect(cachedGroup).toMatchObject({
      avatarRefs: sources.items[1]?.avatarRefs,
      groupAvatar: sources.items[1]?.groupAvatar,
    })

    sources.items[0]!.avatarRef = 'mutated-private-avatar'
    sources.items[1]!.avatarRefs![0] = 'mutated-group-avatar'
    sources.items[1]!.groupAvatar!.slots[0]!.avatarRef = 'mutated-group-presentation'
    expect(sourceCache.cachedChatSource(10001, 'private-1')?.avatarRef).not.toBe('mutated-private-avatar')
    expect(sourceCache.cachedChatSource(10001, 'group-1')?.avatarRefs?.[0]).not.toBe('mutated-group-avatar')
    expect(sourceCache.cachedChatSource(10001, 'group-1')?.groupAvatar?.slots[0]?.avatarRef)
      .not.toBe('mutated-group-presentation')

    const session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    await expect(sourceCache.chatSourceFromBundle({
      session: { chat_session_uid: 'private-1', session_kind: 1, last_active_at: 3, last_seq: 1 },
      private_counterpart: { user_id: 20002, display_name_snapshot: '联系人' },
      unread_snapshot: { unread_count: 1, session_last_seq: 1 },
    }, session, sourceCache.cachedChatSource(10001, 'private-1'), [])).resolves.toMatchObject({
      avatarRef: cachedPrivate?.avatarRef,
    })
    await expect(sourceCache.chatSourceFromBundle({
      session: { chat_session_uid: 'group-1', session_kind: 2, title: '群聊', last_active_at: 3, last_seq: 1 },
      unread_snapshot: { unread_count: 1, session_last_seq: 1 },
    }, session, sourceCache.cachedChatSource(10001, 'group-1'), [])).resolves.toMatchObject({
      avatarRefs: cachedGroup?.avatarRefs,
      groupAvatar: cachedGroup?.groupAvatar,
    })

    await expect(service.readImage(cachedPrivate!.avatarRef!)).resolves.toMatchObject({
      mediaType: 'image/png', bytes: png.byteLength,
    })
    await expect(service.readImage(cachedPrivate!.avatarRef!)).resolves.toMatchObject({
      mediaType: 'image/png', bytes: png.byteLength,
    })
    expect(profileReads).toBe(1)
    expect(imageDownloads).toBe(1)
    sessions.session = { userId: 10002, accessToken: 'other-access', refreshToken: 'other-refresh' }
    await expect(service.readImage(cachedPrivate!.avatarRef!)).rejects.toMatchObject({ code: 'image-ref-invalid' })
  })

  it('bounds concurrent image downloads at the Host cache boundary', async () => {
    const service = new ArkmeService(config, new MemorySessionStore(), new MemoryStateStore(), vi.fn())
    const internal = service as unknown as {
      withImageDownloadPermit<T>(operation: () => Promise<T>): Promise<T>
    }
    let active = 0
    let peak = 0
    const results = await Promise.all(Array.from({ length: 9 }, async (_, index) => await internal.withImageDownloadPermit(async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 5))
      active -= 1
      return index
    })))

    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(peak).toBe(4)
  })

  it('keeps all five server-selected group avatar slots when profiles are missing or use phone defaults', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const signedAvatar = 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/a/21/avatar.png?x-oss-signature=member'
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      if (url.endsWith('/api/v1/chats/list')) return json({ code: 200, data: { items: [{
        session: { chat_session_uid: 'group-five', session_kind: 2, title: '五人群', last_active_at: 1 },
        unread_snapshot: { unread_count: 0 },
      }] } })
      if (url.endsWith('/api/v1/chats/group-avatar-snapshots')) return json({ code: 200, data: { items: [{
        chat_session_uid: 'group-five', member_count: 12, strategy: 'owner_recent_speakers', computed_at: 1787036400000,
        members: [21, 22, 23, 24, 25, 26].map(user_id => ({ user_id })),
      }] } })
      if (url.endsWith('/api/v1/auth/get-public-users-by-ids')) {
        expect(body.user_ids).toEqual([21, 22, 23, 24, 25])
        return json({ code: 200, data: { items: [
          { user_id: 21, nick_name: '真实头像', head_img: signedAvatar },
          { user_id: 22, nick_name: '手机号头像', head_img: 'phone_avatar://v1/17/53' },
          { user_id: 24, nick_name: '空头像', head_img: '' },
          { user_id: 25, nick_name: '不可信头像', head_img: 'https://example.com/avatar.png' },
        ] } })
      }
      throw new Error(`unexpected ${url}`)
    })

    const source = (await service.listSources('root')).items[0]!
    expect(source.avatarRefs).toHaveLength(1)
    expect(source.groupAvatar).toEqual({
      memberCount: 12,
      strategy: 'owner_recent_speakers',
      computedAtMillis: 1787036400000,
      slots: [
        { avatarRef: expect.stringMatching(/^arkme-profile-image-v1\./) },
        { fallback: { kind: 'phone_default', colorIndex: 5, label: '53' } },
        { fallback: { kind: 'default' } },
        { fallback: { kind: 'default' } },
        { fallback: { kind: 'default' } },
      ],
    })
    expect(JSON.stringify(source)).not.toContain('group-five')
    expect(JSON.stringify(source)).not.toContain('x-oss-signature')
    expect(JSON.stringify(source)).not.toContain('example.com')
  })

  it('projects the DSH beta community entry with only opaque real-avatar refs', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, body })
      if (url.endsWith('/api/v1/chats/community/dsh-beta/entry-state')) return json({ code: 200, data: {
        status: 'ready',
        visible: true,
        chat_session_uid: 'official-group-1',
        group_title: 'DSH 内测群1号群',
        group_avatar_snapshot: {
          member_count: 2,
          members: [{ user_id: 11 }, { user_id: 20002 }],
        },
      } })
      if (url.endsWith('/api/v1/auth/get-public-users-by-ids')) return json({ code: 200, data: {
        items: [
          { user_id: 11, nick_name: '群主', head_img: 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/a/11/owner.png?x-oss-signature=owner' },
          { user_id: 20002, nick_name: '成员', head_img: 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/a/20002/member.png?x-oss-signature=member' },
        ],
      } })
      throw new Error(`unexpected ${url}`)
    })

    const entry = await service.dshBetaCommunityEntryState()
    expect(entry).toMatchObject({
      status: 'ready', visible: true, groupTitle: 'DSH 内测群1号群', memberCount: 2,
    })
    expect(entry.avatarRefs).toHaveLength(2)
    expect(entry.groupAvatar?.slots).toHaveLength(2)
    expect(entry.avatarRefs.every(ref => ref.startsWith('arkme-profile-image-v1.'))).toBe(true)
    expect(JSON.stringify(entry)).not.toContain('official-group-1')
    expect(JSON.stringify(entry)).not.toContain('x-oss-signature')
    expect(requests[0]).toEqual({
      url: 'https://chat.test/api/v1/chats/community/dsh-beta/entry-state',
      body: {},
    })
    expect(requests[1]?.body).toEqual({ user_ids: [11, 20002] })
  })

  it('does not invent a DSH beta community avatar when real avatars cannot be resolved', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const service = new ArkmeService(config, sessions, state, async (input) => {
      const url = String(input)
      if (url.endsWith('/api/v1/chats/community/dsh-beta/entry-state')) return json({ code: 200, data: {
        status: 'ready', visible: true, group_title: 'DSH 内测群1号群',
        group_avatar_snapshot: { member_count: 1, members: [{ user_id: 11 }] },
      } })
      if (url.endsWith('/api/v1/auth/get-public-users-by-ids')) throw new TypeError('profile service unavailable')
      throw new Error(`unexpected ${url}`)
    })

    await expect(service.dshBetaCommunityEntryState()).resolves.toEqual({
      status: 'ready', visible: true, groupTitle: 'DSH 内测群1号群', memberCount: 1, avatarRefs: [],
      groupAvatar: {
        memberCount: 1, strategy: '', computedAtMillis: 0,
        slots: [{ fallback: { kind: 'default' } }],
      },
    })
  })

  it('turns the final joined official group into a normal source without exposing its raw session id', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      calls.push({ url, body })
      if (url.endsWith('/api/v1/chats/community/dsh-beta/join')) return json({ code: 200, data: {
        status: 'joined', chat_session_uid: 'official-group-2', group_title: 'DSH 内测群2号群',
      } })
      if (url.endsWith('/api/v1/chats/group-avatar-snapshots')) return json({ code: 200, data: {
        items: [{ chat_session_uid: 'official-group-2', members: [{ user_id: 11 }, { user_id: 10001 }] }],
      } })
      if (url.endsWith('/api/v1/auth/get-public-users-by-ids')) return json({ code: 200, data: {
        items: [
          { user_id: 11, nick_name: '群主', head_img: 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/a/11/owner.png?x-oss-signature=owner' },
          { user_id: 10001, nick_name: '我', head_img: 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/a/10001/me.png?x-oss-signature=me' },
        ],
      } })
      if (url.endsWith('/api/v1/chat/timeline/page')) return json({ code: 200, data: { items: [], has_more: false } })
      throw new Error(`unexpected ${url}`)
    })

    const joined = await service.joinDSHBetaCommunity()
    expect(joined).toMatchObject({
      status: 'joined',
      source: { kind: 'group_chat', displayName: 'DSH 内测群2号群', avatarRefs: expect.any(Array) },
    })
    expect(joined.source.avatarRefs).toHaveLength(2)
    expect(joined.source.sourceRef).toMatch(/^arkme-source-v1\./)
    expect(JSON.stringify(joined)).not.toContain('official-group-2')
    expect(calls[0]).toEqual({ url: 'https://chat.test/api/v1/chats/community/dsh-beta/join', body: {} })
    expect(calls[1]?.body).toEqual({ chat_session_uids: ['official-group-2'] })

    await service.readSource(joined.source.sourceRef)
    expect(calls.at(-1)?.body).toMatchObject({ chat_session_uid: 'official-group-2' })
  })

  it('hydrates an already-member official group title from the returned session identity', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      calls.push({ url, body })
      if (url.endsWith('/api/v1/chats/community/dsh-beta/join')) return json({ code: 200, data: {
        status: 'already_member', chat_session_uid: 'official-group-1',
      } })
      if (url.endsWith('/api/v1/chats/detail')) return json({ code: 200, data: {
        session: { chat_session_uid: 'official-group-1', session_kind: 2, title: 'DSH 内测群1号群' },
      } })
      if (url.endsWith('/api/v1/chats/group-avatar-snapshots')) return json({ code: 200, data: { items: [] } })
      throw new Error(`unexpected ${url}`)
    })

    const joined = await service.joinDSHBetaCommunity()

    expect(joined).toMatchObject({
      status: 'already_member',
      source: { kind: 'group_chat', displayName: 'DSH 内测群1号群' },
    })
    expect(calls[1]).toEqual({
      url: 'https://chat.test/api/v1/chats/detail',
      body: { chat_session_uid: 'official-group-1' },
    })
  })

  it('keeps an already-committed official join usable when session decoration is unavailable', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input) => {
      const url = String(input)
      if (url.endsWith('/api/v1/chats/community/dsh-beta/join')) return json({ code: 200, data: {
        status: 'already_member', chat_session_uid: 'official-group-1',
      } })
      if (url.endsWith('/api/v1/chats/detail')) throw new TypeError('session service unavailable')
      if (url.endsWith('/api/v1/chats/group-avatar-snapshots')) throw new TypeError('avatar service unavailable')
      throw new Error(`unexpected ${url}`)
    })

    await expect(service.joinDSHBetaCommunity()).resolves.toMatchObject({
      status: 'already_member',
      source: { kind: 'group_chat', displayName: 'DSH 内测群' },
    })
  })

  it('rejects incomplete DSH beta community join responses without inventing a group', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async () => json({
      code: 200,
      data: { status: 'joined', chat_session_uid: '', group_title: '' },
    }))

    await expect(service.joinDSHBetaCommunity()).rejects.toMatchObject({
      code: 'dsh-beta-community-contract-invalid',
    })
  })

  it('keeps failed writes in the account outbox and retries with the same record uid', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    let attempts = 0
    const bodies: Record<string, unknown>[] = []
    const service = new ArkmeService(config, sessions, state, async (_input, init) => {
      state.events.push('remote-create')
      attempts += 1
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      if (attempts === 1) throw new TypeError('network down')
      return json({ code: 0, data: { record_uid: bodies[0]?.record_uid, status: 1 } })
    })
    const recordUid = '6ba7b810-9dad-41d1-80b4-00c04fd430c8'

    await expect(service.createText(recordUid, 'durable text')).rejects.toMatchObject({
      code: 'arkme-network-error',
    } satisfies Partial<ArkmePluginError>)
    expect(await service.pendingWrites()).toMatchObject([{
      recordUid,
      textContent: 'durable text',
      attempts: 1,
    }])
    expect(state.events.slice(0, 2)).toEqual(['local-pending', 'remote-create'])

    await expect(service.retryPending(recordUid)).resolves.toEqual({ recordUid, status: 1 })
    expect(bodies).toHaveLength(2)
    expect(bodies[0]?.record_uid).toBe(recordUid)
    expect(bodies[1]?.record_uid).toBe(recordUid)
    expect(await service.pendingWrites()).toEqual([])
  })

  it('reports a conversation write as locally retained when remote sync fails', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const service = new ArkmeService(config, sessions, state, async () => {
      state.events.push('remote-create')
      throw new TypeError('offline')
    })
    const recordUid = 'a5d8df82-5b62-5b22-8f76-916a751ad63c'

    await expect(service.createTextForConversation(recordUid, 'conversation note')).resolves.toMatchObject({
      recordUid,
      status: 0,
      localState: 'failed',
      error: '无法连接Arkme 服务',
    })
    expect(state.events.slice(0, 2)).toEqual(['local-pending', 'remote-create'])
    expect(await service.pendingWrites()).toMatchObject([{
      recordUid,
      textContent: 'conversation note',
      attempts: 1,
    }])
  })

  it('queries every supported imported-WeChat capability through the Relation owner', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const calls: Array<{ url: string; body: Record<string, unknown>; authorization: string | null }> = []
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      calls.push({ url, body, authorization: new Headers(init?.headers).get('Authorization') })
      if (url.endsWith('/wechat-import-conversations/list')) return json({ code: 200, data: {
        conversations: [
          {
            import_session_key: 'session-mom', name: '妈妈', remark: '妈妈', nickname: 'Alice',
            ext_is_group: false, message_count: 42, last_send_at: 200,
          },
          {
            import_session_key: 'session-group', name: '家人群', ext_is_group: true,
            message_count: 80, last_send_at: 190, bound_chat_session_uid: 'bound-chat',
          },
        ],
        total: 2, has_more: false, next_offset: 2,
      } })
      if (url.endsWith('/wechat-import-conversation-records/list')) return json({ code: 200, data: {
        records: [{
          content: '周末回家吃饭', sender_display_name: '妈妈', sender_is_self: false,
          send_at: 180, msg_type: 1, media_path: 'image.jpg', media_duration: 3, mime_type: 'image/jpeg',
        }],
        total: 1, has_more: false, next_offset: 1,
      } })
      if (url.endsWith('/wechat-import-conversation-detail')) return json({ code: 200, data: {
        name: '妈妈', remark: '妈妈', nickname: 'Alice', ext_is_group: false,
        wechat_alias: 'alice', wechat_id: 'wx-alice', message_count: 42,
        voice_count: 2, image_count: 3, emoji_count: 4, video_count: 5,
        first_send_at: 10, last_send_at: 200, imported_at: 300, common_group_count: 2,
      } })
      if (url.endsWith('/wechat-import-group-members/list')) return json({ code: 200, data: {
        members: [{ name: '我', message_count: 10, is_self: true, is_in_group: true }],
        inactive_speakers: [{ name: '已退群成员', message_count: 2, last_send_at: 100, is_in_group: false }],
        total_speakers: 2,
      } })
      if (url.endsWith('/wechat-import-phones/list')) return json({ code: 200, data: {
        phones: [{
          phone: '13800138000', likely_owner: '妈妈', confidence: 0.9, reason: '聊天上下文',
          record_count: 2, last_send_at: 170, is_registered: true, registered_nick_name: 'Alice',
          phone_location_label: '浙江 杭州', task_status: 'done',
          evidence: [{ why: '明确提到手机号', content: '电话 13800138000', send_at: 160 }],
        }],
        total: 1, has_more: false, next_offset: 1,
      } })
      if (url.endsWith('/wechat-import-common-groups/list')) return json({ code: 200, data: {
        friends: [{ name: '小林', common_group_count: 3, last_send_at: 150, sample_group_keys: ['session-group'] }],
        total: 1, has_more: false, next_offset: 1,
      } })
      if (url.endsWith('/wechat-import-money-flows/list')) return json({ code: 200, data: {
        records: [{
          import_session_key: 'session-mom', content: '转账 100 元', sender_display_name: '妈妈',
          sender_is_self: false, send_at: 140,
        }],
        total: 1, has_more: false, next_offset: 1,
      } })
      if (url.endsWith('/wechat-import-location-entries')) return json({ code: 200, data: {
        entry_ls: [{
          import_session_key: 'session-group', entry_type: 'sent_manual_location', lat: 30.1, lon: 120.2,
          poi_name: '西湖', address: '杭州', sender_display_name: '妈妈', sender_is_self: false, send_at: 130,
          conversation: { import_session_key: 'session-group', name: '家人群' },
        }],
      } })
      throw new Error(`unexpected ${url}`)
    })

    const conversations = await service.listWechatConversations()
    expect(conversations.conversations).toMatchObject([
      { name: '妈妈', isGroup: false, messageCount: 42, isBound: false },
      { name: '家人群', isGroup: true, messageCount: 80, isBound: true },
    ])
    expect(conversations.conversations[0]?.conversationRef).not.toContain('session-mom')
    const momRef = conversations.conversations[0]!.conversationRef
    const groupRef = conversations.conversations[1]!.conversationRef

    await expect(service.readWechatMessages(momRef, { messageType: 'image' })).resolves.toMatchObject({
      conversationRef: momRef,
      messages: [{ content: '周末回家吃饭', senderName: '妈妈', messageType: 'image', hasMedia: true }],
    })
    await expect(service.getWechatConversationDetail(momRef)).resolves.toMatchObject({
      name: '妈妈', wechatAlias: 'alice', wechatId: 'wx-alice', messageCount: 42,
    })
    await expect(service.listWechatGroupMembers(groupRef)).resolves.toMatchObject({
      members: [{ name: '我', isMe: true, isInGroup: true }, { name: '已退群成员', isInGroup: false }],
      total: 2,
    })
    await expect(service.listWechatPhones()).resolves.toMatchObject({
      phones: [{ phone: '13800138000', likelyOwner: '妈妈', location: '浙江 杭州', isRegistered: true }],
    })
    await expect(service.listWechatCommonGroups()).resolves.toMatchObject({
      friends: [{ name: '小林', commonGroupCount: 3, sampleConversationRefs: [expect.stringMatching(/^arkme-wechat-conversation-v1\./)] }],
    })
    await expect(service.listWechatMoneyFlows()).resolves.toMatchObject({
      moneyFlows: [{ content: '转账 100 元', senderName: '妈妈', conversationRef: expect.stringMatching(/^arkme-wechat-conversation-v1\./) }],
    })
    await expect(service.listWechatLocations()).resolves.toMatchObject({
      locations: [{ conversationName: '家人群', poiName: '西湖', latitude: 30.1, longitude: 120.2 }],
    })
    expect(calls.every(call => call.url.startsWith('https://relation.test/api/v1/entity/'))).toBe(true)
    expect(calls.every(call => call.authorization === 'Bearer access')).toBe(true)
    expect(calls[0]?.body).toMatchObject({ limit: 30, offset: 0, include_bound: true })
    expect(calls[1]?.body).toMatchObject({ import_session_key: 'session-mom', msg_type: 1 })
  })

  it('binds imported-WeChat references and cursors to the current account and query', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const fetchImpl = vi.fn<typeof fetch>(async () => json({ code: 200, data: {
      conversations: [{ import_session_key: 'session-1', name: '会话', message_count: 1 }],
      total: 2, has_more: true, next_offset: 1,
    } }))
    const service = new ArkmeService(config, sessions, state, fetchImpl)
    const page = await service.listWechatConversations({ limit: 1 })

    await expect(service.listWechatPhones({ cursor: page.nextCursor! })).rejects.toMatchObject({
      code: 'wechat-cursor-invalid',
    })
    sessions.session = { userId: 10002, accessToken: 'other-access', refreshToken: 'other-refresh' }
    await expect(service.getWechatConversationDetail(page.conversations[0]!.conversationRef)).rejects.toMatchObject({
      code: 'wechat-conversation-ref-invalid',
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('preflights, creates, and reads AI video jobs through the Intelligent origin', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const requests: Array<{ url: string; authorization: string; body: Record<string, unknown> }> = []
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({
        url,
        authorization: new Headers(init?.headers).get('Authorization') ?? '',
        body,
      })
      if (url.endsWith('/preflight')) {
        return json({ code: 200, data: {
          allowed: true,
          message: '所选内容可以生成视频',
          selected_duration_millis: 12_000,
          minimum_duration_millis: 3_000,
          selected_segment_count: 1,
          proof: 'private-proof',
        } })
      }
      if (url.endsWith('/jobs/create')) {
        return json({ code: 200, data: {
          job_id: 'job-1', status: 'queued', stage: 'queued', progress: 0,
          selection: { segments: [{}] },
        } })
      }
      if (url.endsWith('/jobs/status')) {
        return json({ code: 200, data: {
          job_id: 'job-1', status: 'succeeded', stage: 'succeeded', progress: 100,
          selection: { segments: [{}] },
          video_asset_uid: 'video-asset-1', cover_asset_uid: 'cover-asset-1',
          video_duration_millis: 11_800,
        } })
      }
      throw new Error(`unexpected URL ${url}`)
    })
    const service = new ArkmeService(config, sessions, state, fetchImpl)
    const segments = [{ childId: 'child-1', asrItemIndex: 2, transcriptSource: 'system' as const }]

    const preflight = await service.aiVideoPreflight('session-1', segments)
    const created = await service.aiVideoCreate('request-1', 'session-1', segments, preflight.proof ?? '')
    const completed = await service.aiVideoStatus(created.jobId)

    expect(preflight).toEqual({
      allowed: true,
      message: '所选内容可以生成视频',
      selectedDurationMillis: 12_000,
      minimumDurationMillis: 3_000,
      selectedSegmentCount: 1,
      retryable: false,
      proof: 'private-proof',
    })
    expect(completed).toMatchObject({
      jobId: 'job-1', status: 'succeeded', stage: 'succeeded', progress: 100,
      selectedSegmentCount: 1, videoAssetUid: 'video-asset-1', coverAssetUid: 'cover-asset-1',
    })
    expect(requests).toEqual([
      {
        url: 'https://intelligent.test/api/v1/ai-comic-video/preflight',
        authorization: 'Bearer access',
        body: {
          session_id: 'session-1',
          selection: {
            kind: 'long_recording_segments',
            segments: [{ child_id: 'child-1', asr_item_index: 2, transcript_source: 'system' }],
          },
        },
      },
      {
        url: 'https://intelligent.test/api/v1/ai-comic-video/jobs/create',
        authorization: 'Bearer access',
        body: {
          client_request_id: 'request-1',
          session_id: 'session-1',
          selection: {
            kind: 'long_recording_segments',
            segments: [{ child_id: 'child-1', asr_item_index: 2, transcript_source: 'system' }],
          },
          preflight_proof: 'private-proof',
        },
      },
      {
        url: 'https://intelligent.test/api/v1/ai-comic-video/jobs/status',
        authorization: 'Bearer access',
        body: { job_id: 'job-1' },
      },
    ])
  })

  it('preserves actionable AI video service errors', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async () => json({
      code: 1001,
      message: '参数错误',
      data: {
        error_code: 'active_job_limit',
        message: '当前已有3个视频正在生成，请完成或取消后再试',
      },
    }))

    await expect(service.aiVideoPreflight('session-1', [
      { childId: 'child-1', asrItemIndex: 0, transcriptSource: 'system' },
    ])).rejects.toMatchObject({
      code: 'active_job_limit',
      message: '当前已有3个视频正在生成，请完成或取消后再试',
      retryable: false,
    })
  })

  it('maps remote record, scene, and recording search contracts', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      requests.push({ url, body })
      if (url.endsWith('/search/recordings/query')) return json({ code: 0, data: {
        items: [{ session_id: 'session-1', record_uid: 'recording-record-1', date_stamp: 100, start_at: 200, snippet: '北京复盘', score: 0.8 }],
        has_more: false, query_guard: { state: 'complete' },
      } })
      return json({ code: 0, data: {
        items: [{
          record_uid: 'record-1', source_kind: 2, source_uid: 'topic-1', route_target_kind: 'home_feed',
          send_at: 123, record_core: {
            title: '项目复盘', text_content: '正文 https://example.com/detail', nickname: '小林',
            template_kind: 3, display_kind: 4,
            content_payload: {
              media_refs: [{ file_asset_uid: 'image-1', file_uid: 'file-1', file_name: '截图.png', mime_type: 'image/png', size: 2048 }],
              voice: { source_file_asset_uid: 'voice-1', file_name: '录音.m4a', mime_type: 'audio/mp4', duration_millis: 3000 },
            },
          },
          match_summary: { snippet: '命中复盘' }, scene_item_count: 2,
          file_ls: [{ file_asset_uid: 'document-1', file_name: '方案.pdf', mime_type: 'application/pdf', size: 4096 }],
        }],
        source_aggregates: [{
          source_kind: 2, source_uid: 'topic-1', route_target_kind: 'home_feed', matched_record_count: 1,
          matched_record_count_exact: true, topic_core: { title: '项目主题' },
        }],
        has_more: false, query_guard: { state: 'ok' }, page_summary: { item_count: 2, item_size: 2048 },
      } })
    })

    await expect(service.searchRemote({ query: '复盘', limit: 20 })).resolves.toMatchObject({
      items: [{
        recordUid: 'record-1', title: '项目复盘', snippet: '命中复盘', templateKind: 3, displayKind: 4,
        targetSource: { kind: 'topic', displayName: '项目主题', sourceRef: expect.stringMatching(/^arkme-source-v1\./) },
        media: [{ fileAssetUid: 'image-1', fileName: '截图.png', mimeType: 'image/png', size: 2048 }],
        files: [{ fileAssetUid: 'document-1', fileName: '方案.pdf', mimeType: 'application/pdf', size: 4096 }],
        voice: { fileAssetUid: 'voice-1', fileName: '录音.m4a', mimeType: 'audio/mp4', durationMillis: 3000 },
        linkUrl: 'https://example.com/detail',
      }],
      sourceAggregates: [{ sourceUid: 'topic-1', title: '项目主题' }],
    })
    await expect(service.searchScene({ scene: 'image_video', limit: 10 })).resolves.toMatchObject({ itemCount: 2, itemSize: 2048 })
    await expect(service.searchRecordings({ query: '北京', limit: 9 })).resolves.toMatchObject({
      items: [{ sessionId: 'session-1', snippet: '北京复盘' }],
    })
    expect(requests.filter(item => !item.url.endsWith('/api/v1/records/privacy/visibility-snapshot')).map(item => item.body)).toEqual([
      { keyword: '复盘', limit: 20, search_scope: 'global', source_kinds: [1, 2, 3] },
      { scene_kind: 3, limit: 10, search_scope: 'global' },
      { keyword: '北京', limit: 9 },
    ])
  })

  it('lists AI videos and resolves only safe display asset URLs', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async input => {
      const url = String(input)
      if (url.endsWith('/ai-comic-video/jobs/list')) return json({ code: 200, data: {
        items: [{
          job_id: 'job-1', session_id: 'session-1', status: 'succeeded', stage: 'succeeded', progress: 100,
          selected_segment_count: 2, source_recording: { title: '周会', started_at: 100, selected_duration_millis: 8_000 },
          video_asset_uid: 'video-1', cover_asset_uid: 'cover-1', retryable: false, created_at: 200, updated_at: 300,
        }],
        has_more: false,
      } })
      return json({ code: 0, data: { items: [
        { file_asset_uid: 'video-1', status: 'ready', download_url: 'https://oss.example/video.mp4' },
        { file_asset_uid: 'cover-1', status: 'ready', preview_url: 'javascript:alert(1)' },
      ] } })
    })

    await expect(service.aiVideoList({ limit: 20 })).resolves.toMatchObject({
      items: [{ jobId: 'job-1', title: '周会', videoAssetUid: 'video-1', coverAssetUid: 'cover-1' }],
    })
    await expect(service.queryFileAssets(['video-1', 'cover-1'])).resolves.toEqual([
      { fileAssetUid: 'video-1', status: 'ready', downloadUrl: 'https://oss.example/video.mp4' },
      { fileAssetUid: 'cover-1', status: 'ready' },
    ])
  })

  it('builds an image-only safe projection after draining a video-only scene page', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const requestBodies: Record<string, unknown>[] = []
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      if (url.endsWith('/api/v1/records/privacy/visibility-snapshot')) {
        return json({ code: 0, data: { items: [], has_more: false } })
      }
      if (url.endsWith('/api/v1/search/records/scene/query')) {
        requestBodies.push(body)
        if (body.cursor === undefined) return json({ code: 0, data: {
          items: [{
            record_uid: 'video-record', send_at: 200,
            record_core: { content_payload: { media_refs: [{ file_asset_uid: 'video-asset', file_kind: 3, mime_type: 'video/mp4' }] } },
          }],
          has_more: true, next_cursor: 'image-page', query_guard: { state: 'ok' },
        } })
        return json({ code: 0, data: {
          items: [{
            record_uid: 'image-record', send_at: 100, record_core: {
              title: '桌面截图',
              content_payload: { media_refs: [
                // Production scene search may omit both MIME and file_kind.
                { file_asset_uid: 'image-asset', file_name: '截图.png', size: 2048 },
                { file_asset_uid: 'video-cover', file_kind: 3, mime_type: 'video/mp4', file_name: '片段.mp4' },
                { file_asset_uid: 'ambiguous-video', file_name: '视频封面.jpg' },
              ] },
            },
          }],
          has_more: false, query_guard: { state: 'ok' },
        } })
      }
      if (url.endsWith('/api/v1/files/assets/query')) {
        requestBodies.push(body)
        return json({ code: 0, data: { items: [{
          file_asset_uid: 'image-asset', file_name: '截图.png', mime_type: 'image/png', status: 'ready',
          preview_url: 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/private/signed-image.png?x-oss-signature=test',
        }, {
          file_asset_uid: 'ambiguous-video', file_name: '视频封面.jpg', mime_type: 'video/mp4', status: 'ready',
          preview_url: 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/private/video-cover.jpg?x-oss-signature=test',
        }] } })
      }
      if (url.includes('/private/signed-image.png')) {
        return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), {
          status: 200,
          headers: { 'Content-Type': 'image/png', 'Content-Length': '8' },
        })
      }
      throw new Error(`unexpected request ${url}`)
    })

    const result = await service.searchImages({ limit: 10 })

    expect(result).toMatchObject({
      items: [{
        itemKey: expect.any(String), mediaRef: expect.stringMatching(/^arkme-media-v1\./),
        recordUid: 'image-record', fileName: '截图.png', mimeType: 'image/png', recordTitle: '桌面截图',
      }],
      hasMore: false,
    })
    expect(JSON.stringify(result)).not.toContain('x-oss-signature')
    expect(JSON.stringify(result)).not.toContain('image-asset')
    expect(JSON.stringify(result)).not.toContain('video-cover')
    expect(JSON.stringify(result)).not.toContain('ambiguous-video')
    await expect(service.readImage(result.items[0]!.mediaRef)).resolves.toMatchObject({
      mediaType: 'image/png', bytes: 8,
    })
    expect(requestBodies).toEqual([
      { scene_kind: 3, limit: 10, search_scope: 'global' },
      { scene_kind: 3, limit: 10, search_scope: 'global', cursor: 'image-page' },
      { file_asset_uids: ['image-asset', 'ambiguous-video'] },
    ])
  })

  it('keeps a continuation cursor after the bounded image-scene drain finds only videos', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    let pageCount = 0
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async input => {
      const url = String(input)
      if (url.endsWith('/api/v1/records/privacy/visibility-snapshot')) {
        return json({ code: 0, data: { items: [], has_more: false } })
      }
      if (!url.endsWith('/api/v1/search/records/scene/query')) throw new Error(`unexpected request ${url}`)
      pageCount += 1
      return json({ code: 0, data: {
        items: [{
          record_uid: `video-record-${String(pageCount)}`, send_at: pageCount,
          record_core: { content_payload: { media_refs: [{ file_asset_uid: `video-${String(pageCount)}`, file_kind: 3, mime_type: 'video/mp4' }] } },
        }],
        has_more: true, next_cursor: `page-${String(pageCount)}`, query_guard: { state: 'ok' },
      } })
    })

    await expect(service.searchImages({ limit: 10 })).resolves.toMatchObject({
      items: [], hasMore: true, nextCursor: 'page-8',
    })
    expect(pageCount).toBe(8)
  })

  it('asks Arko through the AgentDirect Intelligent session and projects the SSE tail', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const requests: Array<{ url: string; method: string; authorization: string; body?: Record<string, unknown> }> = []
    const runUid = '11111111-1111-4111-8111-111111111111'
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const authorization = new Headers(init?.headers).get('Authorization') ?? ''
      const body = init?.body === undefined ? undefined : JSON.parse(String(init.body)) as Record<string, unknown>
      requests.push({ url, method, authorization, ...(body === undefined ? {} : { body }) })
      if (url === 'https://intelligent.test/api/v1/qa/latest-session') {
        return json({ code: 200, data: { id: 0 } })
      }
      if (url === 'https://intelligent.test/api/v1/qa/new-session') {
        return json({ code: 200, data: { session_id: 88 } })
      }
      if (url === 'https://intelligent.test/api/v1/agent/model/list') {
        return json({ code: 200, data: {
          default_route_key: 'dashscope/deepseek-v4-pro',
          effective_route_key: 'dashscope/qwen3.8-max',
          selection_source: 'personal',
          items: [
            {
              route_key: 'dashscope/deepseek-v4-pro', display_name: 'DeepSeek V4 Pro', provider: 'dashscope',
              description: '综合能力强，适合复杂任务', recommended: true, selected: false,
            },
            {
              route_key: 'dashscope/qwen3.8-max', display_name: 'Qwen 3.8 Max', provider: 'dashscope',
              description: '长上下文与中文理解能力突出', recommended: false, selected: true,
            },
          ],
        } })
      }
      if (url === 'https://intelligent.test/api/v1/qa/new-msg-v2') {
        return json({ code: 200, data: {
          session_id: 88,
          user_msg_id: 1001,
          assistant_msg_id: 1002,
          run_uid: runUid,
        } })
      }
      if (url.startsWith('https://intelligent.test/api/v1/qa/stream-v2?')) {
        expect(method).toBe('GET')
        const mid = JSON.stringify({ mid: { content: '已经总结好了', reason_content: '正在读取资料', total_sec: 1 } })
        const tail = JSON.stringify({ tail: {
          total_sec: 2,
          agent_run_uid: runUid,
          agent_run_status: 'completed',
          created_record_uids: ['record-by-arko'],
          agent_profile: { display_name: 'Arko', version: 2 },
        } })
        return new Response(`data: ${mid}\n\ndata: ${tail}\n\n`, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      }
      throw new Error(`unexpected URL ${url}`)
    })
    const service = new ArkmeService(config, sessions, state, fetchImpl)

    await expect(service.arkoAsk('帮我总结今天的快记', { clientTurnUid: 'turn-1', waitMillis: 1000 }))
      .resolves.toEqual({
        sessionId: 88,
        userMsgId: 1001,
        assistantMsgId: 1002,
        runUid,
        text: '已经总结好了',
        reasoning: '正在读取资料',
        status: 'completed',
        terminal: true,
        timedOut: false,
        createdRecordUids: ['record-by-arko'],
        profile: { displayName: 'Arko', version: 2 },
        run: { runUid, status: 'completed', retryable: false },
      })
    expect(requests.map(request => [request.method, request.url.split('?')[0]])).toEqual([
      ['POST', 'https://intelligent.test/api/v1/qa/latest-session'],
      ['POST', 'https://intelligent.test/api/v1/qa/new-session'],
      ['POST', 'https://intelligent.test/api/v1/agent/model/list'],
      ['POST', 'https://intelligent.test/api/v1/qa/new-msg-v2'],
      ['GET', 'https://intelligent.test/api/v1/qa/stream-v2'],
    ])
    expect(requests[3]?.body).toMatchObject({
      model: 2,
      session_id: 88,
      content: '帮我总结今天的快记',
      extra: '{}',
      client_turn_uid: 'turn-1',
      client_capabilities: ['dsh.arko.v1'],
      model_route_key: 'dashscope/qwen3.8-max',
    })
    expect(requests.every(request => request.authorization === 'Bearer access')).toBe(true)
  })

  it('preserves an accepted Arko run for polling when its SSE connection fails', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const runUid = '11111111-1111-4111-8111-111111111111'
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async input => {
      const url = String(input)
      if (url.endsWith('/api/v1/qa/new-msg-v2')) {
        return json({ code: 200, data: {
          session_id: 88, user_msg_id: 1001, assistant_msg_id: 1002, run_uid: runUid,
        } })
      }
      if (url.startsWith('https://intelligent.test/api/v1/qa/stream-v2?')) {
        throw new TypeError('connection reset')
      }
      throw new Error(`unexpected URL ${url}`)
    })

    await expect(service.arkoAsk('创建一条快记', {
      sessionId: 88,
      clientTurnUid: 'turn-network-failure',
      modelRouteKey: 'dashscope/deepseek-v4-pro',
      waitMillis: 1000,
    })).resolves.toMatchObject({
      sessionId: 88,
      userMsgId: 1001,
      assistantMsgId: 1002,
      runUid,
      status: 'stream_timeout',
      terminal: false,
      timedOut: true,
    })
  })

  it('loads AgentDirect history and activates a server-provided model route', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const bodies: Record<string, unknown>[] = []
    const catalog = {
      default_route_key: 'dashscope/deepseek-v4-pro',
      effective_route_key: 'dashscope/qwen3.8-max',
      selection_source: 'personal',
      items: [
        {
          route_key: 'dashscope/deepseek-v4-pro', display_name: 'DeepSeek V4 Pro', provider: 'dashscope',
          description: '综合能力强，适合复杂任务', recommended: true, selected: false,
        },
        {
          route_key: 'dashscope/qwen3.8-max', display_name: 'Qwen 3.8 Max', provider: 'dashscope',
          description: '长上下文与中文理解能力突出', recommended: false, selected: true,
        },
      ],
    }
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
      const url = String(input)
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      if (url.endsWith('/api/v1/agent/model/list') || url.endsWith('/api/v1/agent/model/activate')) {
        return json({ code: 200, data: catalog })
      }
      if (url.endsWith('/api/v1/qa/message-list')) {
        return json({ code: 200, data: { message_ls: [
          { id: 202, session_id: 88, role: 3, content: '已完成', created_at: 1002, status: 1,
            extra: JSON.stringify({ agent_run_uid: '11111111-1111-4111-8111-111111111111', agent_run_status: 'completed' }) },
          { id: 201, session_id: 88, role: 2, content: '帮我处理', created_at: 1001, status: 1 },
        ] } })
      }
      throw new Error(`unexpected URL ${url}`)
    })

    await expect(service.arkoModelCatalog()).resolves.toMatchObject({
      effectiveRouteKey: 'dashscope/qwen3.8-max',
      selectionSource: 'personal',
    })
    await expect(service.arkoActivateModel('dashscope/qwen3.8-max')).resolves.toMatchObject({
      effectiveRouteKey: 'dashscope/qwen3.8-max',
    })
    await expect(service.arkoHistoryPage(50, 0)).resolves.toMatchObject({
      hasMore: false,
      items: [
        { messageId: 202, role: 'assistant', runStatus: 'completed' },
        { messageId: 201, role: 'user', text: '帮我处理' },
      ],
    })
    expect(bodies).toContainEqual({ route_key: 'dashscope/qwen3.8-max' })
    expect(bodies).toContainEqual({ limit: 50, offset: 0, session_type: 2 })
  })

  it('continues a waiting Arko run without switching its model', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const bodies: Record<string, unknown>[] = []
    const runUid = '11111111-1111-4111-8111-111111111111'
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
      const url = String(input)
      if (url.endsWith('/api/v1/qa/new-msg-v2')) {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
        return json({ code: 200, data: { session_id: 88, user_msg_id: 203, assistant_msg_id: 204, run_uid: runUid } })
      }
      if (url.startsWith('https://intelligent.test/api/v1/qa/stream-v2?')) {
        return new Response(`data: ${JSON.stringify({ tail: { agent_run_uid: runUid, agent_run_status: 'completed' } })}\n\n`, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      }
      throw new Error(`unexpected URL ${url}`)
    })

    await service.arkoAsk('确认', {
      sessionId: 88,
      clientTurnUid: '22222222-2222-4222-8222-222222222222',
      replyToRunUid: runUid,
      replyToAssistantMsgId: 202,
      waitMillis: 1000,
    })
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({
      reply_to_run_uid: runUid,
      reply_to_assistant_msg_id: 202,
    })
    expect(bodies[0]).not.toHaveProperty('model_route_key')
  })

  it('does not use a pending phone-binding session for Arko tools', async () => {
    const sessions = new MemorySessionStore()
    const pendingSessions = new MemorySessionStore()
    pendingSessions.session = { userId: 10001, accessToken: 'pending-access', refreshToken: 'pending-refresh' }
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error('Arko must not call remote APIs before phone binding completes')
    })
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), fetchImpl, pendingSessions)

    await expect(service.arkoProfile()).rejects.toMatchObject({ code: 'login-required' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('refreshes the short token once after an authenticated 403', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'old-access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const authorizations: string[] = []
    let recordCalls = 0
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      authorizations.push(new Headers(init?.headers).get('Authorization') ?? '')
      if (url.endsWith('/new-short')) {
        return json({ code: 200, data: { access_token: 'new-access' } })
      }
      recordCalls += 1
      if (recordCalls === 1) {
        return json({}, 403)
      }
      return json({ code: 0, data: { record_count: 7 } })
    })

    await expect(service.summary()).resolves.toMatchObject({ recordCount: 7 })
    expect(authorizations).toEqual(['Bearer old-access', 'Bearer refresh', 'Bearer new-access'])
    expect(sessions.session?.accessToken).toBe('new-access')
  })

  it('lists active group members and hydrates public profile presentation', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, body })
      if (url === 'https://chat.test/api/v1/chats/members/list') {
        return json({ code: 200, data: {
          chat_session_uid: 'group-1',
          items: [
            {
              chat_session_uid: 'group-1', user_id: 2001, role: 3, status: 1, join_at: 20,
              display_name_snapshot: '群内 Member', remark: '联系人备注',
            },
            { chat_session_uid: 'group-1', user_id: 10001, role: 1, status: 1, join_at: 10, display_name_snapshot: '我' },
          ],
        } })
      }
      if (url === 'https://auth.test/api/v1/auth/get-public-users-by-ids') {
        return json({ code: 200, data: {
          items: [
            { user_id: 10001, nick_name: 'Owner', name_slug: 'owner-id', head_img: '' },
            {
              user_id: 2001,
              nick_name: 'Member',
              name_slug: 'member-id',
              head_img: 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/avatar/member.png?x-oss-signature=ok',
            },
          ],
        } })
      }
      throw new Error(`unexpected URL ${url}`)
    })

    const result = await service.listGroupMembers(sourceRefFor('group_chat', 'group-1', '设计群'))
    expect(result.activeCount).toBe(2)
    expect(result.selfRole).toBe('owner')
    expect(result.items.map(item => ({
      userId: item.userId,
      displayName: item.displayName,
      memberName: item.memberName,
      secondaryName: item.secondaryName,
      role: item.role,
      isSelf: item.isSelf,
    })))
      .toEqual([
        {
          userId: 10001,
          displayName: '我',
          memberName: '我',
          secondaryName: 'Owner',
          role: 'owner',
          isSelf: true,
        },
        {
          userId: 2001,
          displayName: '联系人备注',
          memberName: '群内 Member',
          secondaryName: '群内 Member',
          role: 'member',
          isSelf: false,
        },
      ])
    expect(result.items[1]?.avatarRef).toMatch(/^arkme-profile-image-v1\./)
    expect(requests).toEqual([
      { url: 'https://chat.test/api/v1/chats/members/list', body: { chat_session_uid: 'group-1', active_only: true } },
      { url: 'https://auth.test/api/v1/auth/get-public-users-by-ids', body: { user_ids: [2001, 10001] } },
    ])
  })

  it('hydrates large group member lists within the public profile batch limit', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const memberUserIds = Array.from({ length: 128 }, (_, index) => 2001 + index)
    const profileBatches: number[][] = []
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      if (url === 'https://chat.test/api/v1/chats/members/list') {
        return json({ code: 200, data: {
          chat_session_uid: 'group-large',
          items: memberUserIds.map(userId => ({
            chat_session_uid: 'group-large',
            user_id: userId,
            role: 3,
            status: 1,
            join_at: userId,
            display_name_snapshot: '',
          })),
        } })
      }
      if (url === 'https://auth.test/api/v1/auth/get-public-users-by-ids') {
        const userIds = body.user_ids as number[]
        if (userIds.length > 50) return json({ code: 400, message: 'too many user ids' }, 400)
        profileBatches.push(userIds)
        return json({ code: 200, data: {
          items: userIds.map(userId => ({
            user_id: userId,
            nick_name: `用户昵称 ${String(userId)}`,
            name_slug: `user-${String(userId)}`,
            head_img: '',
          })),
        } })
      }
      throw new Error(`unexpected URL ${url}`)
    })

    const result = await service.listGroupMembers(sourceRefFor('group_chat', 'group-large', '大群'))

    expect(profileBatches.map(batch => batch.length)).toEqual([50, 50, 28])
    expect(result.items).toHaveLength(128)
    expect(result.items.at(-1)).toMatchObject({
      userId: 2128,
      displayName: '用户昵称 2128',
    })
  })

  it('updates group message do-not-disturb without overwriting the other chat policies', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, body })
      if (url === 'https://chat.test/api/v1/chats/policy/get') {
        return json({ code: 200, data: {
          chat_session_uid: 'group-1',
          show_in_home_state: 2,
          privacy_state: 1,
          mute_state: 1,
          pin_state: 2,
          notify_state: 1,
          status: 1,
          update_at: 1700000000000,
        } })
      }
      if (url === 'https://chat.test/api/v1/chats/policy/update') {
        return json({ code: 200, data: {} })
      }
      throw new Error(`unexpected URL ${url}`)
    })

    await expect(service.setGroupMessageDnd(sourceRefFor('group_chat', 'group-1', '设计群'), true))
      .resolves.toEqual({ messageDnd: true })
    expect(requests[0]).toEqual({
      url: 'https://chat.test/api/v1/chats/policy/get',
      body: { chat_session_uid: 'group-1' },
    })
    expect(requests[1]).toMatchObject({
      url: 'https://chat.test/api/v1/chats/policy/update',
      body: {
        chat_session_uid: 'group-1',
        show_in_home_state: 2,
        privacy_state: 1,
        mute_state: 2,
        pin_state: 2,
        notify_state: 2,
        status: 1,
      },
    })
    expect(requests[1]?.body.update_at).toEqual(expect.any(Number))
  })

  it('opens a private chat from a user card through the create-private contract', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    state.profile = {
      userId: 10001,
      displayName: 'Owner',
      nickname: 'Owner',
      avatarRef: '',
      arkmeId: 'owner-id',
      accountType: 1,
      createdAt: 1,
      bindings: { apple: false, wechat: false, google: false },
      contact: {},
    }
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, body })
      if (url === 'https://auth.test/api/v1/auth/get-public-users-by-ids') {
        return json({ code: 200, data: {
          items: [{ user_id: 2001, nick_name: 'Member', name_slug: 'member-id', head_img: '' }],
        } })
      }
      if (url === 'https://chat.test/api/v1/chats/create-private') {
        expect(String(body.chat_session_uid)).toMatch(/^chat_session_[0-9a-f-]+$/)
        return json({ code: 200, data: {
          session: {
            chat_session_uid: 'private-1',
            session_kind: 1,
            title: 'Member',
            last_active_at: 1700000000000,
            last_seq: 3,
          },
          unread_snapshot: { unread_count: 0, session_last_seq: 3 },
        } })
      }
      throw new Error(`unexpected URL ${url}`)
    })

    const result = await service.openPrivateChatFromUser(2001, { presentationDisplayName: 'Member' })
    expect(result.source).toMatchObject({
      kind: 'private_chat',
      displayName: 'Member',
      activeAtMillis: 1700000000000,
      unreadCount: 0,
      latestSequence: 3,
    })
    expect(result.source.sourceRef).toMatch(/^arkme-source-v1\./)
    expect(requests[1]?.body).toMatchObject({
      peer_user_id: 2001,
    })
    expect(requests[1]?.body).not.toHaveProperty('title')
    expect(requests[1]?.body).not.toHaveProperty('owner_display_name_snapshot')
    expect(requests[1]?.body).not.toHaveProperty('peer_display_name_snapshot')
    expect(requests[1]?.body).not.toHaveProperty('extra')
  })

  it('opens a private chat from a searched registered contact without adding the contact', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    state.profile = {
      userId: 10001,
      displayName: 'Owner',
      nickname: 'Owner',
      avatarRef: '',
      arkmeId: 'owner-id',
      accountType: 1,
      createdAt: 1,
      bindings: { apple: false, wechat: false, google: false },
      contact: {},
    }
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, body })
      if (url === 'https://auth.test/api/v1/auth/search-contact-account') {
        expect(body).toEqual({ identifier_type: 2, identifier: 'mbr_sylj', phone_pre: '86' })
        return json({ code: 200, data: {
          user_id: 2001,
          is_registered: true,
          is_self: false,
          can_add: false,
          nick_name: '木白',
          jotmo_id: 'mbr_sylj',
          invite_by_sms: false,
        } })
      }
      if (url === 'https://auth.test/api/v1/auth/get-public-users-by-ids') {
        expect(body).toEqual({ user_ids: [2001] })
        return json({ code: 200, data: {
          items: [{ user_id: 2001, nick_name: '木白', name_slug: 'mbr_sylj', head_img: '' }],
        } })
      }
      if (url === 'https://chat.test/api/v1/chats/create-private') {
        return json({ code: 200, data: {
          session: {
            chat_session_uid: 'private-mubai',
            session_kind: 1,
            title: '木白',
            last_active_at: 1700000002000,
            last_seq: 5,
          },
          unread_snapshot: { unread_count: 0, session_last_seq: 5 },
        } })
      }
      throw new Error(`unexpected URL ${url}`)
    })

    const searched = await service.searchContact('@mbr_sylj')
    expect(searched).toMatchObject({ displayName: '木白', registered: true, canAdd: false, isSelf: false })

    const result = await service.openPrivateChatFromContact(searched.contactRef)
    expect(result.source).toMatchObject({
      kind: 'private_chat',
      displayName: '木白',
      activeAtMillis: 1700000002000,
      latestSequence: 5,
    })
    expect(requests.map(item => new URL(item.url).pathname)).toEqual([
      '/api/v1/auth/search-contact-account',
      '/api/v1/auth/search-contact-account',
      '/api/v1/auth/get-public-users-by-ids',
      '/api/v1/chats/create-private',
    ])
    expect(requests.map(item => new URL(item.url).pathname)).not.toContain('/api/v1/chats/contacts/add-and-open-private')
    expect(requests[3]?.body).toMatchObject({
      peer_user_id: 2001,
    })
    expect(requests[3]?.body).not.toHaveProperty('title')
    expect(requests[3]?.body).not.toHaveProperty('owner_display_name_snapshot')
    expect(requests[3]?.body).not.toHaveProperty('peer_display_name_snapshot')
  })

  it('opens the official author chat through the same Subject owner as the mobile contact-author entry', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    state.profile = {
      userId: 10001,
      displayName: 'Owner',
      nickname: 'Owner',
      avatarRef: '',
      arkmeId: 'owner-id',
      accountType: 1,
      createdAt: 1,
      bindings: { apple: false, wechat: false, google: false },
      contact: {},
    }
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, body })
      if (url === 'https://chat.test/api/v1/chats/list') {
        expect(body).toEqual({ limit: 50 })
        return json({ code: 200, data: { items: [], has_more: false } })
      }
      if (url === 'https://subject.test/api/v1/private/create-chat-ref-asen') {
        expect(String(body.subject_uid)).toMatch(/^dsh_official_author_[0-9a-f]+$/)
        expect(body).toMatchObject({ network: 'dsh', client_name: 'DSH', locs: [] })
        expect(body).not.toHaveProperty('peer_user_id')
        return json({ code: 200, data: { rm_subject_id: 267, already_exist: true } })
      }
      if (url === 'https://subject.test/api/v1/private/get-partner-info-v2') {
        expect(body).toEqual({ rm_subject_ids: [267] })
        return json({ code: 200, data: {
          item_ls: [{ rm_subject_id: 267, user_id: 11, mark: '', nick_name: '即我作者真名', head_img: '' }],
        } })
      }
      if (url === 'https://auth.test/api/v1/auth/get-public-users-by-ids') {
        expect(body).toEqual({ user_ids: [11] })
        return json({ code: 200, data: {
          items: [{ user_id: 11, nick_name: '作者资料名', name_slug: 'author-id', head_img: '' }],
        } })
      }
      if (url === 'https://chat.test/api/v1/chats/create-private') {
        return json({ code: 200, data: {
          session: {
            chat_session_uid: 'author-private-1',
            session_kind: 1,
            title: '即我作者真名',
            last_active_at: 1700000001000,
            last_seq: 1,
          },
          unread_snapshot: { unread_count: 0, session_last_seq: 1 },
        } })
      }
      throw new Error(`unexpected URL ${url}`)
    })

    const result = await service.openOfficialAuthorPrivateChat()
    expect(result.source).toMatchObject({
      kind: 'private_chat',
      displayName: '即我作者真名',
      activeAtMillis: 1700000001000,
      latestSequence: 1,
    })
    expect(requests.map(item => new URL(item.url).pathname)).toEqual([
      '/api/v1/chats/list',
      '/api/v1/private/create-chat-ref-asen',
      '/api/v1/private/get-partner-info-v2',
      '/api/v1/auth/get-public-users-by-ids',
      '/api/v1/chats/create-private',
    ])
    expect(requests[4]?.body).toMatchObject({
      peer_user_id: 11,
    })
    expect(requests[4]?.body).not.toHaveProperty('title')
    expect(requests[4]?.body).not.toHaveProperty('owner_display_name_snapshot')
    expect(requests[4]?.body).not.toHaveProperty('peer_display_name_snapshot')
  })

  it('reuses an existing author private chat instead of creating a second one', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, body })
      if (url === 'https://chat.test/api/v1/chats/list') {
        expect(body).toEqual({ limit: 50 })
        return json({ code: 200, data: {
          items: [{
            session: { chat_session_uid: 'author-existing', session_kind: 1, last_active_at: 1700000001000, last_seq: 2 },
            private_counterpart: { user_id: 11, display_name_snapshot: '即我作者' },
            private_supplement: {}, latest_preview: {}, unread_snapshot: { unread_count: 0, session_last_seq: 2 }, current_policy: {},
          }],
          has_more: false,
        } })
      }
      if (url === 'https://auth.test/api/v1/auth/get-public-users-by-ids') {
        expect(body).toEqual({ user_ids: [11] })
        return json({ code: 200, data: { items: [{ user_id: 11, nick_name: '即我作者', name_slug: 'author', head_img: '' }] } })
      }
      throw new Error(`unexpected URL ${url}`)
    })

    await expect(service.openOfficialAuthorPrivateChat()).resolves.toMatchObject({
      source: { kind: 'private_chat', displayName: '即我作者', peerUserId: 11 },
    })
    expect(requests.map(item => new URL(item.url).pathname)).toEqual([
      '/api/v1/chats/list',
      '/api/v1/auth/get-public-users-by-ids',
    ])
  })

  it('reads the official author public profile without creating a private chat', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, body })
      if (url === 'https://auth.test/api/v1/auth/get-public-users-by-ids') {
        expect(body).toEqual({ user_ids: [11] })
        return json({ code: 200, data: {
          items: [{
            user_id: 11,
            nick_name: '阿森',
            name_slug: 'asen',
            head_img: 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/avatar/asen.png?x-oss-signature=abc',
          }],
        } })
      }
      throw new Error(`unexpected URL ${url}`)
    })

    const profile = await service.officialAuthorProfile()
    expect(profile).toMatchObject({ userId: 11, displayName: '阿森' })
    expect(profile.avatarRef).toEqual(expect.any(String))
    expect(requests.map(item => new URL(item.url).pathname)).toEqual([
      '/api/v1/auth/get-public-users-by-ids',
    ])
  })

  it('reads owner and incoming shared recordings without exposing a write surface', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, body })
      if (url.endsWith('/api/v1/auth/able-func')) {
        expect(body).toEqual({ func_type: 17 })
        return json({ code: 200, data: { able: true } })
      }
      if (url.endsWith('/api/v1/chats/records/related-recordings/page')) {
        if (body.include_time_index === true) return json({ code: 1001, message: 'unknown field' })
        expect(body).toMatchObject({ chat_session_uid: 'chat-private-1', page_size: 10 })
        return json({ code: 200, data: {
          state: 3,
          has_entry: true,
          moment_ls: [
            {
              moment_id: 'moment-owner-secret', start_at: 1_786_000_000_000, end_at: 1_786_000_060_000,
              time_range_text: '10:00 - 10:01', title: '自己的录音', summary: '自己的摘要',
              summary_status: 2, transcript: '自己的原文', transcript_available: true,
              is_shared_by_other: false,
            },
            {
              moment_id: 'moment-incoming-secret', start_at: 1_785_999_000_000, end_at: 1_785_999_060_000,
              time_range_text: '09:40 - 09:41', title: '对方共享的录音', summary: '对方共享的摘要',
              summary_status: 2, transcript_available: false,
              is_shared_by_other: true, shared_by_user_id: 20002,
              chat_session_uid: 'chat-private-1', record_uid: 'record-incoming-secret',
              record_owner_user_id: 20002, source_relation_uid: 'rel-incoming-secret',
              shared_sequence: 17,
            },
          ],
          has_more: false,
          partial: false,
        } })
      }
      if (url.endsWith('/api/v1/chats/records/detail')) {
        expect(body).toEqual({
          chat_session_uid: 'chat-private-1',
          record_uid: 'record-incoming-secret',
          record_owner_user_id: 20002,
          rel_uid: 'rel-incoming-secret',
          seq: 17,
        })
        return json({ code: 200, data: {
          chat_session_uid: 'chat-private-1',
          item: {
            relation: {
              chat_session_uid: 'chat-private-1',
              record_uid: 'record-incoming-secret',
              record_owner_user_id: 20002,
              rel_uid: 'rel-incoming-secret',
              seq: 17,
            },
            record: { status: 1, payload: { content_payload: {
              render_kind: 'shared_recording_memory',
              source_digest: 'digest-incoming-secret',
              shared_by_user_id: 20002,
              shared_at: 1_785_999_000_000,
              display_at: 1_785_999_000_000,
              end_at: 1_785_999_060_000,
              time_range_text: '09:40 - 09:41',
              title: '对方共享的录音',
              summary: '对方共享的摘要',
              transcript: '对方共享的完整原文',
              participants: [{ ref_user_id: 20002, display_name: '小林', role: 1 }],
            } } },
          },
        } })
      }
      throw new Error(`unexpected ${url}`)
    })
    const sourceRef = sourceRefFor('private_chat', 'chat-private-1', '小林')

    await expect(service.relatedRecordingEligibility(sourceRef)).resolves.toEqual({ allowed: true })
    expect(service.providerCapabilities().features).toMatchObject({ relatedRecordings: true })
    expect(service.providerCapabilities().features).not.toHaveProperty('relatedRecordingSharing')
    const firstPage = await service.relatedRecordings(sourceRef, { limit: 10, includeTimeIndex: true })
    expect(firstPage).toMatchObject({
      state: 'success', legacyTimeIndexFallback: true, timeIndexComplete: false,
      items: [
        { title: '自己的录音', isSharedByOther: false, transcript: '自己的原文' },
        { title: '对方共享的录音', isSharedByOther: true, transcriptAvailable: false },
      ],
    })
    const ownerRef = firstPage.items[0]!.recordingRef
    const incomingRef = firstPage.items[1]!.recordingRef
    const incomingDetailRef = firstPage.items[1]!.sharedRecordingDetailRef
    expect(ownerRef).toMatch(/^arkme-related-recording-v1\.[A-Za-z0-9_-]+$/)
    expect(incomingRef).toMatch(/^arkme-related-recording-v1\.[A-Za-z0-9_-]+$/)
    expect(firstPage.items[0]!.sharedRecordingDetailRef).toBeUndefined()
    expect(incomingDetailRef).toMatch(/^arkme-shared-recording-detail-v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(ownerRef).not.toContain('moment-owner-secret')
    expect(incomingRef).not.toContain('moment-incoming-secret')
    expect(incomingDetailRef).not.toContain('record-incoming-secret')
    expect(incomingDetailRef).not.toContain('rel-incoming-secret')

    await expect(service.sharedRecordingDetail(incomingDetailRef!)).resolves.toMatchObject({
      title: '对方共享的录音',
      transcript: '对方共享的完整原文',
    })

    const repeatedPage = await service.relatedRecordings(sourceRef)
    expect(repeatedPage.items.map(item => item.recordingRef)).toEqual([ownerRef, incomingRef])
    expect(requests.some(request => request.url.endsWith('/shared-recording'))).toBe(false)
    expect(requests.some(request => request.url.endsWith('/shared-recording/revoke'))).toBe(false)
  })
  it('creates plain-text long articles and edits the same owner record with CAS duration facts', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    let version = 1
    let title = '初始标题'
    let textContent = '初始正文'
    let editDurationMillis = 0
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      calls.push({ url, body })
      if (url.endsWith('/api/v1/records/privacy/visibility-snapshot')) {
        return json({ code: 0, data: { items: [], has_more: false } })
      }
      if (url.endsWith('/api/v1/topics/display/list')) return json({ code: 0, data: { items: [] } })
      if (url.endsWith('/api/v1/topics/hierarchy/relations/list')) return json({ code: 0, data: { relations: [] } })
      if (url.endsWith('/api/v1/records/uncategorized/summary')) return json({ code: 0, data: { record_count: 0, words_count: 0, total_sec: 0 } })
      if (url.endsWith('/api/v1/records/create')) return json({ code: 0, data: { record_uid: body.record_uid, status: 1 } })
      if (url.endsWith('/api/v1/records/detail')) return json({ code: 0, data: { record_core: {
        record_uid: 'article-1', owner_user_id: 10001, creator_user_id: 10001,
        template_kind: 1, display_kind: 1, title, text_content: textContent,
        record_duration_millis: 3200, edit_duration_millis: editDurationMillis,
        send_at: 100, update_at: 200, status: 1, version,
      } } })
      if (url.endsWith('/api/v1/records/update')) {
        title = String(body.title)
        textContent = String(body.text_content)
        editDurationMillis = Number(body.edit_duration_millis)
        version += 1
        return json({ code: 0, data: { record_core: { record_uid: 'article-1', version }, revision_uid: 'revision-1' } })
      }
      throw new Error(`unexpected ${url}`)
    })

    const source = (await service.listSources('send_to_self')).items[0]!
    await expect(service.sendSourceRich(source.sourceRef, {
      title: '初始标题', textContent: '初始正文', displayKind: 1, thinkingDurationMillis: 3200,
    }, { recordUid: 'article-1' })).resolves.toMatchObject({ itemUid: 'article-1' })
    expect(calls.find(call => call.url.endsWith('/api/v1/records/create'))?.body).toMatchObject({
      record_uid: 'article-1', template_kind: 1, display_kind: 1,
      title: '初始标题', text_content: '初始正文', record_duration_millis: 3200,
    })

    await expect(service.longArticleDetail(source.sourceRef, 'article-1')).resolves.toMatchObject({
      itemUid: 'article-1', editable: true, version: 1, thinkingDurationMillis: 3200,
    })
    await expect(service.updateLongArticle(source.sourceRef, 'article-1', {
      title: '更新标题', textContent: '更新正文', version: 1, editDurationMillis: 1400,
    })).resolves.toMatchObject({
      itemUid: 'article-1', title: '更新标题', textContent: '更新正文', version: 2,
      thinkingDurationMillis: 4600,
    })
    expect(calls.find(call => call.url.endsWith('/api/v1/records/update'))?.body).toMatchObject({
      record_uid: 'article-1', template_kind: 1, version: 1,
      record_duration_millis: 3200, edit_duration_millis: 1400,
    })
  })

  it('projects both mention directions with opaque refs and reads the selected quick-note detail', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    await state.cacheProfile(10001, {
      userId: 10001,
      displayName: '我的昵称',
      nickname: '我的昵称',
      avatarRef: '10001_1700000000_1_0.png',
      arkmeId: 'me',
      accountType: 1,
      createdAt: 1,
      bindings: { apple: false, wechat: true, google: false },
      contact: {},
    })
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const ownAvatar = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
    const ownObjectPath = 'd89f3a35931c386956c1a402a8e09941/10001/10001_1700000000_1_0.png'
    const publicDefaultAvatar = 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/default/arkme.png?x-oss-signature=default-signature'
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, body })
      if (url.endsWith('/api/v1/auth/able-func')) {
        return json({ code: 200, data: { able: true } })
      }
      if (url.endsWith('/api/v1/chats/detail')) return json({ code: 200, data: {
        session: { chat_session_uid: 'private-1', session_kind: 1 },
        private_counterpart: { user_id: 20002 },
      } })
      if (url.endsWith('/api/v1/private/check-contact-chat')) return json({ code: 200, data: {
        exist: true, rm_subject_id: 70001, to_user_id: 20002,
      } })
      if (url.endsWith('/api/v1/interwoven-moments/inline-bootstrap')) return json({ code: 200, data: {
        prepared_at: 1_700_000_000_500,
        source_status: [{ moment_type: 1, status: 1, item_count: 2 }],
        groups: [{
          moment_type: 1,
          group_title: '即我大群',
          group_preview_items: [
            {
              moment_id: 'chat_group_mention:group-secret:10001:record-secret-1:rel-secret-1',
              moment_type: 1,
              occurred_at: 1_700_000_000_000,
              summary: '我提到了小林',
              is_degraded: false,
              jump_target: {
                chat_session_uid: 'group-secret', record_owner_user_id: 10001,
                record_uid: 'record-secret-1', rel_uid: 'rel-secret-1', seq: 9,
              },
              render_payload: { sender_user_id: 10001, content: '我提到了小林' },
            },
            {
              moment_id: 'chat_group_mention:group-secret:20002:record-secret-2:rel-secret-2',
              moment_type: 1,
              occurred_at: 1_700_000_001_000,
              is_degraded: false,
              jump_target: {
                chat_session_uid: 'group-secret', record_owner_user_id: 20002,
                record_uid: 'record-secret-2', rel_uid: 'rel-secret-2', seq: 10,
              },
              render_payload: { sender_user_id: 20002, content: '小林提到了我' },
            },
          ],
        }],
      } })
      if (url.endsWith('/api/v1/auth/get-public-users-by-ids')) return json({ code: 200, data: {
        items: [
          { user_id: 10001, nick_name: '我的昵称', head_img: publicDefaultAvatar },
          {
            user_id: 20002,
            nick_name: '小林',
            head_img: 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/avatar.png?x-oss-signature=sig',
          },
        ],
      } })
      if (url.endsWith('/api/v1/chats/records/detail')) return json({ code: 200, data: {
        chat_session_uid: 'group-secret',
        item: {
          relation: {
            chat_session_uid: 'group-secret', record_owner_user_id: 20002,
            record_uid: 'record-secret-2', rel_uid: 'rel-secret-2', seq: 10,
          },
          record: { status: 1, payload: { title: '群聊快记', text_content: '小林提到了我' } },
        },
      } })
      if (url === 'https://auth.test/api/v1/synch/get/sts-credentials?md_5_user_id=d89f3a35931c386956c1a402a8e09941') {
        return json({ code: 200, data: {
          access_key_id: 'test-access-key-id',
          access_key_secret: 'test-access-key-secret',
          security_token: 'test-security-token',
          expiration: new Date(Date.now() + 60_000).toISOString(),
        } })
      }
      if (url.startsWith(`https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/${ownObjectPath}?`)) {
        return new Response(ownAvatar, {
          status: 200,
          headers: { 'Content-Type': 'image/png', 'Content-Length': String(ownAvatar.byteLength) },
        })
      }
      if (url === publicDefaultAvatar) throw new Error('self avatar must not use the public default image')
      throw new Error(`unexpected URL ${url}`)
    })
    const sourceRef = sourceRefFor('private_chat', 'private-1', '小林')

    const bootstrap = await service.interwovenMoments(sourceRef)

    expect(bootstrap).toMatchObject({ state: 'success', preparedAtMillis: 1_700_000_000_500 })
    expect(bootstrap.moments).toHaveLength(2)
    expect(bootstrap.moments.map(item => [item.senderName, item.senderIsMe, item.summary])).toEqual([
      ['我的昵称', true, '我提到了小林'],
      ['小林', false, '小林提到了我'],
    ])
    expect(bootstrap.moments[0]?.senderAvatarRef).toMatch(/^arkme-profile-image-v1\./)
    expect(bootstrap.moments[1]?.senderAvatarRef).toMatch(/^arkme-profile-image-v1\./)
    const publicProfileReadsBeforeOwnImage = requests.filter(item => item.url.endsWith('/api/v1/auth/get-public-users-by-ids')).length
    await expect(service.readImage(bootstrap.moments[0]!.senderAvatarRef!)).resolves.toMatchObject({
      mediaType: 'image/png', bytes: ownAvatar.byteLength,
    })
    expect(requests.filter(item => item.url.endsWith('/api/v1/auth/get-public-users-by-ids')))
      .toHaveLength(publicProfileReadsBeforeOwnImage)
    for (const moment of bootstrap.moments) {
      expect(moment.momentRef).toMatch(/^arkme-moment-v1\./)
      expect(moment.momentRef).not.toContain('group-secret')
      expect(moment.momentRef).not.toContain('record-secret')
      expect(moment.momentId).not.toContain('group-secret')
    }

    await expect(service.interwovenMomentDetail(sourceRef, bootstrap.moments[1]!.momentRef)).resolves.toMatchObject({
      momentId: bootstrap.moments[1]!.momentId,
      groupName: '即我大群',
      senderName: '小林',
      senderIsMe: false,
      title: '群聊快记',
      textContent: '小林提到了我',
      degraded: false,
    })
    expect(requests.filter(item => item.url.endsWith('/api/v1/auth/able-func'))).toHaveLength(2)
    expect(requests.find(item => item.url.endsWith('/api/v1/private/check-contact-chat'))?.body).toEqual({
      target_user_id: 20002,
    })
    expect(requests.find(item => item.url.endsWith('/api/v1/interwoven-moments/inline-bootstrap'))?.body).toEqual({
      rm_subject_id: 70001, force_refresh: true,
    })
    expect(requests.some(item => item.url.endsWith('/api/v1/chats/interwoven/inline-bootstrap'))).toBe(false)
    expect(requests.find(item => item.url.endsWith('/api/v1/chats/records/detail'))?.body).toEqual({
      chat_session_uid: 'group-secret', record_owner_user_id: 20002,
      record_uid: 'record-secret-2', rel_uid: 'rel-secret-2', seq: 10,
    })
  })

  it('restores native World interwoven moments through the legacy private subject locator', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, body })
      if (url.endsWith('/api/v1/auth/able-func')) return json({ code: 200, data: { able: true } })
      if (url.endsWith('/api/v1/chats/detail')) return json({ code: 200, data: {
        session: { chat_session_uid: 'private-old-huang', session_kind: 1 },
        private_counterpart: { user_id: 20002 },
      } })
      if (url.endsWith('/api/v1/private/check-contact-chat')) return json({ code: 200, data: {
        exist: true, rm_subject_id: 88001, to_user_id: 20002,
      } })
      if (url.endsWith('/api/v1/interwoven-moments/inline-bootstrap')) return json({ code: 200, data: {
        prepared_at: 1_755_555_000_000,
        source_status: [{ moment_type: 1, status: 1, item_count: 1 }],
        groups: [{
          moment_type: 1,
          group_title: 'TA 在「即我大群」里@了你',
          group_preview_items: [{
            moment_id: 'native-old-huang-2000',
            moment_type: 1,
            occurred_at: 1_755_547_200_000,
            title: '即我大群',
            summary: '@何宏顺 @Lucis',
            jump_target: { rm_subject_id: 99001, record_uid: 'legacy-record-1' },
            render_payload: {
              record_uid: 'legacy-record-1', sender_user_id: 10001,
              sender_display_name: 'Tison', group_name: '即我大群',
              content: '@何宏顺 @Lucis 你们手头有',
            },
          }],
        }],
      } })
      if (url.endsWith('/api/v1/auth/get-public-users-by-ids')) return json({ code: 200, data: {
        items: [{ user_id: 10001, nick_name: 'Tison', head_img: '' }],
      } })
      throw new Error(`unexpected URL ${url}`)
    })
    const sourceRef = sourceRefFor('private_chat', 'private-old-huang', '老黄')

    const bootstrap = await service.interwovenMoments(sourceRef)

    expect(bootstrap).toMatchObject({
      state: 'success',
      moments: [{
        groupName: '即我大群', senderName: 'Tison', senderIsMe: true,
        summary: '@何宏顺 @Lucis 你们手头有', occurredAtMillis: 1_755_547_200_000,
      }],
    })
    await expect(service.interwovenMomentDetail(sourceRef, bootstrap.moments[0]!.momentRef))
      .resolves.toMatchObject({
        groupName: '即我大群', senderName: 'Tison', title: '即我大群',
        textContent: '@何宏顺 @Lucis 你们手头有', degraded: true,
      })
    expect(requests.some(item => item.url.endsWith('/api/v1/chats/interwoven/inline-bootstrap'))).toBe(false)
    expect(requests.some(item => item.url.endsWith('/api/v1/chats/records/detail'))).toBe(false)
  })

  it('falls back to Chat only when the legacy mapping is absent or World is explicitly unsupported', async () => {
    for (const mode of ['missing', 'unsupported'] as const) {
      const sessions = new MemorySessionStore()
      sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
      const requests: Array<{ url: string; body: Record<string, unknown> }> = []
      const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
        const url = String(input)
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        requests.push({ url, body })
        if (url.endsWith('/api/v1/auth/able-func')) return json({ code: 200, data: { able: true } })
        if (url.endsWith('/api/v1/chats/detail')) return json({ code: 200, data: {
          session: { chat_session_uid: 'private-1', session_kind: 1 },
          private_counterpart: { user_id: 20002 },
        } })
        if (url.endsWith('/api/v1/private/check-contact-chat')) return json({ code: 200, data: mode === 'missing'
          ? { exist: false, to_user_id: 20002 }
          : { exist: true, rm_subject_id: 70001, to_user_id: 20002 } })
        if (url.endsWith('/api/v1/interwoven-moments/inline-bootstrap')) return json({}, 404)
        if (url.endsWith('/api/v1/chats/interwoven/inline-bootstrap')) return json({ code: 200, data: {
          prepared_at: 100, source_status: [{ moment_type: 1, status: 1, item_count: 0 }], groups: [],
        } })
        throw new Error(`unexpected URL ${url}`)
      })

      await expect(service.interwovenMoments(sourceRefFor('private_chat', 'private-1', '小林')))
        .resolves.toMatchObject({ state: 'empty', moments: [] })
      expect(requests.filter(item => item.url.endsWith('/api/v1/chats/interwoven/inline-bootstrap'))).toHaveLength(1)
      expect(requests.find(item => item.url.endsWith('/api/v1/chats/interwoven/inline-bootstrap'))?.body)
        .toEqual({ chat_session_uid: 'private-1', rm_subject_id: mode === 'missing' ? 0 : 70001, limit: 100 })
      expect(requests.filter(item => item.url.endsWith('/api/v1/interwoven-moments/inline-bootstrap')))
        .toHaveLength(mode === 'missing' ? 0 : 1)
    }
  })

  it('does not turn Subject or World service failures into false empty Chat results', async () => {
    for (const failingOwner of ['subject', 'world'] as const) {
      const sessions = new MemorySessionStore()
      sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
      const urls: string[] = []
      const service = new ArkmeService(config, sessions, new MemoryStateStore(), async input => {
        const url = String(input); urls.push(url)
        if (url.endsWith('/api/v1/auth/able-func')) return json({ code: 200, data: { able: true } })
        if (url.endsWith('/api/v1/chats/detail')) return json({ code: 200, data: {
          session: { chat_session_uid: 'private-1', session_kind: 1 },
          private_counterpart: { user_id: 20002 },
        } })
        if (url.endsWith('/api/v1/private/check-contact-chat')) return failingOwner === 'subject'
          ? json({ code: 500, message: 'subject unavailable' })
          : json({ code: 200, data: { exist: true, rm_subject_id: 70001 } })
        if (url.endsWith('/api/v1/interwoven-moments/inline-bootstrap')) {
          return json({ code: 500, message: 'world unavailable' })
        }
        if (url.endsWith('/api/v1/chats/interwoven/inline-bootstrap')) {
          throw new Error('Chat fallback must not run for ordinary service failures')
        }
        throw new Error(`unexpected URL ${url}`)
      })

      await expect(service.interwovenMoments(sourceRefFor('private_chat', 'private-1', '小林')))
        .rejects.toMatchObject({ code: 'arkme-code-500' })
      expect(urls.some(url => url.endsWith('/api/v1/chats/interwoven/inline-bootstrap'))).toBe(false)
    }
  })

  it('preserves installed rich-content projection and send contracts alongside interwoven moments', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const sentBodies: Record<string, unknown>[] = []
    const signedUrl = 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/a.png?x-oss-signature=secret'
    const service = new ArkmeService(
      { ...config, richMediaRenderEnabled: true, richMediaSendEnabled: true },
      sessions,
      new MemoryStateStore(),
      async (input, init) => {
        const url = String(input)
        if (url === signedUrl) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } })
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        if (url.endsWith('/api/v1/chat/timeline/page')) return json({ code: 200, data: {
          items: [{
            relation: { record_uid: 'record-media', sender_user_id: 10001, display_name_snapshot: '我', attach_at: 100, seq: 3 },
            record: { status: 1, payload: {
              title: '', text_content: '图片说明', display_kind: 0,
              content_payload: { payload_kind: 2, media_refs: [
                { file_asset_uid: 'asset-12345678', content_file_role: 1, sort_order: 0 },
                { file_asset_uid: 'asset-background', content_file_role: 4, sort_order: 1 },
                { file_asset_uid: 'asset-audio', content_file_role: 1, sort_order: 2, duration_sec: 65 },
              ] },
              media_display_items: [{
                file_asset_uid: 'asset-12345678', file_kind: 1, file_name: '示例.png', mime_type: 'image/png',
                size: 3, sort_order: 0, preview_url: signedUrl, download_url: signedUrl,
              }, {
                file_asset_uid: 'asset-background', file_kind: 2,
                file_name: 'jotmo_mobile_background_sound_100.m4a', mime_type: 'audio/mp4',
                size: 7, sort_order: 1, download_url: signedUrl,
              }, {
                file_asset_uid: 'asset-audio', file_kind: 2, file_name: '普通语音.m4a', mime_type: 'audio/mp4',
                size: 5, sort_order: 2, download_url: signedUrl,
              }],
            } },
          }],
          has_more: false,
        } })
        if (url.endsWith('/api/v1/auth/get-public-users-by-ids')) return json({ code: 200, data: { items: [] } })
        if (url.endsWith('/api/v1/chats/records/send')) {
          sentBodies.push(body)
          return json({ code: 200, data: { record_uid: body.record_uid, seq: 4, status: 1 } })
        }
        throw new Error(`unexpected ${url}`)
      },
    )
    const sourceRef = sourceRefFor('private_chat', 'chat-media', '媒体会话')
    const page = await service.readSource(sourceRef)
    expect(page.items[0]).toMatchObject({
      textContent: '图片说明',
      contentBlocks: [
        { kind: 'image', fileName: '示例.png', mimeType: 'image/png', size: 3 },
        { kind: 'audio', fileName: '普通语音.m4a', mimeType: 'audio/mp4', size: 5, durationSec: 65 },
      ],
    })
    expect(page.items[0]?.contentBlocks).toHaveLength(2)
    const mediaRef = page.items[0]?.contentBlocks?.[0]?.mediaRef ?? ''
    const audioMediaRef = page.items[0]?.contentBlocks?.[1]?.mediaRef ?? ''
    expect(mediaRef).toMatch(/^arkme-media-v1\./)
    const repeatedPage = await service.readSource(sourceRef)
    expect(repeatedPage.items[0]?.contentBlocks?.[0]?.mediaRef).toBe(mediaRef)
    expect(repeatedPage.items[0]?.contentBlocks?.[1]?.mediaRef).not.toBe(audioMediaRef)
    expect(JSON.stringify(page)).not.toContain('x-oss-signature=secret')
    expect(JSON.stringify(page)).not.toContain('jotmo_mobile_background_sound')
    expect(JSON.stringify(page)).not.toContain('asset-background')
    await expect(service.fetchMedia(mediaRef)).resolves.toMatchObject({ descriptor: { fileName: '示例.png' } })
    await expect(service.sendSourceRich(sourceRef, {
      textContent: '发送图片',
      assets: [{ fileAssetUid: 'asset-12345678', fileName: '示例.png', mimeType: 'image/png', size: 3, fileKind: 1 }],
    }, { recordUid: 'record-rich', relationUid: 'relation-rich' })).resolves.toMatchObject({ itemUid: 'record-rich', sequence: 4 })
    expect(sentBodies[0]).toMatchObject({
      chat_session_uid: 'chat-media', record_uid: 'record-rich', rel_uid: 'relation-rich', template_kind: 2,
      content_payload: { media_refs: [{
        file_asset_uid: 'asset-12345678', content_file_role: 1, render_role: 1,
        sort_order: 0, file_name: '示例.png',
      }] },
    })
    expect(JSON.stringify(sentBodies[0]?.content_payload)).not.toMatch(/file_type|file_kind|mime_type|"size"/u)
    await expect(service.sendSourceRich(sourceRef, {
      title: '长文标题', textContent: '长文正文', displayKind: 1, thinkingDurationMillis: 4200,
    }, { recordUid: 'record-long-article', relationUid: 'relation-long-article' }))
      .resolves.toMatchObject({ itemUid: 'record-long-article', sequence: 4 })
    expect(sentBodies[1]).toMatchObject({
      chat_session_uid: 'chat-media', record_uid: 'record-long-article', rel_uid: 'relation-long-article',
      template_kind: 1, display_kind: 1, title: '长文标题', text_content: '长文正文',
      record_duration_millis: 4200,
    })
  })

  it('batch-hydrates default-category record media before mapping two incoming images', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(
      { ...config, richMediaRenderEnabled: true },
      sessions,
      new MemoryStateStore(),
      async (input, init) => {
        const url = String(input)
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        calls.push({ url, body })
        if (url.endsWith('/api/v1/records/privacy/visibility-snapshot')) {
          return json({ code: 0, data: { items: [], has_more: false } })
        }
        if (url.endsWith('/api/v1/records/uncategorized/query')) return json({ code: 0, data: {
          items: [{
            record_uid: 'record-two-images', send_at: 100,
            record_core: {
              title: '', text_content: '', template_kind: 2, status: 1, version: 1,
              content_payload: { media_refs: [
                { file_asset_uid: 'asset-image-a', content_file_role: 1, sort_order: 0 },
                { file_asset_uid: 'asset-image-b', content_file_role: 1, sort_order: 1 },
              ] },
            },
          }],
          has_more: false,
        } })
        if (url.endsWith('/api/v1/records/media/batch-list')) return json({ code: 0, data: { items: [{
          record_uid: 'record-two-images',
          items: [{
            file_asset_uid: 'asset-image-a', file_kind: 1, file_name: 'a.png', mime_type: 'image/png',
            size: 10, sort_order: 0, preview_url: 'https://media.test/a.png', download_url: 'https://media.test/a.png',
          }, {
            file_asset_uid: 'asset-image-b', file_kind: 1, file_name: 'b.jpg', mime_type: 'image/jpeg',
            size: 20, sort_order: 1, preview_url: 'https://media.test/b.jpg', download_url: 'https://media.test/b.jpg',
          }],
        }] } })
        throw new Error(`unexpected ${url}`)
      },
    )

    const page = await service.readSource(sourceRefFor('default_category', 'uncategorized', '默认分类'))
    expect(page.items[0]).toMatchObject({
      itemUid: 'record-two-images',
      contentBlocks: [
        { kind: 'image', fileAssetUid: 'asset-image-a', fileName: 'a.png', sortOrder: 0 },
        { kind: 'image', fileAssetUid: 'asset-image-b', fileName: 'b.jpg', sortOrder: 1 },
      ],
    })
    expect(page.items[0]?.mediaUnavailable).not.toBe(true)
    const mediaCalls = calls.filter(call => call.url.endsWith('/api/v1/records/media/batch-list'))
    expect(mediaCalls).toHaveLength(1)
    expect(mediaCalls[0]?.body).toEqual({ record_uids: ['record-two-images'] })
  })

  it('keeps record text and marks only unresolved media when batch hydration fails', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    let mediaCalls = 0
    const service = new ArkmeService(
      { ...config, richMediaRenderEnabled: true },
      sessions,
      new MemoryStateStore(),
      async input => {
        const url = String(input)
        if (url.endsWith('/api/v1/records/privacy/visibility-snapshot')) {
          return json({ code: 0, data: { items: [], has_more: false } })
        }
        if (url.endsWith('/api/v1/topics/display/detail')) return json({ code: 0, data: {
          records: [{
            record_uid: 'record-media-only', creator_user_id: 10001, send_at: 100, status: 1,
            record_core: { content_payload: { media_refs: [{ file_asset_uid: 'asset-missing', content_file_role: 1 }] } },
          }, {
            record_uid: 'record-text', creator_user_id: 10001, send_at: 99, status: 1,
            text_content: '同页文字仍然可读',
          }],
          has_more: false,
        } })
        if (url.endsWith('/api/v1/records/media/batch-list')) {
          mediaCalls += 1
          return json({ code: 500, message: 'media unavailable' })
        }
        throw new Error(`unexpected ${url}`)
      },
    )

    const page = await service.readSource(sourceRefFor('topic', 'topic-media', '媒体主题'))
    expect(page.items).toMatchObject([
      { itemUid: 'record-media-only', contentBlocks: [], mediaUnavailable: true },
      { itemUid: 'record-text', textContent: '同页文字仍然可读' },
    ])
    expect(mediaCalls).toBe(1)
  })

  it('hides interwoven moments behind the local kill switch without calling remote services', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const fetchImpl = vi.fn<typeof fetch>()
    const service = new ArkmeService(
      { ...config, interwovenMomentsEnabled: false }, sessions, new MemoryStateStore(), fetchImpl,
    )

    await expect(service.interwovenMoments(sourceRefFor('private_chat', 'private-1', '小林')))
      .resolves.toMatchObject({ state: 'disabled', moments: [] })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects Bot private chats before loading interwoven data', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const urls: string[] = []
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async input => {
      const url = String(input); urls.push(url)
      if (url.endsWith('/api/v1/auth/able-func')) return json({ code: 200, data: { able: true } })
      if (url.endsWith('/api/v1/chats/detail')) return json({ code: 200, data: {
        session: { chat_session_uid: 'bot-1', session_kind: 3 }, private_counterpart: { user_id: 20002 },
      } })
      throw new Error(`unexpected URL ${url}`)
    })

    await expect(service.interwovenMoments(sourceRefFor('private_chat', 'bot-1', '机器人')))
      .rejects.toMatchObject({ code: 'interwoven-source-invalid' })
    expect(urls.some(url => url.endsWith('/api/v1/chats/interwoven/inline-bootstrap'))).toBe(false)
  })

  it('fails closed when interwoven eligibility is denied', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const urls: string[] = []
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async input => {
      urls.push(String(input))
      return json({ code: 200, data: { able: false } })
    })

    await expect(service.interwovenMoments(sourceRefFor('private_chat', 'private-1', '小林')))
      .resolves.toMatchObject({ state: 'disabled', moments: [] })
    expect(urls).toEqual(['https://auth.test/api/v1/auth/able-func'])
  })

  it('keeps valid moments when unknown and malformed items or optional profiles are unavailable', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async input => {
      const url = String(input)
      if (url.endsWith('/api/v1/auth/able-func')) return json({ code: 200, data: { able: true } })
      if (url.endsWith('/api/v1/chats/detail')) return json({ code: 200, data: {
        session: { chat_session_uid: 'private-1', session_kind: 1 }, private_counterpart: { user_id: 20002 },
      } })
      if (url.endsWith('/api/v1/private/check-contact-chat')) return json({ code: 200, data: { exist: false } })
      if (url.endsWith('/api/v1/chats/interwoven/inline-bootstrap')) return json({ code: 200, data: {
        future_field: { ignored: true }, prepared_at: 100,
        source_status: [{ moment_type: 1, status: 1 }],
        groups: [{ moment_type: 1, group_title: '项目群', future: true, group_preview_items: [
          {
            moment_id: 'valid', moment_type: 1, occurred_at: 10, is_degraded: false,
            jump_target: {
              chat_session_uid: 'group-1', record_owner_user_id: 20002,
              record_uid: 'record-1', rel_uid: 'rel-1', seq: 1,
            },
            render_payload: { sender_user_id: 20002, content: '@我' },
          },
          { moment_id: 'malformed', moment_type: 1, occurred_at: 11, jump_target: {}, render_payload: {} },
          { moment_id: 'future-type', moment_type: 99, occurred_at: 12 },
        ] }],
      } })
      if (url.endsWith('/api/v1/auth/get-public-users-by-ids')) throw new TypeError('profile unavailable')
      throw new Error(`unexpected URL ${url}`)
    })

    await expect(service.interwovenMoments(sourceRefFor('private_chat', 'private-1', '小林')))
      .resolves.toMatchObject({
        state: 'partial',
        moments: [{ groupName: '项目群', senderName: '小林', summary: '@我' }],
      })
  })

  it.each([false, true])('keeps projection pending after owner commit whether local invalidation rejects: %s', async rejects => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), vi.fn() as never)
    const ownerResult = {
      status: 'committed' as const, itemUid: 'record-1', version: 2,
      revisionUid: 'revision-1', projectionState: 'pending' as const,
    }
    vi.spyOn((service as unknown as { record: { commitRecordReedit: () => Promise<typeof ownerResult> } }).record, 'commitRecordReedit')
      .mockResolvedValue(ownerResult)
    const invalidate = vi.spyOn((service as unknown as { realtime: { invalidateRecordProjection: () => Promise<void> } }).realtime, 'invalidateRecordProjection')
    if (rejects) invalidate.mockRejectedValue(new Error('projection offline'))
    else invalidate.mockResolvedValue()

    await expect(service.commitRecordReedit({} as never)).resolves.toEqual(ownerResult)
    expect(invalidate).toHaveBeenCalledOnce()
  })

  it('rejects forged, expired and cross-account moment refs before record detail access', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-19T00:00:00Z'))
    try {
      const sessions = new MemorySessionStore()
      sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
      const urls: string[] = []
      const service = new ArkmeService(config, sessions, new MemoryStateStore(), async input => {
        const url = String(input); urls.push(url)
        if (url.endsWith('/api/v1/auth/able-func')) return json({ code: 200, data: { able: true } })
        if (url.endsWith('/api/v1/chats/detail')) return json({ code: 200, data: {
          session: { chat_session_uid: 'private-1', session_kind: 1 }, private_counterpart: { user_id: 20002 },
        } })
        if (url.endsWith('/api/v1/private/check-contact-chat')) return json({ code: 200, data: { exist: false } })
        if (url.endsWith('/api/v1/chats/interwoven/inline-bootstrap')) return json({ code: 200, data: {
          prepared_at: Date.now(), source_status: [{ moment_type: 1, status: 1 }],
          groups: [{ moment_type: 1, group_title: '群聊', group_preview_items: [{
            moment_id: 'one', moment_type: 1, occurred_at: Date.now(), is_degraded: false,
            jump_target: {
              chat_session_uid: 'group-1', record_owner_user_id: 20002,
              record_uid: 'record-1', rel_uid: 'rel-1', seq: 1,
            },
            render_payload: { sender_user_id: 20002, content: '@我' },
          }] }],
        } })
        if (url.endsWith('/api/v1/auth/get-public-users-by-ids')) return json({ code: 200, data: { items: [] } })
        if (url.endsWith('/api/v1/chats/records/detail')) throw new Error('record detail must not be called')
        throw new Error(`unexpected URL ${url}`)
      })
      const sourceRef = sourceRefFor('private_chat', 'private-1', '小林')
      const bootstrap = await service.interwovenMoments(sourceRef)
      const momentRef = bootstrap.moments[0]!.momentRef

      await expect(service.interwovenMomentDetail(sourceRef, 'arkme-moment-v1.forged.signature'))
        .rejects.toMatchObject({ code: 'interwoven-ref-invalid' })
      sessions.session = { userId: 30003, accessToken: 'other', refreshToken: 'other-refresh' }
      await expect(service.interwovenMomentDetail(
        sourceRefFor('private_chat', 'private-1', '小林', 30003), momentRef,
      )).rejects.toMatchObject({ code: 'interwoven-ref-invalid' })
      sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
      vi.advanceTimersByTime(13 * 60 * 60 * 1000)
      await expect(service.interwovenMomentDetail(sourceRef, momentRef))
        .rejects.toMatchObject({ code: 'interwoven-ref-expired' })
      expect(urls.some(url => url.endsWith('/api/v1/chats/records/detail'))).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
