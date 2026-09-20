import type { ResolvedMentions } from '../../src/services/mention-metadata-codec.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ArkmeStateStore } from '../../src/state-store.js'
import { ArkmePluginError } from '../../src/services/service.js'
import { RecordService } from '../../src/services/record-service.js'
import { prepareRecordReeditMentions, recordReeditMentionMetadata, recordReeditMentionProjection, type NewMentionResolver } from '../../src/services/record-reedit-mentions.js'
import { parseArkmeRecordReeditMentions, type ArkmeRecordReeditMention } from '../../src/record-reedit-contract.js'

const session = { userId: 42, accessToken: 'test', refreshToken: 'test' }
const source = { version: 1 as const, userId: 42, kind: 'group_chat' as const, ownerRef: 'chat-1', displayName: '群' }
const payload = { payload_kind: 2, schema_version: 1, text_state: 1,
  mention_metadata: { schema_version: 1, source_checksum: 'old', human_mentions: [
    { user_id: 17, display_name_snapshot: '小明', start_index: 0, length: 3 },
  ] }, media_refs: [{ file_asset_uid: 'image-a', file_kind: 1 }] }
const original = { originalIndex: 0, displayName: '小明', startIndex: 0, length: 3 }

async function metadataFromInputs(
  payload: Record<string, unknown> | undefined, originalText: string, text: string, inputs: ArkmeRecordReeditMention[],
  currentSource: { kind: string }, resolve: NewMentionResolver | undefined, format: 'plain' | 'markdown',
) {
  return recordReeditMentionMetadata(text,
    prepareRecordReeditMentions(payload, originalText, text, inputs, currentSource.kind === 'group_chat', format), resolve)
}

describe('record re-edit mention identities', () => {
  it('keeps historical identity without consulting a current roster and regenerates checksum', async () => {
    const validate = vi.fn()
    const result = await metadataFromInputs(payload, '@小明 原文', '😀 @小明 更新', [{ ...original, startIndex: 3 }], source, validate, 'plain')
    expect(result).toMatchObject({ source_checksum: expect.stringMatching(/^[a-f0-9]{64}$/), human_mentions: [
      { user_id: 17, display_name_snapshot: '小明', start_index: 3, length: 3 },
    ] })
    expect(validate).not.toHaveBeenCalled()
  })
  it('preserves identity when legacy evidence has no display-name snapshot', async () => {
    const value = { mention_metadata: { human_mentions: [{ user_id: 17, start_index: 0, length: 3 }] } }
    const mentions = recordReeditMentionProjection(value, '@小明 原文', 'plain')
    expect(mentions).toEqual([original])
    expect(await metadataFromInputs(value, '@小明 原文', '😀 @小明 原文', [{ ...mentions[0]!, startIndex: 3 }], source, undefined, 'plain'))
      .toMatchObject({ human_mentions: [{ user_id: 17, start_index: 3, length: 3 }] })
  })
  it.each([
    { kind: 'human_mentions', identity: {} },
    { kind: 'human_mentions', identity: { user_id: null } },
    { kind: 'human_mentions', identity: { user_id: -1 } },
    { kind: 'human_mentions', identity: { user_id: 1.5 } },
    { kind: 'human_mentions', identity: { user_id: '17' } },
    { kind: 'bot_mentions', identity: {} },
    { kind: 'bot_mentions', identity: { bot_uid: '' } },
    { kind: 'bot_mentions', identity: { bot_uid: 17 } },
    { kind: 'human_mentions', identity: { user_id: 17, display_name_snapshot: 17 } },
    { kind: 'human_mentions', identity: { user_id: 17, start_index: null } },
    { kind: 'human_mentions', identity: { user_id: 17, start_index: 0.5 } },
    { kind: 'human_mentions', identity: { user_id: 17, length: '3' } },
  ])('rejects malformed retained evidence without inventing an identity: $kind $identity', async ({ kind, identity }) => {
    const value = { mention_metadata: { [kind]: [{ start_index: 0, length: 3, ...identity }] } }
    await expect(metadataFromInputs(value, '@小明 原文', '@小明 更新', [original], source, undefined, 'plain'))
      .rejects.toMatchObject({ code: 'record-reedit-mention-invalid' })
    // The user can remove the bad evidence and keep editing the text.
    expect(await metadataFromInputs(value, '@小明 原文', '小明 更新', [], source, undefined, 'plain')).toBeUndefined()
  })

  it('validates new identities with the existing Chat contract', async () => {
    const validate = vi.fn(async () => ({ humans: [
      { user_id: 99, display_name_snapshot: '小红', start_index: 4, length: 3 },
    ], bots: [] }))
    const result = await metadataFromInputs(payload, '@小明 原文', '@小明 @小红', [original,
      { mentionRef: 'signed-chat-ref', displayName: '小红', startIndex: 4, length: 3 },
    ], source, validate, 'plain')
    expect(validate).toHaveBeenCalledWith([{ mentionRef: 'signed-chat-ref', startIndex: 4, length: 3 }], [])
    expect(result?.human_mentions).toHaveLength(2)
  })
  it.each([
    [{ ...original, originalIndex: 9 }],
    [{ ...original, displayName: '其他' }],
    [original, original],
    [{ ...original, startIndex: 1 }],
  ].map(mentions => ({ mentions })))('rejects forged or overlapping original identities: %j', async ({ mentions }) => {
    await expect(metadataFromInputs(payload, '@小明 原文', '@小明 更新', mentions, source, undefined, 'plain'))
      .rejects.toMatchObject({ code: 'record-reedit-mention-invalid' })
  })
  it('removes all mention metadata when the user explicitly removes the tokens', async () => {
    expect(await metadataFromInputs(payload, '@小明 原文', '更新', [], source, undefined, 'plain')).toBeUndefined()
  })
  it('keeps original bot and all-member identity separate', async () => {
    const value = { mention_metadata: {
      human_mentions: [{ user_id: 0, display_name_snapshot: '所有人', start_index: 0, length: 4 }],
      bot_mentions: [{ bot_uid: 'bot-1', display_name_snapshot: '助手', start_index: 5, length: 3 }],
    } }
    const mentions = recordReeditMentionProjection(value, '@所有人 @助手', 'plain')
    expect(await metadataFromInputs(value, '@所有人 @助手', '@所有人 @助手 好', mentions, source, undefined, 'plain'))
      .toMatchObject({ human_mentions: [{ user_id: 0 }], bot_mentions: [{ bot_uid: 'bot-1' }] })
  })
  it('does not permit adding a group human mention from a private chat', async () => {
    await expect(metadataFromInputs(undefined, '', '@所有人', [{ all: true, displayName: '所有人', startIndex: 0, length: 4 }],
      { ...source, kind: 'private_chat' }, vi.fn(), 'plain')).rejects.toMatchObject({ code: 'mention-chat-required' })
  })
  it.each([[{ ...original, mentionRef: 'also-new' }], [{ ...original, startIndex: -1 }], [{ ...original, length: 1.5 }]].map(mentions => ({ mentions })))('rejects ambiguous wire identities', ({ mentions }) => {
    expect(() => parseArkmeRecordReeditMentions(mentions)).toThrow()
  })

  it('keeps escaped Markdown offsets and rejects mention evidence in code or link destinations', async () => {
    const text = String.raw`@A\_B`
    const value = { mention_metadata: { human_mentions: [{ user_id: 17, display_name_snapshot: 'A_B', start_index: 0, length: text.length }] } }
    const mention = { originalIndex: 0, displayName: 'A_B', startIndex: 0, length: text.length }
    expect(await metadataFromInputs(value, text, text, [mention], source, undefined, 'markdown'))
      .toMatchObject({ human_mentions: [{ user_id: 17, start_index: 0, length: text.length }] })
    for (const [candidate, offset] of [[`\`${text}\``, 1], [`[链接](${text})`, 5]] as const) {
      await expect(metadataFromInputs(value, text, candidate, [{ ...mention, startIndex: offset }], source, undefined, 'markdown'))
        .rejects.toMatchObject({ code: 'record-reedit-mention-invalid' })
    }
  })

  it.each(['keep', 'remove', 'add', 'unknown'] as const)('persists a draft across restart and commits exact Record metadata (%s)', async mode => {
    const remove = mode === 'remove'
    const adding = mode === 'add'
    const validate = vi.fn(async () => ({ humans: [{ user_id: 99, display_name_snapshot: '小红', start_index: 7, length: 3 }], bots: [] }))
    const root = await mkdtemp(join(tmpdir(), 'arkme-reedit-mentions-'))
    let core: Record<string, unknown> = { record_uid: 'record-1', owner_user_id: 42, creator_user_id: 42,
      origin_kind: 4, origin_container_ref: 'chat-1', template_kind: 2, title: '', text_content: '@小明 原文',
      status: 1, version: 1, content_payload: payload }
    let writes = 0
    let written: Record<string, unknown> | undefined
    const runtime = { config: { maxTextLength: 20000 }, stateStore: new ArkmeStateStore(root),
      requireSession: async () => session,
      authenticatedPost: async (path: string, body: Record<string, unknown>) => {
        if (path === '/api/v1/records/update') {
          writes += 1
          written = body; core = { ...core, ...body, version: 2 }
          if (mode === 'unknown') throw new ArkmePluginError('arkme-timeout', 'timeout', true, 504, { writeOutcomeUnknown: true })
          return { record_core: core, revision_uid: 'revision-2' }
        }
        return { record_core: core }
      },
    }
    const media = { hydrateRecordMediaPage: async () => ({ displayItemsByRecordUid: new Map() }), richContentBlocks: () => [] }
    let service = new RecordService(runtime as never, media as never, { openSourceRef: async () => source }, undefined, undefined, undefined, validate)
    const detail = await service.recordReeditEditor('source-ref', 'record-1')
    expect(detail.mentions).toEqual([original])
    await service.saveRecordReeditDraft({ sourceRef: 'source-ref', itemUid: 'record-1', expectedVersion: 1,
      newText: remove ? '更新' : adding ? '  😀 @小明 @小红 更新  ' : '  😀 @小明 更新  ',
      mentions: remove ? [] : [{ ...original, startIndex: 5 }, ...(adding ? [{ mentionRef: 'new-human', displayName: '小红', startIndex: 9, length: 3 }] : [])],
    })
    service.dispose()
    runtime.stateStore = new ArkmeStateStore(root)
    service = new RecordService(runtime as never, media as never, { openSourceRef: async () => source }, undefined, undefined, undefined, validate)
    const restored = await service.recordReeditEditor('source-ref', 'record-1')
    expect(restored.draft).toMatchObject({ textContent: remove ? '更新' : adding ? '😀 @小明 @小红 更新' : '😀 @小明 更新',
      mentions: remove ? [] : [{ ...original, startIndex: 3 }, ...(adding ? [{ mentionRef: 'new-human', displayName: '小红', startIndex: 7, length: 3 }] : [])] })
    const context = await service.prepareRecordReedit({ sourceRef: 'source-ref', itemUid: 'record-1', expectedVersion: 1 })
    await service.commitRecordReedit(context)
    expect(writes).toBe(1)
    expect(written).toMatchObject({ version: 1, template_kind: 2, content_payload: { payload_kind: 2, media_refs: [{ file_asset_uid: 'image-a' }] } })
    const metadata = (written?.content_payload as Record<string, unknown>).mention_metadata
    if (remove) expect(metadata).toBeUndefined()
    else expect(metadata).toMatchObject({ human_mentions: [{ user_id: 17, start_index: 3, length: 3 }, ...(adding ? [{ user_id: 99, start_index: 7, length: 3 }] : [])] })
    if (adding) expect(validate).toHaveBeenCalledWith(source, '😀 @小明 @小红 更新', [{ mentionRef: 'new-human', startIndex: 7, length: 3 }], [], session, 'plain')
    service.dispose()
  })
})

it.each(['human', 'bot'] as const)('persists new %s mention intent while Chat is unavailable, restores it, and revalidates before writing', async kind => {
  const directory = await mkdtemp(join(tmpdir(), 'arkme-architecture-probe-'))
  const session = { userId: 42, accessToken: 'test', refreshToken: 'test' }
  const source = { version: 1 as const, userId: 42, kind: 'group_chat' as const, ownerRef: 'chat-1', displayName: '群' }
  const core = { record_uid: 'record-1', owner_user_id: 42, creator_user_id: 42,
    origin_kind: 4, origin_container_ref: 'chat-1', template_kind: 1, title: '', text_content: '原文', status: 1, version: 1 }
  const stateStore = new ArkmeStateStore(directory)
  const runtime = { config: { maxTextLength: 20000 }, stateStore, requireSession: async () => session,
    authenticatedPost: vi.fn(async (_path: string, _body: unknown) => ({ record_core: core })) }
  const reference = kind === 'human' ? { mentionRef: 'signed-ref' } : { botRef: 'signed-bot-ref' }
  const validator = vi.fn(async (): Promise<ResolvedMentions> => { throw new Error('chat-members-unavailable') })
  const media = { hydrateRecordMediaPage: async () => ({ displayItemsByRecordUid: new Map() }), richContentBlocks: () => [] }
  let service = new RecordService(runtime as never, media as never, { openSourceRef: async () => source }, undefined, undefined, undefined, validator)
  try {
    await service.recordReeditEditor('source-ref', 'record-1')
    const before = await service.saveRecordReeditDraft({ sourceRef: 'source-ref', itemUid: 'record-1', expectedVersion: 1, newText: '已保存草稿', mentions: [] })
    const save = vi.spyOn(stateStore, 'putRecordReeditDraft')
    await service.saveRecordReeditDraft({ sourceRef: 'source-ref', itemUid: 'record-1', expectedVersion: 1,
      expectedDraftRevision: before.draftRevision, newText: '@小红 新输入',
      mentions: [{ ...reference, displayName: '小红', startIndex: 0, length: 3 }] })
    expect(validator).not.toHaveBeenCalled()
    expect(save).toHaveBeenCalledOnce()
    await expect(service.saveRecordReeditDraft({ sourceRef: 'source-ref', itemUid: 'record-1', expectedVersion: 1,
      newText: '@小红 新输入', mentions: [{ originalIndex: 0, displayName: '小红', startIndex: 0, length: 3 }] }))
      .rejects.toMatchObject({ code: 'record-reedit-mention-invalid' })
    expect(validator).not.toHaveBeenCalled()
    service.dispose()
    runtime.stateStore = new ArkmeStateStore(directory)
    service = new RecordService(runtime as never, media as never, { openSourceRef: async () => source }, undefined, undefined, undefined, validator)
    const restored = await service.recordReeditEditor('source-ref', 'record-1')
    expect(restored.draft).toMatchObject({ textContent: '@小红 新输入', mentions: [reference] })
    await expect(service.prepareRecordReedit({ sourceRef: 'source-ref', itemUid: 'record-1', expectedVersion: 1 }))
      .rejects.toThrow('chat-members-unavailable')
    expect((await runtime.stateStore.getRecordReeditDraft(42, before.sourceIdentityKey, 'record-1'))?.textContent).toBe('@小红 新输入')
    expect(runtime.authenticatedPost.mock.calls.some(([path]) => path === '/api/v1/records/update')).toBe(false)
    validator.mockResolvedValueOnce(kind === 'human'
      ? { humans: [{ user_id: 99, display_name_snapshot: '小红', start_index: 0, length: 3 }], bots: [] }
      : { humans: [], bots: [{ bot_uid: 'bot-99', display_name_snapshot: '小红', start_index: 0, length: 3 }] })
    const prepared = await service.prepareRecordReedit({ sourceRef: 'source-ref', itemUid: 'record-1', expectedVersion: 1 })
    await expect(service.commitRecordReedit(prepared)).rejects.toThrow('chat-members-unavailable')
    expect(runtime.authenticatedPost.mock.calls.some(([path]) => path === '/api/v1/records/update')).toBe(false)
    expect((await runtime.stateStore.getRecordReeditDraft(42, before.sourceIdentityKey, 'record-1'))?.mentions).toHaveLength(1)
    await service.saveRecordReeditDraft({ sourceRef: 'source-ref', itemUid: 'record-1', expectedVersion: 1,
      newText: '移除失效引用后继续编辑', mentions: [] })
    const cleared = await service.recordReeditEditor('source-ref', 'record-1')
    expect(cleared.draft).toMatchObject({ textContent: '移除失效引用后继续编辑', mentions: [] })

  } finally { service.dispose(); await rm(directory, { recursive: true, force: true }) }
})
