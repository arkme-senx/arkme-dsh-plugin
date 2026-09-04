import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import { ArkmeStateStore } from '../../src/state-store.js'
import type { ArkmePendingWrite } from '../../src/types.js'
import { MediaService } from '../../src/services/media-service.js'
import { ProfileService } from '../../src/services/profile-service.js'
import { arkmeRecordCaptureContextPayload, RecordService } from '../../src/services/record-service.js'
import { ArkmePluginError, ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'

const config: ArkmeServiceConfig = {
  environment: 'test', authBaseUrl: 'https://auth.test', subjectBaseUrl: 'https://subject.test',
  recordBaseUrl: 'https://record.test', chatBaseUrl: 'https://chat.test', botBaseUrl: 'https://bot.test',
  imBaseUrl: 'https://im.test', webrtcBaseUrl: 'https://webrtc.test', worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test', intelligentBaseUrl: 'https://intelligent.test',
  routePath: '/arkme-self/api', audioBaseUrl: 'https://audio.test', requestTimeoutMs: 5_000,
  maxTextLength: 20_000, geetestCaptchaId: 'captcha-test-id-1234567890', interwovenMomentsEnabled: true,
}

describe('RecordService', () => {
  it('preserves the Flutter battery contract including an explicit zero percent', () => {
    expect(arkmeRecordCaptureContextPayload({ electric: 0, charge: 2 })).toEqual({ electric: 0, charge: 2 })
    expect(arkmeRecordCaptureContextPayload({ electric: 100, charge: 1 })).toEqual({ electric: 100, charge: 1 })
  })

  it('migrates an edited long-article draft to the stable record re-edit owner', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-long-article-reedit-'))
    const stateStore = new ArkmeStateStore(root)
    await stateStore.putLongArticleDraft(42, {
      sourceRef: 'source-ref-old',
      itemUid: 'record-1',
      title: '草稿标题',
      textContent: '草稿正文',
      durationMillis: 1200,
      updatedAtMillis: 100,
    })
    const source = {
      async openSourceRef(sourceRef: string) {
        return {
          version: 1 as const,
          userId: 42,
          kind: 'topic' as const,
          ownerRef: 'topic-1',
          displayName: sourceRef === 'source-ref-old' ? '旧主题名' : '新主题名',
        }
      },
    }
    const runtime = {
      config: { richMediaSendEnabled: true },
      stateStore,
      async requireSession() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async authenticatedPost() {
        return {
          record_core: {
            record_uid: 'record-1', template_kind: 1, display_kind: 1,
            owner_user_id: 42, creator_user_id: 42,
            title: '服务端标题', text_content: '服务端正文', version: 3, status: 1,
          },
          topic_core: { topic_uid: 'topic-1' },
        }
      },
    }
    const service = new RecordService(runtime as never, {} as MediaService, source)

    await expect(service.getLongArticleDraft('source-ref-old', 'record-1')).resolves.toMatchObject({
      title: '草稿标题', textContent: '草稿正文', durationMillis: 1200,
    })
    await expect(stateStore.getLongArticleDraft(42, 'source-ref-old', 'record-1')).resolves.toBeUndefined()
    await expect(service.getLongArticleDraft('source-ref-new', 'record-1')).resolves.toMatchObject({
      sourceRef: 'source-ref-new', title: '草稿标题', textContent: '草稿正文', durationMillis: 1200,
    })
  })

  it('prepares and commits a record re-edit while preserving owner-controlled content fields', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-record-reedit-'))
    const stateStore = new ArkmeStateStore(root)
    const calls: Array<{ path: string; body: Record<string, unknown> }> = []
    const originalCore = {
      record_uid: 'record-1', owner_user_id: 42, creator_user_id: 42,
      origin_kind: 4, origin_container_ref: 'group-1',
      template_kind: 4, display_kind: 2, title: '原标题', text_content: '原正文',
      content_payload: {
        payload_kind: 2, schema_version: 1, text_state: 1,
        media_refs: [{
          file_asset_uid: 'asset-1', render_role: 1, sort_order: 0,
          duration_sec: 7, file_name: '示例.mp4',
          file_uid: 'read-side-only', size: 123, mime_type: 'video/mp4',
          duration_millis: 7_000, legacy_remote_available: true,
        }],
      },
      record_duration_millis: 3_200, edit_duration_millis: 800, send_at: 123_000,
      status: 1, version: 7, content_access_state: 1,
    }
    const runtime = {
      config: { maxTextLength: 20_000, richMediaSendEnabled: true },
      stateStore,
      async requireSession() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async authenticatedPost(path: string, body: Record<string, unknown>) {
        calls.push({ path, body: structuredClone(body) })
        if (path === '/api/v1/records/detail') return { record_core: structuredClone(originalCore) }
        if (path === '/api/v1/records/update') {
          return {
            record_core: { ...structuredClone(originalCore), title: '新标题', text_content: '新正文', version: 8 },
            revision_uid: 'revision-1',
          }
        }
        throw new Error(`unexpected path: ${path}`)
      },
    }
    const service = new RecordService(runtime as never, {} as MediaService, {
      async openSourceRef() {
        return { version: 1 as const, userId: 42, kind: 'group_chat' as const, ownerRef: 'group-1', displayName: '研发群' }
      },
    })

    const prepared = await service.prepareRecordReedit({
      sourceRef: 'source-ref-1', itemUid: 'record-1', newTitle: '新标题', newText: '新正文',
    })
    expect(calls.map(call => call.path)).toEqual(['/api/v1/records/detail'])
    await expect(stateStore.getRecordReeditDraft(42, prepared.sourceIdentityKey, 'record-1')).resolves.toMatchObject({
      draftRevision: 1, title: '新标题', textContent: '新正文', baseVersion: 7,
    })

    await expect(service.commitRecordReedit(prepared)).resolves.toMatchObject({
      status: 'committed', itemUid: 'record-1', version: 8, revisionUid: 'revision-1',
    })
    expect(calls.map(call => call.path)).toEqual([
      '/api/v1/records/detail', '/api/v1/records/detail', '/api/v1/records/update',
    ])
    expect(calls[2]?.body).toEqual({
      record_uid: 'record-1', template_kind: 4, display_kind: 2,
      title: '新标题', text_content: '新正文',
      content_payload: {
        payload_kind: 2, schema_version: 1, text_state: 1,
        media_refs: [{
          file_asset_uid: 'asset-1', render_role: 1, sort_order: 0,
          duration_sec: 7, file_name: '示例.mp4',
        }],
      },
      record_duration_millis: 3_200, edit_duration_millis: 800, version: 7,
    })
    await expect(stateStore.getRecordReeditDraft(42, prepared.sourceIdentityKey, 'record-1')).resolves.toBeUndefined()
  })

  it('does not confuse a plain content payload with attachments', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-record-reedit-plain-payload-'))
    const stateStore = new ArkmeStateStore(root)
    const runtime = {
      config: { maxTextLength: 20_000 }, stateStore,
      async requireSession() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async authenticatedPost() {
        return { record_core: {
          record_uid: 'record-plain', owner_user_id: 42, creator_user_id: 42,
          origin_kind: 1, origin_container_ref: '', template_kind: 1,
          title: '', text_content: '普通正文', status: 1, version: 1, content_access_state: 1,
          content_payload: { payload_kind: 1, schema_version: 1, text_state: 1 },
        } }
      },
    }
    const service = new RecordService(runtime as never, {} as never, {
      async openSourceRef() {
        return { version: 1 as const, userId: 42, kind: 'default_category' as const, ownerRef: 'uncategorized', displayName: '未分类' }
      },
    })

    await expect(service.recordReeditEditor('source-ref', 'record-plain')).resolves.toMatchObject({
      preservesAttachments: false,
    })
  })

  it('rejects migration-only legacy file projections instead of reinterpreting them as file assets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-record-reedit-legacy-file-'))
    const stateStore = new ArkmeStateStore(root)
    const runtime = {
      config: { maxTextLength: 20_000 }, stateStore,
      async requireSession() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async authenticatedPost() {
        return { record_core: {
          record_uid: 'record-legacy', owner_user_id: 42, creator_user_id: 42,
          origin_kind: 1, origin_container_ref: '', template_kind: 2,
          title: '', text_content: '历史图片', status: 1, version: 1, content_access_state: 1,
          content_payload: {
            payload_kind: 2, schema_version: 1, text_state: 1,
            media_refs: [{
              file_asset_uid: 'legacy-file-1', file_uid: 'legacy-file-1', legacy_file_ref: true,
              legacy_file_kind: 'image', render_role: 1, sort_order: 0,
            }],
          },
        } }
      },
    }
    const service = new RecordService(runtime as never, {} as never, {
      async openSourceRef() {
        return { version: 1 as const, userId: 42, kind: 'default_category' as const, ownerRef: 'uncategorized', displayName: '未分类' }
      },
    })

    await expect(service.prepareRecordReedit({
      sourceRef: 'source-ref', itemUid: 'record-legacy', newText: '更新正文',
    })).rejects.toMatchObject({ code: 'record-reedit-legacy-files-unsupported' })
  })

  it('rejects plain-text edits that would detach existing mention evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-record-reedit-mention-'))
    const stateStore = new ArkmeStateStore(root)
    const runtime = {
      config: { maxTextLength: 20_000 }, stateStore,
      async requireSession() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async authenticatedPost() {
        return { record_core: {
          record_uid: 'record-mention', owner_user_id: 42, creator_user_id: 42,
          origin_kind: 1, origin_container_ref: '', template_kind: 1,
          title: '', text_content: '@小明 原正文', status: 1, version: 1, content_access_state: 1,
          content_payload: {
            payload_kind: 1, schema_version: 1, text_state: 1,
            mention_metadata: {
              schema_version: 1, source_checksum: 'checksum-1',
              human_mentions: [{ user_id: 1001, display_name_snapshot: '小明', start_index: 0, length: 3 }],
            },
          },
        } }
      },
    }
    const service = new RecordService(runtime as never, {} as never, {
      async openSourceRef() {
        return { version: 1 as const, userId: 42, kind: 'default_category' as const, ownerRef: 'uncategorized', displayName: '未分类' }
      },
    })

    await expect(service.prepareRecordReedit({
      sourceRef: 'source-ref', itemUid: 'record-mention', newText: '@小明 修改后正文',
    })).rejects.toMatchObject({ code: 'record-reedit-rich-text-unsupported' })
    await expect(service.prepareRecordReedit({
      sourceRef: 'source-ref', itemUid: 'record-mention', newTitle: '只改标题', newText: '@小明 原正文',
    })).resolves.toMatchObject({ newTitle: '只改标题', newTextPreview: '@小明 原正文' })
  })

  it('keeps the draft when the owner version changes before commit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-record-reedit-conflict-'))
    const stateStore = new ArkmeStateStore(root)
    let detailReads = 0
    let updateCalls = 0
    const runtime = {
      config: { maxTextLength: 20_000 }, stateStore,
      async requireSession() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async authenticatedPost(path: string) {
        if (path === '/api/v1/records/update') { updateCalls += 1; return {} }
        detailReads += 1
        return { record_core: {
          record_uid: 'record-1', owner_user_id: 42, creator_user_id: 42, origin_kind: 1, template_kind: 1,
          title: '', text_content: detailReads === 1 ? '原正文' : '其他端正文',
          status: 1, version: detailReads === 1 ? 7 : 8, content_access_state: 1, send_at: 123_000,
        } }
      },
    }
    const source = {
      async openSourceRef() {
        return { version: 1 as const, userId: 42, kind: 'send_to_self' as const, ownerRef: '42', displayName: '即我' }
      },
    }
    const service = new RecordService(runtime as never, {} as never, source)
    const prepared = await service.prepareRecordReedit({ sourceRef: 'source-ref', itemUid: 'record-1', newText: '我的草稿' })

    await expect(service.commitRecordReedit(prepared)).rejects.toMatchObject({ code: 'record-reedit-conflict' })
    expect(updateCalls).toBe(0)
    await expect(stateStore.getRecordReeditDraft(42, prepared.sourceIdentityKey, 'record-1')).resolves.toMatchObject({
      textContent: '我的草稿', draftRevision: prepared.draftRevision,
    })
  })

  it('does not rebase a browser editor candidate when the owner changes after the editor opens', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-record-reedit-editor-cas-'))
    const stateStore = new ArkmeStateStore(root)
    let version = 7
    let textContent = '原正文'
    let updateCalls = 0
    const runtime = {
      config: { maxTextLength: 20_000 }, stateStore,
      async requireSession() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async authenticatedPost(path: string) {
        if (path === '/api/v1/records/update') {
          updateCalls += 1
          return { record_core: { record_uid: 'record-1', version: version + 1 }, revision_uid: 'revision-1' }
        }
        return { record_core: {
          record_uid: 'record-1', owner_user_id: 42, creator_user_id: 42, origin_kind: 1, template_kind: 1,
          title: '', text_content: textContent, status: 1, version, content_access_state: 1, send_at: 123_000,
        } }
      },
    }
    const service = new RecordService(runtime as never, {} as never, {
      async openSourceRef() {
        return { version: 1 as const, userId: 42, kind: 'send_to_self' as const, ownerRef: '42', displayName: '即我' }
      },
    })
    const editor = await service.recordReeditEditor('source-ref', 'record-1')
    version = 8
    textContent = '其他端正文'

    const prepared = await service.prepareRecordReedit(
      { sourceRef: 'source-ref', itemUid: 'record-1', newText: '本机候选' },
      { expectedBaseVersion: editor.version },
    )
    await expect(service.commitRecordReedit(prepared)).rejects.toMatchObject({ code: 'record-reedit-conflict' })
    expect(updateCalls).toBe(0)
    await expect(stateStore.getRecordReeditDraft(42, prepared.sourceIdentityKey, 'record-1')).resolves.toMatchObject({
      textContent: '本机候选', baseVersion: 7,
    })
  })

  it('rejects a stale confirmation after the candidate draft changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-record-reedit-stale-confirmation-'))
    const stateStore = new ArkmeStateStore(root)
    let updateCalls = 0
    const runtime = {
      config: { maxTextLength: 20_000 }, stateStore,
      async requireSession() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async authenticatedPost(path: string) {
        if (path === '/api/v1/records/update') { updateCalls += 1; return {} }
        return { record_core: {
          record_uid: 'record-1', owner_user_id: 42, creator_user_id: 42, origin_kind: 1, template_kind: 1,
          title: '', text_content: '原正文', status: 1, version: 7, content_access_state: 1, send_at: 123_000,
        } }
      },
    }
    const source = {
      async openSourceRef() {
        return { version: 1 as const, userId: 42, kind: 'send_to_self' as const, ownerRef: '42', displayName: '即我' }
      },
    }
    const service = new RecordService(runtime as never, {} as never, source)
    const prepared = await service.prepareRecordReedit({ sourceRef: 'source-ref', itemUid: 'record-1', newText: '候选 A' })
    await service.prepareRecordReedit({ sourceRef: 'source-ref', itemUid: 'record-1', newText: '候选 B' })

    await expect(service.commitRecordReedit(prepared)).rejects.toMatchObject({ code: 'record-reedit-draft-changed' })
    expect(updateCalls).toBe(0)
  })

  it('reconciles an unknown write outcome from owner detail without replaying the update', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-record-reedit-reconcile-'))
    const stateStore = new ArkmeStateStore(root)
    let detailReads = 0
    let updateCalls = 0
    const runtime = {
      config: { maxTextLength: 20_000 }, stateStore,
      async requireSession() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async authenticatedPost(path: string) {
        if (path === '/api/v1/records/update') {
          updateCalls += 1
          throw new ArkmePluginError('arkme-timeout', 'timeout', true, 504, { writeOutcomeUnknown: true })
        }
        detailReads += 1
        return { record_core: {
          record_uid: 'record-1', owner_user_id: 42, creator_user_id: 42, origin_kind: 1, template_kind: 1,
          title: '', text_content: detailReads < 3 ? '原正文' : '新正文', status: 1,
          version: detailReads < 3 ? 7 : 8, content_access_state: 1, send_at: 123_000,
        } }
      },
    }
    const source = {
      async openSourceRef() {
        return { version: 1 as const, userId: 42, kind: 'send_to_self' as const, ownerRef: '42', displayName: '即我' }
      },
    }
    const service = new RecordService(runtime as never, {} as never, source)
    const prepared = await service.prepareRecordReedit({ sourceRef: 'source-ref', itemUid: 'record-1', newText: '新正文' })

    await expect(service.commitRecordReedit(prepared)).resolves.toMatchObject({ status: 'committed', version: 8 })
    expect(updateCalls).toBe(1)
    expect(detailReads).toBe(3)
    await expect(stateStore.getRecordReeditDraft(42, prepared.sourceIdentityKey, 'record-1')).resolves.toBeUndefined()
  })

  it.each([
    { current: { text_content: '原正文', version: 7 }, code: 'record-reedit-outcome-unknown' },
    { current: { text_content: '第三种正文', version: 8 }, code: 'record-reedit-conflict' },
  ])('keeps the candidate draft when an unknown write reconciles as $code', async ({ current, code }) => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-record-reedit-unknown-'))
    const stateStore = new ArkmeStateStore(root)
    let detailReads = 0
    let updateCalls = 0
    const runtime = {
      config: { maxTextLength: 20_000 }, stateStore,
      async requireSession() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async authenticatedPost(path: string) {
        if (path === '/api/v1/records/update') {
          updateCalls += 1
          throw new ArkmePluginError('arkme-timeout', 'timeout', true, 504, { writeOutcomeUnknown: true })
        }
        detailReads += 1
        const reconciled = detailReads === 3
        return { record_core: {
          record_uid: 'record-1', owner_user_id: 42, creator_user_id: 42, origin_kind: 1, template_kind: 1,
          title: '', text_content: reconciled ? current.text_content : '原正文', status: 1,
          version: reconciled ? current.version : 7, content_access_state: 1, send_at: 123_000,
        } }
      },
    }
    const service = new RecordService(runtime as never, {} as never, {
      async openSourceRef() {
        return { version: 1 as const, userId: 42, kind: 'send_to_self' as const, ownerRef: '42', displayName: '即我' }
      },
    })
    const prepared = await service.prepareRecordReedit({ sourceRef: 'source-ref', itemUid: 'record-1', newText: '新正文' })

    await expect(service.commitRecordReedit(prepared)).rejects.toMatchObject({ code })
    expect(updateCalls).toBe(1)
    await expect(stateStore.getRecordReeditDraft(42, prepared.sourceIdentityKey, 'record-1')).resolves.toMatchObject({
      textContent: '新正文', draftRevision: prepared.draftRevision,
    })
  })

  it.each([
    { core: { owner_user_id: 7 }, code: 'record-reedit-not-editable' },
    { core: { status: 2 }, code: 'record-reedit-not-editable' },
    { core: { content_access_state: 2 }, code: 'record-reedit-not-editable' },
    { core: { origin_container_ref: 'other-group' }, code: 'record-reedit-source-mismatch' },
    { core: { template_kind: 5 }, code: 'record-reedit-shape-unsupported' },
    { core: { template_kind: 8 }, code: 'record-reedit-shape-unsupported' },
  ])('rejects an unsafe owner detail before saving a draft: $code', async ({ core, code }) => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-record-reedit-unsafe-'))
    const stateStore = new ArkmeStateStore(root)
    const service = new RecordService({
      config: { maxTextLength: 20_000 }, stateStore,
      async requireSession() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async authenticatedPost() {
        return { record_core: {
          record_uid: 'record-1', owner_user_id: 42, creator_user_id: 42,
          origin_kind: 4, origin_container_ref: 'group-1', template_kind: 1, title: '', text_content: '原正文',
          status: 1, version: 7, content_access_state: 1, send_at: 123_000, ...core,
        } }
      },
    } as never, {} as never, {
      async openSourceRef() {
        return { version: 1 as const, userId: 42, kind: 'group_chat' as const, ownerRef: 'group-1', displayName: '研发群' }
      },
    })

    await expect(service.prepareRecordReedit({
      sourceRef: 'source-ref', itemUid: 'record-1', newText: '新正文',
    })).rejects.toMatchObject({ code })
  })

  it.each([
    {
      sourceKind: 'default_category' as const,
      ownerRef: 'uncategorized',
      core: { origin_kind: 2 },
    },
    {
      sourceKind: 'default_category' as const,
      ownerRef: 'uncategorized',
      core: { origin_kind: 1 },
      topicUid: 'topic-1',
    },
    {
      sourceKind: 'send_to_self' as const,
      ownerRef: 'all',
      core: { origin_kind: 4, origin_container_ref: 'group-1' },
    },
    {
      sourceKind: 'topic' as const,
      ownerRef: 'topic-1',
      core: { origin_kind: 1 },
      topicUid: 'topic-1',
    },
    {
      sourceKind: 'private_chat' as const,
      ownerRef: 'shared-container-ref',
      core: { origin_kind: 4, origin_container_ref: 'shared-container-ref' },
    },
    {
      sourceKind: 'group_chat' as const,
      ownerRef: 'shared-container-ref',
      core: { origin_kind: 3, origin_container_ref: 'shared-container-ref' },
    },
  ])('does not mix $sourceKind with a record from another source family', async ({ sourceKind, ownerRef, core, topicUid }) => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-record-reedit-source-family-'))
    const stateStore = new ArkmeStateStore(root)
    const service = new RecordService({
      config: { maxTextLength: 20_000 }, stateStore,
      async requireSession() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async authenticatedPost() {
        return {
          record_core: {
            record_uid: 'record-1', owner_user_id: 42, creator_user_id: 42,
            template_kind: 1, title: '', text_content: '原正文', status: 1,
            version: 7, content_access_state: 1, send_at: 123_000, ...core,
          },
          ...(topicUid === undefined ? {} : { topic_core: { topic_uid: topicUid } }),
        }
      },
    } as never, {} as never, {
      async openSourceRef() {
        return { version: 1 as const, userId: 42, kind: sourceKind, ownerRef, displayName: '来源' }
      },
    })

    await expect(service.prepareRecordReedit({
      sourceRef: 'source-ref', itemUid: 'record-1', newText: '新正文',
    })).rejects.toMatchObject({ code: 'record-reedit-source-mismatch' })
  })

  it.each([
    { sourceKind: 'topic' as const, ownerRef: 'topic-1', originKind: 2, topicUid: 'topic-1' },
    { sourceKind: 'private_chat' as const, ownerRef: 'private-1', originKind: 3 },
    { sourceKind: 'default_category' as const, ownerRef: 'uncategorized', originKind: 1 },
  ])('accepts a record from the exact $sourceKind family', async ({ sourceKind, ownerRef, originKind, topicUid }) => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-record-reedit-source-family-valid-'))
    const stateStore = new ArkmeStateStore(root)
    const service = new RecordService({
      config: { maxTextLength: 20_000 }, stateStore,
      async requireSession() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async authenticatedPost() {
        return {
          record_core: {
            record_uid: 'record-1', owner_user_id: 42, creator_user_id: 42,
            origin_kind: originKind,
            ...(sourceKind === 'private_chat' ? { origin_container_ref: ownerRef } : {}),
            template_kind: 1, title: '', text_content: '原正文', status: 1,
            version: 7, content_access_state: 1, send_at: 123_000,
          },
          ...(topicUid === undefined ? {} : { topic_core: { topic_uid: topicUid } }),
        }
      },
    } as never, {} as never, {
      async openSourceRef() {
        return { version: 1 as const, userId: 42, kind: sourceKind, ownerRef, displayName: '来源' }
      },
    })

    await expect(service.prepareRecordReedit({
      sourceRef: 'source-ref', itemUid: 'record-1', newText: '新正文',
    })).resolves.toMatchObject({ sourceKind, itemUid: 'record-1' })
  })

  it('discards only the exact confirmed draft without an owner update', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-record-reedit-discard-'))
    const stateStore = new ArkmeStateStore(root)
    let updateCalls = 0
    const runtime = {
      config: { maxTextLength: 20_000 }, stateStore,
      async requireSession() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async authenticatedPost(path: string, body: Record<string, unknown>) {
        if (path === '/api/v1/records/update') { updateCalls += 1; return {} }
        return { record_core: {
          record_uid: body.record_uid, owner_user_id: 42, creator_user_id: 42, origin_kind: 1, template_kind: 1,
          title: '', text_content: '原正文', status: 1, version: 7, content_access_state: 1, send_at: 123_000,
        } }
      },
    }
    const source = {
      async openSourceRef() {
        return { version: 1 as const, userId: 42, kind: 'send_to_self' as const, ownerRef: '42', displayName: '即我' }
      },
    }
    const service = new RecordService(runtime as never, {} as never, source)
    const first = await service.prepareRecordReedit({ sourceRef: 'source-ref', itemUid: 'record-1', newText: '草稿一' })
    const second = await service.prepareRecordReedit({ sourceRef: 'source-ref', itemUid: 'record-2', newText: '草稿二' })
    const discard = await service.prepareDiscardRecordReeditDraft('source-ref', 'record-1')

    await expect(service.discardRecordReeditDraft(discard)).resolves.toEqual({ status: 'discarded', itemUid: 'record-1' })
    expect(updateCalls).toBe(0)
    await expect(stateStore.getRecordReeditDraft(42, first.sourceIdentityKey, 'record-1')).resolves.toBeUndefined()
    await expect(stateStore.getRecordReeditDraft(42, second.sourceIdentityKey, 'record-2')).resolves.toMatchObject({ textContent: '草稿二' })
  })

  it('restores a durable draft after service reload but refreshes its owner baseline', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-record-reedit-reload-'))
    const stateStore = new ArkmeStateStore(root)
    let version = 7
    let textContent = '原正文'
    const runtime = {
      config: { maxTextLength: 20_000 }, stateStore,
      async requireSession() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async authenticatedPost() { return { record_core: {
        record_uid: 'record-1', owner_user_id: 42, creator_user_id: 42, origin_kind: 1, template_kind: 1,
        title: '', text_content: textContent, status: 1, version, content_access_state: 1, send_at: 123_000,
      } } },
    }
    const source = {
      async openSourceRef() {
        return { version: 1 as const, userId: 42, kind: 'send_to_self' as const, ownerRef: '42', displayName: '即我' }
      },
    }
    const firstService = new RecordService(runtime as never, {} as never, source)
    const first = await firstService.prepareRecordReedit({ sourceRef: 'source-ref-old', itemUid: 'record-1', newText: '未提交草稿' })
    version = 8
    textContent = '其他端已更新正文'
    const reloadedService = new RecordService(runtime as never, {} as never, source)

    const restored = await reloadedService.prepareRecordReedit({ sourceRef: 'source-ref-new', itemUid: 'record-1' })
    expect(restored).toMatchObject({
      draftRevision: first.draftRevision, baseVersion: 8,
      oldTextPreview: '其他端已更新正文', newTextPreview: '未提交草稿', sourceRef: 'source-ref-new',
    })
    await expect(stateStore.getRecordReeditDraft(42, restored.sourceIdentityKey, 'record-1')).resolves.toMatchObject({
      textContent: '未提交草稿', baseVersion: 8,
    })
  })

  it('rejects commit after an account switch before reading or updating the owner', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-record-reedit-account-'))
    const stateStore = new ArkmeStateStore(root)
    let userId = 42
    let calls = 0
    const runtime = {
      config: { maxTextLength: 20_000 }, stateStore,
      async requireSession() { return { userId, accessToken: 'access', refreshToken: 'refresh' } },
      async authenticatedPost() {
        calls += 1
        return { record_core: {
          record_uid: 'record-1', owner_user_id: 42, creator_user_id: 42, origin_kind: 1, template_kind: 1,
          title: '', text_content: '原正文', status: 1, version: 7, content_access_state: 1, send_at: 123_000,
        } }
      },
    }
    const service = new RecordService(runtime as never, {} as never, {
      async openSourceRef(_sourceRef: string, expectedUserId: number) {
        return { version: 1 as const, userId: expectedUserId, kind: 'send_to_self' as const, ownerRef: String(expectedUserId), displayName: '即我' }
      },
    })
    const prepared = await service.prepareRecordReedit({ sourceRef: 'source-ref', itemUid: 'record-1', newText: '草稿' })
    userId = 43

    await expect(service.commitRecordReedit(prepared)).rejects.toMatchObject({ code: 'record-reedit-account-changed' })
    expect(calls).toBe(1)
    await expect(stateStore.getRecordReeditDraft(42, prepared.sourceIdentityKey, 'record-1')).resolves.toMatchObject({ textContent: '草稿' })
  })

  it('retains a draft after a definite owner rejection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-record-reedit-rejected-'))
    const stateStore = new ArkmeStateStore(root)
    const runtime = {
      config: { maxTextLength: 20_000 }, stateStore,
      async requireSession() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async authenticatedPost(path: string) {
        if (path === '/api/v1/records/update') throw new ArkmePluginError('record-http-400', 'invalid', false, 400)
        return { record_core: {
          record_uid: 'record-1', owner_user_id: 42, creator_user_id: 42, origin_kind: 1, template_kind: 1,
          title: '', text_content: '原正文', status: 1, version: 7, content_access_state: 1, send_at: 123_000,
        } }
      },
    }
    const source = {
      async openSourceRef() {
        return { version: 1 as const, userId: 42, kind: 'send_to_self' as const, ownerRef: '42', displayName: '即我' }
      },
    }
    const service = new RecordService(runtime as never, {} as never, source)
    const prepared = await service.prepareRecordReedit({ sourceRef: 'source-ref', itemUid: 'record-1', newText: '新正文' })

    await expect(service.commitRecordReedit(prepared)).rejects.toMatchObject({ code: 'record-http-400' })
    await expect(stateStore.getRecordReeditDraft(42, prepared.sourceIdentityKey, 'record-1')).resolves.toMatchObject({
      textContent: '新正文',
    })
  })

  it('restores a record extension parent preview from the durable home-feed contract', () => {
    const media = {
      richContentBlocks: vi.fn((raw: unknown) => {
        const core = (raw as { record_core?: { record_uid?: string } }).record_core
        return core?.record_uid === 'record-parent' ? [{
          kind: 'image', mediaRef: 'parent-image-ref', fileName: 'parent.png', mimeType: 'image/png', size: 12, sortOrder: 0,
        }] : []
      }),
    }
    const service = new RecordService({} as ServiceRuntime, media as never, {
      async openSourceRef() { throw new Error('unexpected') },
    })

    expect(service.recordTimelineItemFromRaw({
      record_uid: 'record-child',
      send_at: 300,
      record_core: {
        record_uid: 'record-child', text_content: '延展正文', template_kind: 1, status: 1,
        parent_record_uid: 'record-parent',
        extension_parent_preview: {
          record: {
            record_uid: 'record-parent', nickname: '我', title: '', text_content: '原快记内容',
            template_kind: 2, status: 1,
          },
        },
      },
    }, 42, { isMe: true })).toMatchObject({
      itemUid: 'record-child',
      textContent: '延展正文',
      extensionParentRecordUid: 'record-parent',
      extensionParent: {
        itemUid: 'record-parent', senderName: '我', title: '', textContent: '原快记内容',
        contentBlocks: [{ kind: 'image', mediaRef: 'parent-image-ref', fileName: 'parent.png' }],
      },
    })
  })

  it('keeps composer duration and browser context through a failed write and durable retry', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    let pending: ArkmePendingWrite[] = []
    const stateStore = {
      async putPending(_userId: number, item: ArkmePendingWrite) { pending = [structuredClone(item)] },
      async listPending() { return structuredClone(pending) },
      async markAttempt(_userId: number, recordUid: string, error: string) {
        pending = pending.map(item => item.recordUid === recordUid ? { ...item, attempts: item.attempts + 1, lastError: error } : item)
      },
      async markSynced(_userId: number, recordUid: string) { pending = pending.filter(item => item.recordUid !== recordUid) },
    } as StateStore
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const fetchImpl = vi.fn(async (input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      const url = String(input)
      requests.push({ url, body })
      if (requests.length === 1) throw new TypeError('offline')
      if (url.endsWith('/api/v1/records/tags/set')) {
        return new Response(JSON.stringify({ code: 0, data: {
          record_uid: body.record_uid, semantic_version: 1, projection_refresh_pending: false,
        } }), { status: 200 })
      }
      return new Response(JSON.stringify({ code: 0, data: { record_uid: body.record_uid, status: 1 } }), { status: 200 })
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, stateStore, fetchImpl)
    const profile = new ProfileService(runtime)
    const media = new MediaService(runtime, profile, {
      async openWorldImageRef() { throw new Error('unexpected') },
    }, { recordUid() { return '' } })
    const service = new RecordService(runtime, media, {
      async openSourceRef() { throw new Error('unexpected') },
    })
    const recordUid = 'ccfe56ca-4d7a-4c95-b383-fce1c65a635b'
    const captureContext = {
      clientName: 'Google Chrome（DeepSeek Harness）', networkName: '网络已连接', electric: 100, charge: 1,
    }

    await expect(service.createTextForConversation(recordUid, '#项目 浏览器采集验证', {
      recordDurationMillis: 3_200,
      captureContext,
    })).resolves.toMatchObject({ recordUid, localState: 'failed' })
    expect(pending).toMatchObject([{ recordUid, recordDurationMillis: 3_200, captureContext, attempts: 1 }])

    await expect(service.retryPending(recordUid)).resolves.toEqual({ recordUid, status: 1 })
    const createBodies = requests.filter(request => request.url.endsWith('/api/v1/records/create')).map(request => request.body)
    expect(createBodies).toHaveLength(2)
    for (const body of createBodies) {
      expect(body).toMatchObject({
        record_uid: recordUid,
        text_content: '#项目 浏览器采集验证',
        record_duration_millis: 3_200,
        capture_context: {
          client_name: 'Google Chrome（DeepSeek Harness）', network_name: '网络已连接', electric: 100, charge: 1,
        },
        content_payload: {
          payload_kind: 1, schema_version: 1, text_state: 1,
          hash_tags: [{ tag: '项目', start_index: 0, length: 3 }],
        },
      })
    }
    expect(requests.find(request => request.url.endsWith('/api/v1/records/tags/set'))?.body).toEqual({
      record_uid: recordUid,
      expected_record_version: 1,
      tags: [{ tag_text: '项目', start_index: 0, length: 3 }],
    })
    expect(pending).toEqual([])
  })

  it('keeps an accepted record synced when post-commit tag projection sync fails', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    let pending: ArkmePendingWrite[] = []
    const stateStore = {
      async putPending(_userId: number, item: ArkmePendingWrite) { pending = [structuredClone(item)] },
      async listPending() { return structuredClone(pending) },
      async markAttempt() { throw new Error('accepted record must not be marked failed') },
      async markSynced(_userId: number, recordUid: string) { pending = pending.filter(item => item.recordUid !== recordUid) },
    } as StateStore
    const fetchImpl = vi.fn(async (input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      if (String(input).endsWith('/api/v1/records/tags/set')) {
        return new Response(JSON.stringify({ code: 500, message: 'projection unavailable' }), { status: 200 })
      }
      return new Response(JSON.stringify({ code: 0, data: { record_uid: body.record_uid, status: 1 } }), { status: 200 })
    }) as typeof fetch
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const service = new RecordService(
      new ServiceRuntime(config, sessions, stateStore, fetchImpl),
      {} as MediaService,
      { async openSourceRef() { throw new Error('unexpected') } },
    )
    const recordUid = 'ccfe56ca-4d7a-4c95-b383-fce1c65a635b'

    await expect(service.createTextForConversation(recordUid, '#项目')).resolves.toEqual({
      recordUid, status: 1, localState: 'synced',
    })
    expect(pending).toEqual([])
    expect(warn).toHaveBeenCalledWith(
      'dsh-arkme: record tag post-commit sync failed',
      'projection unavailable',
    )
  })

  it('does not create a pending record under a different current account', async () => {
    const putPending = vi.fn()
    const service = new RecordService({
      config: { maxTextLength: 20_000 },
      requireSession: async () => ({ userId: 43, accessToken: 'access', refreshToken: 'refresh' }),
      stateStore: { putPending },
    } as never, {} as never, {} as never)

    await expect(service.createTextForConversation(
      'ccfe56ca-4d7a-4c95-b383-fce1c65a635b',
      '账号 A 的输入',
      { expectedUserId: 42 },
    )).rejects.toMatchObject({ code: 'file-account-changed' })
    expect(putPending).not.toHaveBeenCalled()
  })

  it('reads and caches the self-record summary', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    let cached: unknown
    const stateStore = { async cacheSummary(_userId: number, summary: unknown) { cached = summary } } as StateStore
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 0, data: {
      record_count: 3, words_count: 120, total_sec: 45,
    } }), { status: 200 })) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, stateStore, fetchImpl)
    const profile = new ProfileService(runtime)
    const media = new MediaService(runtime, profile, {
      async openWorldImageRef() { throw new Error('unexpected') },
    }, { recordUid() { return '' } })
    const service = new RecordService(runtime, media, {
      async openSourceRef() { throw new Error('unexpected') },
    })

    await expect(service.summary()).resolves.toEqual({ recordCount: 3, wordsCount: 120, totalSec: 45 })
    expect(cached).toEqual({ recordCount: 3, wordsCount: 120, totalSec: 45 })
  })

  it('lists hashtag candidates with their usage counts', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    let requestedUrl = ''
    let requestBody: Record<string, unknown> = {}
    const fetchImpl = vi.fn(async (input, init) => {
      requestedUrl = String(input)
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(JSON.stringify({ code: 0, data: { items: [{
        normalized_tag: 'project', tag_text: 'Project', record_count: 7,
        latest_record_uid: 'record-1', latest_send_at: 1_700_000_000_000,
      }] } }), { status: 200 })
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore, fetchImpl)
    const service = new RecordService(runtime, {} as MediaService, {
      async openSourceRef() { throw new Error('unexpected') },
    })

    await expect(service.listTags(100)).resolves.toEqual({ items: [{
      normalizedTag: 'project', tagText: 'Project', recordCount: 7,
      latestRecordUid: 'record-1', latestSendAtMillis: 1_700_000_000_000,
    }] })
    expect(requestedUrl).toBe('https://record.test/api/v1/records/tags/list')
    expect(requestBody).toEqual({ limit: 100 })
  })

  it('creates a canonical Record whose file assets stay in content_payload media refs', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    let requestBody: Record<string, unknown> | undefined
    const fetchImpl = vi.fn(async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(JSON.stringify({ code: 0, data: { record_uid: requestBody.record_uid, status: 1 } }), { status: 200 })
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore, fetchImpl)
    const profile = new ProfileService(runtime)
    const media = new MediaService(runtime, profile, {
      async openWorldImageRef() { throw new Error('unexpected') },
    }, { recordUid() { return '' } })
    const service = new RecordService(runtime, media, {
      async openSourceRef() { throw new Error('unexpected') },
    })

    await expect(service.createFileAssetsForConversation(
      'ccfe56ca-4d7a-4c95-b383-fce1c65a635b',
      '图片正文',
      [{ fileAssetUid: 'asset-12345678', fileName: 'a.png', mimeType: 'image/png', size: 128, fileKind: 1 }],
    )).resolves.toEqual({ recordUid: 'ccfe56ca-4d7a-4c95-b383-fce1c65a635b', status: 1 })
    expect(requestBody).toEqual({
      record_uid: 'ccfe56ca-4d7a-4c95-b383-fce1c65a635b',
      template_kind: 2,
      display_kind: 0,
      title: '',
      text_content: '图片正文',
      content_payload: {
        payload_kind: 2,
        schema_version: 1,
        text_state: 1,
        media_refs: [{
          file_asset_uid: 'asset-12345678', content_file_role: 1, render_role: 1,
          sort_order: 0, file_name: 'a.png',
        }],
      },
      send_at: expect.any(Number),
    })
    expect(requestBody).not.toHaveProperty('file_assets')
  })

  it('creates a durable record extension with the desktop endpoint and parent edge', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    let requestPath = ''
    let requestBody: Record<string, unknown> | undefined
    const fetchImpl = vi.fn(async (input, init) => {
      requestPath = String(input)
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(JSON.stringify({ code: 0, data: {
        record_uid: requestBody.record_uid,
        record_status: 1,
        edge_uid: 'edge-extension-1',
        parent_record_uid: requestBody.parent_record_uid,
        root_record_uid: requestBody.parent_record_uid,
        edge_status: 1,
      } }), { status: 200 })
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore, fetchImpl)
    const service = new RecordService(runtime, {} as MediaService, {
      async openSourceRef() { throw new Error('unexpected') },
    })
    const childRecordUid = 'ccfe56ca-4d7a-4c95-b383-fce1c65a635b'

    await expect(service.createExtensionForConversation(
      'parent-record-1',
      childRecordUid,
      '附件延展',
      [{ fileAssetUid: 'asset-12345678', fileName: 'a.png', mimeType: 'image/png', size: 128, fileKind: 1 }],
    )).resolves.toEqual({ recordUid: childRecordUid, status: 1, localState: 'synced' })
    expect(requestPath).toBe('https://record.test/api/v1/records/extensions/create')
    expect(requestBody).toEqual({
      parent_record_uid: 'parent-record-1',
      record_uid: childRecordUid,
      template_kind: 2,
      title: '',
      text_content: '附件延展',
      content_payload: {
        payload_kind: 2,
        schema_version: 1,
        text_state: 1,
        media_refs: [{
          file_asset_uid: 'asset-12345678', content_file_role: 1, render_role: 1, sort_order: 0,
          file_name: 'a.png', file_kind: 1, mime_type: 'image/png', size: 128,
        }],
      },
      send_at: expect.any(Number),
    })
  })

  it('creates a DSH Agent input Record through the fixed-source route', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    let requestPath = ''
    let requestBody: Record<string, unknown> | undefined
    const fetchImpl = vi.fn(async (input, init) => {
      requestPath = String(input)
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(JSON.stringify({ code: 0, data: { record_uid: requestBody.record_uid, status: 1 } }), { status: 200 })
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore, fetchImpl)
    const profile = new ProfileService(runtime)
    const media = new MediaService(runtime, profile, {
      async openWorldImageRef() { throw new Error('unexpected') },
    }, { recordUid() { return '' } })
    const service = new RecordService(runtime, media, {
      async openSourceRef() { throw new Error('unexpected') },
    })

    await expect(service.createDSHAgentInputText(
      'ccfe56ca-4d7a-4c95-b383-fce1c65a635b',
      '用户在 DSH 的输入',
      1713830400000,
    )).resolves.toEqual({ recordUid: 'ccfe56ca-4d7a-4c95-b383-fce1c65a635b', status: 1 })
    expect(requestPath).toBe('https://record.test/api/v1/records/dsh-agent-input/create')
    expect(requestBody).toEqual({
      record_uid: 'ccfe56ca-4d7a-4c95-b383-fce1c65a635b',
      template_kind: 1,
      title: '',
      text_content: '用户在 DSH 的输入',
      send_at: 1713830400000,
    })
    expect(requestBody).not.toHaveProperty('creation_source')
  })

  it('excludes DSH Agent input records from the default category page', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    let cachedPage: unknown
    const stateStore = {
      async cachePage(_userId: number, page: unknown) { cachedPage = page },
    } as StateStore
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 0, data: {
      items: [{
        record_uid: 'dsh-input-1',
        send_at: 200,
        record_core: {
          record_uid: 'dsh-input-1',
          title: '',
          text_content: '不应出现在默认分类',
          template_kind: 1,
          status: 1,
          version: 1,
          creation_source: 3,
          send_at: 200,
        },
      }, {
        record_uid: 'normal-1',
        send_at: 190,
        record_core: {
          record_uid: 'normal-1',
          title: '',
          text_content: '普通发给自己',
          template_kind: 1,
          status: 1,
          version: 1,
          creation_source: 0,
          send_at: 190,
        },
      }],
      has_more: false,
    } }), { status: 200 })) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, stateStore, fetchImpl)
    const profile = new ProfileService(runtime)
    const media = new MediaService(runtime, profile, {
      async openWorldImageRef() { throw new Error('unexpected') },
    }, { recordUid() { return '' } })
    const service = new RecordService(runtime, media, {
      async openSourceRef() { throw new Error('unexpected') },
    })

    await expect(service.list(30)).resolves.toMatchObject({
      items: [{ recordUid: 'normal-1', textContent: '普通发给自己' }],
      hasMore: false,
    })
    expect(cachedPage).toMatchObject({
      items: [{ recordUid: 'normal-1' }],
      hasMore: false,
    })
  })

  it('backfills default category pages after filtering DSH Agent input records', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const requestBodies: Record<string, unknown>[] = []
    const fetchImpl = vi.fn(async (input, init) => {
      if (String(input).endsWith('/api/v1/records/privacy/visibility-snapshot')) {
        return new Response(JSON.stringify({ code: 0, data: { items: [], has_more: false } }), { status: 200 })
      }
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      requestBodies.push(body)
      const firstPage = body.cursor_record_uid === undefined
      if (firstPage) return new Response(JSON.stringify({ code: 0, data: {
        items: [{
          record_uid: 'dsh-input-1',
          send_at: 200,
          record_core: {
            record_uid: 'dsh-input-1',
            title: '',
            text_content: '被过滤',
            template_kind: 1,
            status: 1,
            version: 1,
            creation_source: 3,
            send_at: 200,
          },
        }],
        has_more: true,
        next_cursor_send_at: 200,
        next_cursor_record_uid: 'dsh-input-1',
      } }), { status: 200 })
      return new Response(JSON.stringify({ code: 0, data: {
        items: [{
          record_uid: 'normal-2',
          send_at: 190,
          record_core: {
            record_uid: 'normal-2',
            title: '',
            text_content: '补拉出来的普通内容',
            template_kind: 1,
            status: 1,
            version: 1,
            send_at: 190,
          },
        }],
        has_more: false,
      } }), { status: 200 })
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, {
      async cachePage() {},
    } as StateStore, fetchImpl)
    const profile = new ProfileService(runtime)
    const media = new MediaService(runtime, profile, {
      async openWorldImageRef() { throw new Error('unexpected') },
    }, { recordUid() { return '' } })
    const service = new RecordService(runtime, media, {
      async openSourceRef() { throw new Error('unexpected') },
    })

    await expect(service.list(1)).resolves.toMatchObject({
      items: [{ recordUid: 'normal-2', textContent: '补拉出来的普通内容' }],
      hasMore: false,
    })
    expect(requestBodies).toEqual([
      { limit: 1 },
      { limit: 1, cursor_send_at: 200, cursor_record_uid: 'dsh-input-1' },
    ])
  })

  it('identifies DSH Agent input from record core creation source', () => {
    const runtime = new ServiceRuntime(config, {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }, {} as StateStore, vi.fn<typeof fetch>())
    const profile = new ProfileService(runtime)
    const media = new MediaService(runtime, profile, {
      async openWorldImageRef() { throw new Error('unexpected') },
    }, { recordUid() { return '' } })
    const service = new RecordService(runtime, media, {
      async openSourceRef() { throw new Error('unexpected') },
    })

    expect(service.isDSHAgentInput({
      record_core: { record_uid: 'dsh-input-1', creation_source: '3' },
    })).toBe(true)
    expect(service.isDSHAgentInput({
      record_core: { record_uid: 'agent-1', creation_source: 1 },
    })).toBe(false)
  })

  it('rejects invalid file-asset records before making a Record request', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const fetchImpl = vi.fn<typeof fetch>()
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore, fetchImpl)
    const profile = new ProfileService(runtime)
    const media = new MediaService(runtime, profile, {
      async openWorldImageRef() { throw new Error('unexpected') },
    }, { recordUid() { return '' } })
    const service = new RecordService(runtime, media, {
      async openSourceRef() { throw new Error('unexpected') },
    })

    await expect(service.createFileAssetsForConversation(
      'ccfe56ca-4d7a-4c95-b383-fce1c65a635b', '', [],
    )).rejects.toMatchObject({ code: 'record-file-assets-invalid' })
    await expect(service.createFileAssetsForConversation(
      'ccfe56ca-4d7a-4c95-b383-fce1c65a635b', '正文',
      [{ fileAssetUid: 'bad', fileName: 'a.png', mimeType: 'image/png', size: 128, fileKind: 1 }],
    )).rejects.toMatchObject({ code: 'record-file-asset-invalid' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
