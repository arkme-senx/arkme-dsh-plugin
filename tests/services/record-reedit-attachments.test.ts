import { mkdtemp, rename, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ArkmeStateStore } from '../../src/state-store.js'
import { RecordService } from '../../src/services/record-service.js'
import { ArkmeService } from '../../src/arkme-service.js'
import { MediaService } from '../../src/services/media-service.js'
import { ArkmePluginError } from '../../src/services/service.js'
import { FileTransfers, type FileTransferPorts } from '../../src/services/file-transfers.js'

const fileRef = 'arkme-file-v1.11111111-1111-4111-8111-111111111111'
const localFile = { fileRef, fileName: 'new.png', mimeType: 'image/png', size: 12, fileKind: 1 as const }
const asset = { fileAssetUid: 'new-asset', fileName: 'new.png', mimeType: 'image/png', size: 12, fileKind: 1 as const }
const media = (uid: string, sortOrder = 0) => ({ file_asset_uid: uid, render_role: 1, sort_order: sortOrder, file_name: `${uid}.png` })

async function setup(overrides: Record<string, unknown> = {}, onCommitted?: () => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'arkme-attachment-reedit-'))
  const stateStore = new ArkmeStateStore(root)
  let userId = 42
  const core: Record<string, unknown> = {
    record_uid: 'r1', owner_user_id: 42, creator_user_id: 42, origin_kind: 1,
    origin_container_ref: '', template_kind: 2, title: '', text_content: '原文',
    content_payload: { payload_kind: 2, schema_version: 1, text_state: 1, media_refs: [media('a'), media('b', 1)] },
    status: 1, version: 7, content_access_state: 1, ...overrides,
  }
  const writes: Record<string, unknown>[] = []
  const readMedia = vi.fn(async () => ({ items: [{ record_uid: 'r1', items: [
    { file_asset_uid: 'a', file_name: 'a.png', file_kind: 1, mime_type: 'image/png', size: 20, preview_url: 'https://example.com/a.png', download_url: 'https://example.com/a.png' },
    { file_asset_uid: 'b', file_name: 'b.png', file_kind: 1, mime_type: 'image/png', size: 20, preview_url: 'https://example.com/b.png', download_url: 'https://example.com/b.png' },
  ] }] }))
  const update = vi.fn(async (body: Record<string, unknown>) => {
    // Record owner contract: content.RecordContentPayload.validateVoice forbids all media_refs.
    const payload = body.content_payload as { payload_kind?: number; media_refs?: unknown[] } | undefined
    if (payload?.payload_kind === 3 && (payload.media_refs?.length ?? 0) > 0) {
      throw new Error('record voice payload must not include media_refs')
    }
    writes.push(structuredClone(body))
    Object.assign(core, body, { version: Number(core.version) + 1 })
    return { record_core: structuredClone(core), revision_uid: 'revision' }
  })
  const runtime = {
    config: { maxTextLength: 20_000, richMediaSendEnabled: true }, stateStore,
    async requireSession() { return { userId, accessToken: 'access', refreshToken: 'refresh' } },
    async authenticatedPost(path: string, body: Record<string, unknown>) {
      if (path === '/api/v1/records/detail') return { record_core: structuredClone(core) }
      if (path === '/api/v1/records/update') return await update(body)
      if (path === '/api/v1/records/media/batch-list') return await readMedia()
      throw new Error(path)
    },
  }
  const files = {
    files: vi.fn(async () => [localFile]),
    readLocal: vi.fn(async () => ({ file: localFile })),
    uploadRefs: vi.fn(async () => [asset]),
    async withReferences<T>(refs: readonly string[], _userId: number, persist: () => Promise<T>): Promise<T> {
      for (const _ref of refs) await files.readLocal()
      return await persist()
    },
  }
  const mediaService = new MediaService(runtime as never, {} as never, {} as never, { recordUid: raw => (raw as any).record_core?.record_uid ?? '' })
  const sourceReader = {
    async openSourceRef() { return { version: 1 as const, userId: 42, kind: 'default_category' as const, ownerRef: 'uncategorized', displayName: '未分类' } },
  }
  const restart = (freshState = false) => new RecordService((freshState ? { ...runtime, stateStore: new ArkmeStateStore(root) } : runtime) as never, mediaService, sourceReader, undefined, files, onCommitted)
  const service = restart()
  return { root, stateStore, service, restart, runtime, core, files, writes, update, readMedia, sourceReader, switchAccount: () => { userId = 99 } }
}
const target = { sourceRef: 'source', itemUid: 'r1' }

describe('Record attachment re-edit', () => {
  it.each([
    { kind: 'default_category', originKind: 1, ownerRef: 'uncategorized', originRef: '' },
    { kind: 'send_to_self', originKind: 1, ownerRef: 'self', originRef: '' },
    { kind: 'topic', originKind: 2, ownerRef: 'topic-1', originRef: 'topic-1' },
    { kind: 'private_chat', originKind: 3, ownerRef: 'private-1', originRef: 'private-1' },
    { kind: 'group_chat', originKind: 4, ownerRef: 'group-1', originRef: 'group-1' },
  ])('opens, drafts and commits a background record through $kind', async route => {
    const background = { ...media('ambient'), content_file_role: 4 }
    const x = await setup({ origin_kind: route.originKind, origin_container_ref: route.originRef,
      template_kind: 1, content_payload: { payload_kind: 1, schema_version: 1, text_state: 1,
        media_refs: [background], background_sound_amplitudes: [0.2] } })
    vi.spyOn(x.sourceReader, 'openSourceRef').mockResolvedValue({ version: 1, userId: 42,
      kind: route.kind, ownerRef: route.ownerRef, displayName: route.kind } as never)
    const read = x.runtime.authenticatedPost.bind(x.runtime)
    vi.spyOn(x.runtime, 'authenticatedPost').mockImplementation(async (path, body) => {
      const value = await read(path, body)
      return path === '/api/v1/records/detail' && route.kind === 'topic'
        ? { ...value, topic_core: { topic_uid: route.ownerRef } } : value
    })
    try {
      const editor = await x.service.recordReeditEditor('source', 'r1')
      expect(editor.attachments).toEqual([])
      await x.service.saveRecordReeditDraft({ ...target, newText: '新正文', expectedVersion: 7, attachments: [] })
      await x.service.submitRecordReedit({ ...target, newText: '新正文', expectedVersion: 7, attachments: [] })
      await vi.waitFor(async () => expect((await x.service.recordReeditSubmissions('source'))[0]?.state).toBe('committed'))
      expect(x.writes).toHaveLength(1)
      expect(x.writes[0]).toMatchObject({ record_uid: 'r1', template_kind: 1, text_content: '新正文',
        content_payload: { media_refs: [background], background_sound_amplitudes: [0.2] } })
      expect(x.files.uploadRefs).not.toHaveBeenCalled()
    } finally { x.service.dispose() }
  })

  it.each(['default_category', 'send_to_self', 'group_chat'] as const)('uses current personal source when re-editing through %s', async kind => {
    const x = await setup({ origin_kind: 4, origin_container_ref: '', source_kind: 1 })
    vi.spyOn(x.sourceReader, 'openSourceRef').mockResolvedValue({ version: 1, userId: 42, kind, ownerRef: kind === 'group_chat' ? 'old-group' : 'self', displayName: kind } as never)
    try {
      if (kind === 'group_chat') {
        await expect(x.service.recordReeditEditor('source', 'r1')).rejects.toMatchObject({ code: 'record-reedit-source-mismatch' })
        expect(x.writes).toHaveLength(0)
      } else {
        await x.service.recordReeditEditor('source', 'r1')
        const context = await x.service.prepareRecordReedit({ ...target, expectedVersion: 7, newText: '仍可编辑' })
        await x.service.commitRecordReedit(context)
        expect(x.writes).toHaveLength(1)
        expect(x.writes[0].text_content).toBe('仍可编辑')
      }
    } finally { x.service.dispose() }
  })

  it.each(['ui', 'tool'] as const)('preserves Markdown whitespace while %s replaces attachments', async entry => {
    const text = '    code\n'
    const x = await setup({ text_content: text,
      content_payload: { payload_kind: 2, schema_version: 1, text_format: 'markdown', text_state: 1,
        media_refs: [media('a'), media('b', 1)] } })
    try {
      const input = { ...target, expectedVersion: 7, attachments: [{ fileAssetUid: 'b' }, { fileRef }] }
      if (entry === 'ui') {
        await x.service.recordReeditEditor('source', 'r1')
        await x.service.submitRecordReedit(input)
        await vi.waitFor(async () => expect((await x.service.recordReeditSubmissions('source'))[0]?.state).toBe('committed'))
      } else {
        const context = await x.service.prepareRecordReedit(input)
        await x.service.commitRecordReedit(context)
      }
      expect(x.writes).toHaveLength(1)
      expect(x.writes[0]).toMatchObject({ text_content: text,
        content_payload: { text_format: 'markdown', media_refs: [{ file_asset_uid: 'b' }, { file_asset_uid: 'new-asset' }] } })
    } finally { x.service.dispose() }
  })

  it('does not treat a Markdown indentation change as the same in-flight candidate', async () => {
    const x = await setup({ content_payload: { payload_kind: 2, schema_version: 1, text_format: 'markdown', text_state: 1,
      media_refs: [media('a'), media('b', 1)] } })
    const gate = new Promise<never>(() => {})
    x.files.uploadRefs.mockImplementationOnce(() => gate)
    try {
      await x.service.recordReeditEditor('source', 'r1')
      const input = { ...target, expectedVersion: 7, newText: 'code', attachments: [{ fileRef }] }
      const receipt = await x.service.submitRecordReedit(input)
      expect((await x.service.submitRecordReedit(input)).submissionId).toBe(receipt.submissionId)
      await expect(x.service.submitRecordReedit({ ...input, newText: '    code\n' }))
        .rejects.toMatchObject({ code: 'record-reedit-in-progress' })
    } finally { x.service.dispose() }
  })

  it.each([false, true])('does not block another Record while rebuilding an editor (rebuild fails: %s)', async fails => {
    const x = await setup()
    const owners = new Map(['r1', 'r2'].map(record_uid => [record_uid, { ...structuredClone(x.core), record_uid } as Record<string, unknown>]))
    let enter!: () => void
    let release!: () => void
    const entered = new Promise<void>(resolve => { enter = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    const read = x.runtime.authenticatedPost.bind(x.runtime)
    vi.spyOn(x.runtime, 'authenticatedPost').mockImplementation(async (path, body) => {
      if (path === '/api/v1/records/detail') {
        if (body.record_uid === 'r1') { enter(); await gate; if (fails) throw new Error('detail unavailable') }
        return { record_core: structuredClone(owners.get(String(body.record_uid))) }
      }
      if (path === '/api/v1/records/update') {
        const owner = owners.get(String(body.record_uid))!
        x.writes.push(structuredClone(body))
        Object.assign(owner, body, { version: Number(owner.version) + 1 })
        return { record_core: structuredClone(owner), revision_uid: 'revision' }
      }
      return read(path, body)
    })
    await x.service.recordReeditEditor('source', 'r2')
    const input = { sourceRef: 'source', expectedVersion: 7, newText: '修改', attachments: [] }
    const first = x.service.submitRecordReedit({ ...input, itemUid: 'r1' }).catch(error => error)
    await entered
    let secondItemUid: string | undefined
    const second = x.service.submitRecordReedit({ ...input, itemUid: 'r2' }).then(value => { secondItemUid = value.itemUid; return value })
    try {
      await vi.waitFor(() => expect(secondItemUid).toBe('r2'), { timeout: 500 })
      expect(x.writes.filter(body => body.record_uid === 'r1')).toHaveLength(0)
    } finally {
      release()
      await Promise.allSettled([first, second])
      x.service.dispose()
    }
  })

  it('rebuilds an evicted editor and keeps its saved baseline for later submission', async () => {
    const x = await setup()
    await x.service.recordReeditEditor('source', 'r1')
    const old = await x.service.saveRecordReeditDraft({ ...target, newText: '淘汰前的草稿', expectedVersion: 7, attachments: [] })
    for (let index = 0; index < 100; index++) await x.service.recordReeditEditor('source-' + index, 'r1')
    const reads = vi.spyOn(x.runtime, 'authenticatedPost')
    try {
      const saved = await x.service.saveRecordReeditDraft({ ...target, newText: '淘汰后继续修改', expectedVersion: 7,
        expectedDraftRevision: old.draftRevision, attachments: [{ fileAssetUid: 'b' }] })
      expect(reads.mock.calls.filter(([path]) => path === '/api/v1/records/detail')).toHaveLength(1)
      await x.service.saveRecordReeditDraft({ ...target, newText: '淘汰后继续修改', expectedVersion: 7,
        expectedDraftRevision: saved.draftRevision, attachments: [{ fileAssetUid: 'b' }] })
      expect(reads.mock.calls.filter(([path]) => path === '/api/v1/records/detail')).toHaveLength(1)
      expect(x.writes).toHaveLength(0)
    } finally { x.service.dispose() }
  })

  it.each(['permission', 'account'] as const)('rejects a rebuilt editor after its %s changes', async changed => {
    const x = await setup()
    await x.service.recordReeditEditor('source', 'r1')
    const old = await x.service.saveRecordReeditDraft({ ...target, newText: '不得丢失的旧草稿', expectedVersion: 7, attachments: [] })
    x.service.dispose()
    const read = x.runtime.authenticatedPost.bind(x.runtime)
    vi.spyOn(x.runtime, 'authenticatedPost').mockImplementation(async (path, body) => {
      const value = await read(path, body)
      if (path === '/api/v1/records/detail' && changed === 'account') x.switchAccount()
      return value
    })
    if (changed === 'permission') x.core.owner_user_id = 99
    const restarted = x.restart(true)
    try {
      await expect(restarted.saveRecordReeditDraft({ ...target, newText: '禁止写入', expectedVersion: 7, expectedDraftRevision: old.draftRevision,
        attachments: [] })).rejects.toMatchObject({ code: changed === 'permission' ? 'record-reedit-not-editable' : 'record-reedit-account-changed' })
      expect((await new ArkmeStateStore(x.root).getRecordReeditDraft(42, old.sourceIdentityKey, 'r1'))?.textContent).toBe('不得丢失的旧草稿')
      expect(x.writes).toHaveLength(0)
    } finally { restarted.dispose() }
  })

  it.each(['save', 'submit'] as const)('rebuilds an expired editor context for %s without losing its candidate', async action => {
    const x = await setup()
    await x.service.recordReeditEditor('source', 'r1')
    const old = await x.service.saveRecordReeditDraft({ ...target, newText: '旧草稿', expectedVersion: 7, attachments: [{ fileAssetUid: 'a' }] })
    x.service.dispose()
    const restarted = x.restart(true)
    try {
      const input = { ...target, newText: '恢复后的新候选', expectedVersion: 7, expectedDraftRevision: old.draftRevision,
        attachments: [{ fileAssetUid: 'b' }, { fileRef }] }
      if (action === 'save') {
        const saved = await restarted.saveRecordReeditDraft(input)
        const draft = await new ArkmeStateStore(x.root).getRecordReeditDraft(42, saved.sourceIdentityKey, 'r1')
        expect(draft).toMatchObject({ textContent: input.newText, attachments: input.attachments, baseVersion: 7 })
        expect(x.writes).toHaveLength(0)
      } else {
        const accepted = await restarted.submitRecordReedit(input)
        expect(accepted.textContent).toBe(input.newText)
        expect(accepted.attachments).toHaveLength(2)
        await vi.waitFor(async () => expect((await restarted.recordReeditSubmissions('source'))[0]?.state).toBe('committed'))
        expect(x.writes).toHaveLength(1)
        expect((x.writes[0]!.content_payload as any).media_refs.map((entry: any) => entry.file_asset_uid)).toEqual(['b', 'new-asset'])
      }
    } finally { restarted.dispose() }
  })

  it.each(['record', 'draft', 'version-missing'] as const)('does not rebase a recovered editor when its %s evidence changed', async changed => {
    const x = await setup()
    await x.service.recordReeditEditor('source', 'r1')
    const old = await x.service.saveRecordReeditDraft({ ...target, newText: '保留的旧草稿', expectedVersion: 7, attachments: [] })
    if (changed === 'record') x.core.version = 8
    if (changed === 'draft') await x.service.saveRecordReeditDraft({ ...target, newText: '其他入口的新草稿', expectedVersion: 7, expectedDraftRevision: old.draftRevision, attachments: [] })
    x.service.dispose()
    const restarted = x.restart(true)
    try {
      await expect(restarted.saveRecordReeditDraft({ ...target, newText: '不得覆盖', expectedDraftRevision: old.draftRevision,
        ...(changed === 'version-missing' ? {} : { expectedVersion: 7 }) }))
        .rejects.toMatchObject({ code: changed === 'record' ? 'record-reedit-conflict'
          : changed === 'draft' ? 'record-reedit-draft-changed' : 'record-reedit-version-invalid' })
      const draft = await new ArkmeStateStore(x.root).getRecordReeditDraft(42, old.sourceIdentityKey, 'r1')
      expect(draft?.textContent).toBe(changed === 'draft' ? '其他入口的新草稿' : '保留的旧草稿')
      expect(x.writes).toHaveLength(0)
    } finally { restarted.dispose() }
  })

  it.each([undefined, 'references'] as const)('hands local attachment ownership through real draft, commit, acknowledgement and restart: %s', async retention => {
    const x = await setup()
    const ports: FileTransferPorts = {
      currentUser: async () => 42,
      retainedFileRefs: userId => x.stateStore.recordReeditFileRefs(userId),
      validateSource: async () => {},
      upload: async () => asset,
      send: async () => { throw new Error('editing must not send a new message') },
      fetchMedia: async () => { throw new Error('unexpected media download') },
    }
    const directory = join(x.root, 'files')
    const owner = new FileTransfers(directory, ports, 1000)
    Object.assign(x.files, { files: owner.files.bind(owner), readLocal: owner.readLocal.bind(owner), uploadRefs: owner.uploadRefs.bind(owner), withReferences: owner.withReferences.bind(owner) })
    const path = join(x.root, 'new.png')
    await writeFile(path, 'image')
    const file = await owner.stage(path, { fileName: 'new.png', mimeType: 'image/png', size: 5 }, 42, retention)
    await x.service.recordReeditEditor('source', 'r1')
    await x.service.submitRecordReedit({ ...target, newText: '新增附件', expectedVersion: 7, attachments: [{ fileRef: file.fileRef }] })
    await vi.waitFor(async () => expect((await x.service.recordReeditSubmissions('source'))[0]?.state).toBe('committed'))
    const job = (await x.service.recordReeditSubmissions('source'))[0]!
    expect(await x.stateStore.recordReeditFileRefs(42)).toContain(file.fileRef)
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 30 * 24 * 3600_000)
    try {
      await owner.stageBytes('YQ==', { fileName: 'before.pdf', mimeType: 'application/pdf' })
      await expect(owner.readLocal(file.fileRef)).resolves.toMatchObject({ file })
      await x.service.acknowledgeRecordReeditSubmission('source', job.submissionId, job.result!.version)
      expect(await x.stateStore.recordReeditFileRefs(42)).toEqual([])
      const restarted = new FileTransfers(directory, ports, 1000)
      await restarted.stageBytes('Yg==', { fileName: 'after.pdf', mimeType: 'application/pdf' })
      if (retention === 'references') await expect(restarted.readLocal(file.fileRef)).rejects.toMatchObject({ code: 'file-ref-invalid' })
      else await expect(restarted.readLocal(file.fileRef)).resolves.toMatchObject({ file })
      expect(await restarted.tasks()).toEqual([])
      expect(x.writes).toHaveLength(1)
      expect(JSON.stringify(x.writes)).not.toContain(file.fileRef)
    } finally { clock.mockRestore(); x.service.dispose(); await owner.settled() }
  })

  it('preserves missing owned files while saving text, and rejects an invalid new file without overwriting that draft', async () => {
    const x = await setup()
    const owner = new FileTransfers(join(x.root, 'files'), {
      currentUser: async () => 42, retainedFileRefs: userId => x.stateStore.recordReeditFileRefs(userId),
      validateSource: async () => {}, upload: async () => asset,
      send: async () => { throw new Error('unexpected send') }, fetchMedia: async () => { throw new Error('unexpected download') },
    }, 1000)
    Object.assign(x.files, { files: owner.files.bind(owner), readLocal: owner.readLocal.bind(owner), uploadRefs: owner.uploadRefs.bind(owner), withReferences: owner.withReferences.bind(owner) })
    const file = await owner.stageBytes('YQ==', { fileName: 'a.pdf', mimeType: 'application/pdf' })
    await x.service.recordReeditEditor('source', 'r1')
    const prepared = await x.service.saveRecordReeditDraft({ ...target, expectedVersion: 7, attachments: [{ fileRef: file.fileRef }] })
    await rm((await owner.readLocal(file.fileRef)).path)
    await x.service.saveRecordReeditDraft({ ...target, newText: '保留我的正文', expectedDraftRevision: prepared.draftRevision })
    await expect(x.service.saveRecordReeditDraft({ ...target, newText: '不能覆盖', expectedVersion: 7, attachments: [{ fileRef }] })).rejects.toMatchObject({ code: 'file-ref-invalid' })
    const draft = await x.stateStore.getRecordReeditDraft(42, prepared.sourceIdentityKey, 'r1')
    expect(draft?.textContent).toBe('保留我的正文')
    expect(draft?.attachments).toEqual([{ fileRef: file.fileRef }])
    expect(x.writes).toEqual([])
    x.service.dispose()
  })

  it('does not register a submission referencing a file removed after draft preparation', async () => {
    const x = await setup()
    const owner = new FileTransfers(join(x.root, 'files'), {
      currentUser: async () => 42, retainedFileRefs: userId => x.stateStore.recordReeditFileRefs(userId),
      validateSource: async () => {}, upload: async () => asset,
      send: async () => { throw new Error('unexpected send') }, fetchMedia: async () => { throw new Error('unexpected download') },
    }, 1000)
    Object.assign(x.files, { files: owner.files.bind(owner), readLocal: owner.readLocal.bind(owner), uploadRefs: owner.uploadRefs.bind(owner), withReferences: owner.withReferences.bind(owner) })
    const file = await owner.stageBytes('YQ==', { fileName: 'a.pdf', mimeType: 'application/pdf' })
    await x.service.recordReeditEditor('source', 'r1')
    const prepared = await x.service.saveRecordReeditDraft({ ...target, expectedVersion: 7, attachments: [{ fileRef: file.fileRef }] })
    x.files.files = vi.fn(async () => {
      const files = await owner.files()
      const draft = await x.stateStore.getRecordReeditDraft(42, prepared.sourceIdentityKey, 'r1')
      expect(await x.stateStore.discardRecordReeditCandidate(42, prepared.sourceIdentityKey, 'r1', draft!.draftRevision)).toBe(true)
      await owner.remove(file.fileRef)
      return files as typeof localFile[]
    })
    await expect(x.service.submitRecordReedit({ ...target, expectedVersion: 7, attachments: [{ fileRef: file.fileRef }] })).rejects.toMatchObject({ code: 'file-ref-invalid' })
    expect(await x.stateStore.listRecordReeditSubmissions(42)).toEqual([])
    expect(x.writes).toEqual([])
    x.service.dispose()
  })
  it.each(['ui', 'tool'].flatMap(entry => [false, true].map(withImage => ({ entry, withImage }))))('retains main voice across $entry submission and state reload, with image: $withImage', async ({ entry, withImage }) => {
    const voice = { source_file_asset_uid: 'voice', duration_millis: 1200, transcription_state: 2 }
    const kind = withImage ? 4 : 3
    const x = await setup({ template_kind: kind, content_payload: { payload_kind: kind, schema_version: 1, text_state: 2, voice, media_refs: withImage ? [media('a')] : [] } })
    x.readMedia.mockResolvedValue({ items: [{ record_uid: 'r1', items: [
      { file_asset_uid: 'voice', file_name: 'voice.m4a', file_kind: 3, mime_type: 'audio/mp4', size: 20,
        preview_url: 'https://example.com/voice.m4a', download_url: 'https://example.com/voice.m4a' },
      ...(withImage ? [{ file_asset_uid: 'a', file_name: 'a.png', file_kind: 1, mime_type: 'image/png', size: 20,
        preview_url: 'https://example.com/a.png', download_url: 'https://example.com/a.png' }] : []),
    ] }] })
    if (entry === 'ui') {
      const editor = await x.service.recordReeditEditor('source', 'r1')
      expect(editor.attachments.map(attachment => attachment.selection.fileAssetUid)).toEqual(withImage ? ['a'] : [])
      expect(editor).toMatchObject({ hasVoice: true, voiceBlock: { kind: 'audio', fileAssetUid: 'voice' } })
      const accepted = await x.service.submitRecordReedit({ ...target, newText: '语音文字修正', expectedVersion: 7 })
      expect(accepted).toMatchObject({ voiceBlock: { kind: 'audio', fileAssetUid: 'voice' } })
    } else {
      const context = await x.service.prepareRecordReedit({ ...target, newText: '语音文字修正' })
      await x.service.commitRecordReedit(context)
    }
    await vi.waitFor(async () => expect((await x.service.recordReeditSubmissions('source'))[0]?.state).toBe('committed'))
    x.service.dispose()
    const restarted = x.restart(true)
    const receipt = (await restarted.recordReeditSubmissions('source'))[0]!
    expect(receipt).toMatchObject({ voiceFileAssetUid: 'voice', voiceBlock: { kind: 'audio', fileAssetUid: 'voice' } })
    expect(receipt.attachments.map(attachment => attachment.selection.fileAssetUid)).toEqual(withImage ? ['a'] : [])
    expect(x.writes).toHaveLength(1)
    expect(x.writes[0]).toMatchObject({ content_payload: { voice } })
    const refs = (x.writes[0]!.content_payload as { media_refs?: Array<{ file_asset_uid: string }> }).media_refs ?? []
    expect(refs.map(ref => ref.file_asset_uid)).toEqual(withImage ? ['a'] : [])
    expect(JSON.stringify(x.writes)).not.toContain('voiceBlock')
    expect(JSON.stringify(x.writes)).not.toContain('https://')
    restarted.dispose()
  })

  it.each(['ui', 'tool'] as const)('does not block %s text editing when the main voice display read fails', async entry => {
    const voice = { source_file_asset_uid: 'voice', duration_millis: 1200, transcription_state: 2 }
    const x = await setup({ template_kind: 3, content_payload: { payload_kind: 3, schema_version: 1, text_state: 2, voice } })
    x.readMedia.mockRejectedValue(new Error('media temporarily unavailable'))
    if (entry === 'ui') {
      await x.service.recordReeditEditor('source', 'r1')
      await x.service.submitRecordReedit({ ...target, newText: '修正文字', expectedVersion: 7 })
    } else {
      const context = await x.service.prepareRecordReedit({ ...target, newText: '修正文字' })
      await x.service.commitRecordReedit(context)
    }
    await vi.waitFor(async () => expect((await x.service.recordReeditSubmissions('source'))[0]?.state).toBe('committed'))
    expect(x.writes).toHaveLength(1)
    expect(x.writes[0]).toMatchObject({ text_content: '修正文字', content_payload: { voice } })
    expect((await x.service.recordReeditSubmissions('source'))[0]?.voiceBlock).toBeUndefined()
    x.service.dispose()
  })

  it('does not write after the account changes during Tool display hydration', async () => {
    const x = await setup()
    const context = await x.service.prepareRecordReedit({ ...target, newText: '修正文字' })
    x.readMedia.mockImplementationOnce(async () => { x.switchAccount(); return { items: [] } })
    await expect(x.service.commitRecordReedit(context)).rejects.toMatchObject({ code: 'record-reedit-account-changed' })
    expect(x.writes).toEqual([])
    await expect(x.stateStore.listRecordReeditSubmissions(99)).resolves.toEqual([])
    x.service.dispose()
  })

  it('does not refresh after disposal during the completion notification account check', async () => {
    const notify = vi.fn(async () => {})
    const x = await setup({}, notify)
    const prepared = await x.service.prepareRecordReedit({ ...target, newText: '已保存' })
    const put = x.stateStore.putRecordReeditSubmission.bind(x.stateStore)
    const requireSession = x.runtime.requireSession.bind(x.runtime)
    vi.spyOn(x.stateStore, 'putRecordReeditSubmission').mockImplementation(async (...args) => {
      await put(...args)
      if (args[1].state === 'committed') vi.spyOn(x.runtime, 'requireSession').mockImplementationOnce(async () => {
        const session = await requireSession()
        x.service.dispose()
        return session
      })
    })
    await expect(x.service.commitRecordReedit(prepared)).resolves.toMatchObject({ status: 'committed', version: 8 })
    expect(notify).not.toHaveBeenCalled()
  })

  it('clears a completed UI candidate when Tool preparation only refreshes its cache timestamp', async () => {
    const x = await setup()
    await x.service.recordReeditEditor('source', 'r1')
    let release!: () => void
    x.files.uploadRefs.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { release = resolve })
      return [asset]
    })
    const candidate = { ...target, newText: '同一候选', expectedVersion: 7, attachments: [{ fileRef }] }
    await x.service.submitRecordReedit(candidate)
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    const submitted = (await x.stateStore.listRecordReeditSubmissions(42))[0]!
    const clock = vi.spyOn(Date, 'now').mockReturnValue(submitted.draft.updatedAtMillis + 1000)
    try {
      const repeated = await x.service.prepareRecordReedit(candidate)
      expect(repeated.draftRevision).toBe(submitted.draft.draftRevision)
    } finally { clock.mockRestore(); release() }
    await vi.waitFor(async () => expect((await x.service.recordReeditSubmissions('source'))[0]?.state).toBe('committed'))
    expect(await x.stateStore.getRecordReeditDraft(42, submitted.context.sourceIdentityKey, 'r1')).toBeUndefined()
    const next = await x.service.prepareRecordReedit({ ...target, newText: '下一次' })
    expect(next.baseVersion).toBe(8)
    await expect(x.service.commitRecordReedit(next)).resolves.toMatchObject({ status: 'committed', version: 9 })
    expect(x.update).toHaveBeenCalledTimes(2)
  })

  it('settles the previous Tool completion before deriving a subsequent candidate baseline', async () => {
    const x = await setup()
    const first = await x.service.prepareRecordReedit({ ...target, newText: '第一次', expectedVersion: 7, attachments: [] })
    const put = x.stateStore.putRecordReeditSubmission.bind(x.stateStore)
    let failOnce = true
    vi.spyOn(x.stateStore, 'putRecordReeditSubmission').mockImplementation(async (...args) => {
      if (args[1].state === 'committed' && failOnce) { failOnce = false; throw new Error('one local failure') }
      await put(...args)
    })
    await x.service.commitRecordReedit(first)
    const second = await x.service.prepareRecordReedit({ ...target, newText: '第二次' })
    expect(second.baseVersion).toBe(8)
    await expect(x.service.commitRecordReedit(second)).resolves.toMatchObject({ status: 'committed', version: 9 })
    expect(x.update).toHaveBeenCalledTimes(2)
  })
  it('settles a known completed edit before reopening its editor instead of restoring an obsolete draft', async () => {
    const x = await setup()
    const prepared = await x.service.prepareRecordReedit({ ...target, newText: '已经保存' })
    const put = x.stateStore.putRecordReeditSubmission.bind(x.stateStore)
    let failOnce = true
    vi.spyOn(x.stateStore, 'putRecordReeditSubmission').mockImplementation(async (...args) => {
      if (args[1].state === 'committed' && failOnce) { failOnce = false; throw new Error('one local failure') }
      await put(...args)
    })
    await x.service.commitRecordReedit(prepared)
    const editor = await x.service.recordReeditEditor('source', 'r1')
    expect(editor.version).toBe(8)
    expect(editor.draft).toBeUndefined()
    expect(x.update).toHaveBeenCalledOnce()
  })
  it.each([false, true])('notifies once through the real Tool facade without reversing success if notification rejects: %s', async rejects => {
    const invalidate = vi.fn(async () => { if (rejects) throw new Error('projection unavailable') })
    const x = await setup({}, invalidate)
    const prepared = await x.service.prepareRecordReedit({ ...target, newText: '确认保存' })
    await ArkmeService.prototype.commitRecordReedit.call({ record: x.service, realtime: { invalidateRecordProjection: invalidate } } as never, prepared)
    expect(invalidate).toHaveBeenCalledOnce()
    expect(x.update).toHaveBeenCalledOnce()
  })

  it('keeps a known success while local completion is unavailable and retries only local work', async () => {
    const notify = vi.fn(async () => {})
    const x = await setup({}, notify)
    const prepared = await x.service.prepareRecordReedit({ ...target, newText: '已成功版本8' })
    let unavailable = true
    const put = x.stateStore.putRecordReeditSubmission.bind(x.stateStore)
    vi.spyOn(x.stateStore, 'putRecordReeditSubmission').mockImplementation(async (...args) => {
      if (args[1].state === 'committed' && unavailable) throw new Error('local completion unavailable')
      return await put(...args)
    })
    await expect(x.service.commitRecordReedit(prepared)).resolves.toMatchObject({ status: 'committed', version: 8 })
    expect((await x.service.recordReeditSubmissions('source'))[0]).toMatchObject({ state: 'committed', result: { version: 8 } })
    expect((await x.stateStore.listRecordReeditSubmissions(42))[0]?.state).toBe('committing')
    expect((await x.stateStore.getRecordReeditDraft(42, prepared.sourceIdentityKey, 'r1'))?.textContent).toBe('已成功版本8')
    Object.assign(x.core, { version: 9, text_content: '另一端之后的版本9' })
    unavailable = false
    await x.service.resumeRecordReeditSubmissions('source', true)
    await vi.waitFor(async () => expect((await x.stateStore.listRecordReeditSubmissions(42))[0]).toMatchObject({ state: 'committed', result: { version: 8 } }))
    expect(await x.stateStore.getRecordReeditDraft(42, prepared.sourceIdentityKey, 'r1')).toBeUndefined()
    expect(x.update).toHaveBeenCalledOnce()
    expect(notify).toHaveBeenCalledOnce()
  })
  it('rejects an old Tool confirmation after a draft is discarded and recreated', async () => {
    const x = await setup()
    const first = await x.service.prepareRecordReedit({ ...target, newText: 'A'.repeat(170) + '确认内容' })
    const discard = await x.service.prepareDiscardRecordReeditDraft('source', 'r1')
    await x.service.discardRecordReeditDraft(discard)
    await x.service.prepareRecordReedit({ ...target, newText: 'A'.repeat(170) + '未确认新内容' })
    await expect(x.service.commitRecordReedit(first)).rejects.toMatchObject({ code: 'record-reedit-draft-changed' })
    await expect(x.service.discardRecordReeditDraft(discard)).rejects.toMatchObject({ code: 'record-reedit-draft-changed' })
    expect(x.update).not.toHaveBeenCalled()
  })

  it('rejects a deleted-and-recreated draft during the Tool attachment upload window', async () => {
    const x = await setup()
    const first = await x.service.prepareRecordReedit({ ...target, expectedVersion: 7, newText: '已确认', attachments: [{ fileRef }] })
    x.files.uploadRefs.mockImplementationOnce(async () => {
      await x.service.discardRecordReeditDraft(await x.service.prepareDiscardRecordReeditDraft('source', 'r1'))
      await x.service.prepareRecordReedit({ ...target, newText: '重建草稿' })
      return [asset]
    })
    await expect(x.service.commitRecordReedit(first)).rejects.toMatchObject({ code: 'record-reedit-draft-changed' })
    expect(x.update).not.toHaveBeenCalled()
  })

  it('persists a Tool write checkpoint and never resends an unknown update after restart', async () => {
    const x = await setup()
    const prepared = await x.service.prepareRecordReedit({ ...target, newText: '等待核对' })
    x.update.mockImplementation(async () => {
      expect((await new ArkmeStateStore(x.root).listRecordReeditSubmissions(42))[0]?.state).toBe('committing')
      throw new ArkmePluginError('network-failed', '未知', false, 502, { writeOutcomeUnknown: true })
    })
    await expect(x.service.commitRecordReedit(prepared)).rejects.toMatchObject({ code: 'record-reedit-outcome-unknown' })
    await expect(x.restart(true).commitRecordReedit(prepared)).rejects.toMatchObject({ code: 'record-reedit-in-progress' })
    expect(x.update).toHaveBeenCalledOnce()
    expect((await new ArkmeStateStore(x.root).listRecordReeditSubmissions(42))[0]?.state).toBe('uncertain')
  })

  it('does not write through Tool if its write-ahead receipt cannot be persisted', async () => {
    const x = await setup()
    const prepared = await x.service.prepareRecordReedit({ ...target, newText: '已确认候选' })
    vi.spyOn(x.stateStore, 'putRecordReeditSubmission').mockRejectedValueOnce(new Error('disk unavailable'))
    await expect(x.service.commitRecordReedit(prepared)).rejects.toThrow('disk unavailable')
    expect(x.update).not.toHaveBeenCalled()
    expect((await new ArkmeStateStore(x.root).listRecordReeditSubmissions(42))).toHaveLength(0)
  })

  it('rechecks the confirmed Tool draft after checkpoint persistence', async () => {
    const x = await setup()
    const prepared = await x.service.prepareRecordReedit({ ...target, newText: '确认A' })
    const put = x.stateStore.putRecordReeditSubmission.bind(x.stateStore)
    vi.spyOn(x.stateStore, 'putRecordReeditSubmission').mockImplementation(async (...args) => {
      await put(...args)
      if (args[1].state === 'committing') await x.service.prepareRecordReedit({ ...target, newText: '后续B' })
    })
    await expect(x.service.commitRecordReedit(prepared)).rejects.toMatchObject({ code: 'record-reedit-draft-changed' })
    expect(x.update).not.toHaveBeenCalled()
    expect((await x.service.recordReeditSubmissions('source'))[0]?.state).toBe('failed')
  })

  it('does not write when disposed during the final account lookup', async () => {
    const x = await setup()
    const prepared = await x.service.prepareRecordReedit({ ...target, newText: '确认A' })
    let checkpointed = false
    const put = x.stateStore.putRecordReeditSubmission.bind(x.stateStore)
    vi.spyOn(x.stateStore, 'putRecordReeditSubmission').mockImplementation(async (...args) => { await put(...args); checkpointed = true })
    const session = x.runtime.requireSession.bind(x.runtime)
    vi.spyOn(x.runtime, 'requireSession').mockImplementation(async () => {
      const result = await session()
      if (checkpointed) x.service.dispose()
      return result
    })
    await expect(x.service.commitRecordReedit(prepared)).rejects.toMatchObject({ code: 'record-reedit-unavailable' })
    expect(x.update).not.toHaveBeenCalled()
  })

  it('does not let a disposed writer erase a new runtime draft when its response arrives late', async () => {
    const x = await setup()
    const prepared = await x.service.prepareRecordReedit({ ...target, newText: '确认A' })
    const draft = (await x.stateStore.getRecordReeditDraft(42, prepared.sourceIdentityKey, 'r1'))!
    const update = x.update.getMockImplementation()!
    x.update.mockImplementationOnce(async body => {
      x.service.dispose()
      await new ArkmeStateStore(x.root).putRecordReeditDraft(42, { ...draft, textContent: '新运行态草稿' })
      return await update(body)
    })
    await expect(x.service.commitRecordReedit(prepared)).resolves.toMatchObject({ status: 'committed' })
    const fresh = new ArkmeStateStore(x.root)
    expect((await fresh.getRecordReeditDraft(42, prepared.sourceIdentityKey, 'r1'))?.textContent).toBe('新运行态草稿')
    expect((await fresh.listRecordReeditSubmissions(42))[0]?.state).toBe('committing')
  })

  it('does not save a late prepared draft over a new runtime after disposal', async () => {
    const x = await setup()
    const prepared = await x.service.prepareRecordReedit({ ...target, newText: '原草稿' })
    const draft = (await x.stateStore.getRecordReeditDraft(42, prepared.sourceIdentityKey, 'r1'))!
    const session = x.runtime.requireSession.bind(x.runtime)
    let calls = 0
    vi.spyOn(x.runtime, 'requireSession').mockImplementation(async () => {
      const result = await session()
      if (++calls === 2) {
        x.service.dispose()
        await new ArkmeStateStore(x.root).putRecordReeditDraft(42, { ...draft, textContent: '新运行态草稿' })
      }
      return result
    })
    await expect(x.service.prepareRecordReedit({ ...target, newText: '迟到候选' })).rejects.toMatchObject({ code: 'record-reedit-unavailable' })
    expect((await new ArkmeStateStore(x.root).getRecordReeditDraft(42, prepared.sourceIdentityKey, 'r1'))?.textContent).toBe('新运行态草稿')
  })

  it('reconciles a Tool write after final receipt persistence fails without replaying it', async () => {
    const x = await setup()
    const prepared = await x.service.prepareRecordReedit({ ...target, newText: '已确认候选' })
    const put = x.stateStore.putRecordReeditSubmission.bind(x.stateStore)
    vi.spyOn(x.stateStore, 'putRecordReeditSubmission').mockImplementation(async (...args) => {
      if (args[1].state === 'committed') throw new Error('disk unavailable')
      return await put(...args)
    })
    await expect(x.service.commitRecordReedit(prepared)).resolves.toMatchObject({ status: 'committed' })
    x.service.dispose()
    const recovered = x.restart(true)
    expect((await recovered.recordReeditSubmissions('source'))[0]?.state).toBe('committing')
    await recovered.resumeRecordReeditSubmissions('source', true)
    await vi.waitFor(async () => expect((await recovered.recordReeditSubmissions('source'))[0]?.state).toBe('committed'))
    expect(x.update).toHaveBeenCalledOnce()
  })

  it.each(['dispose', 'account'])('does not issue the Tool write after %s during checkpoint persistence', async kind => {
    const x = await setup()
    const prepared = await x.service.prepareRecordReedit({ ...target, newText: '已确认候选' })
    const put = x.stateStore.putRecordReeditSubmission.bind(x.stateStore)
    vi.spyOn(x.stateStore, 'putRecordReeditSubmission').mockImplementation(async (...args) => {
      await put(...args)
      if (args[1].state === 'committing') {
        if (kind === 'dispose') x.service.dispose()
        else x.switchAccount()
      }
    })
    await expect(x.service.commitRecordReedit(prepared)).rejects.toMatchObject({ code: kind === 'dispose' ? 'record-reedit-unavailable' : 'record-reedit-account-changed' })
    expect(x.update).not.toHaveBeenCalled()
  })

  it('reports a confirmed Tool write as committed while preserving a newer draft created after that write', async () => {
    const x = await setup()
    const prepared = await x.service.prepareRecordReedit({ ...target, newText: '已确认候选' })
    const update = x.update.getMockImplementation()!
    x.update.mockImplementationOnce(async body => {
      const result = await update(body)
      await x.service.prepareRecordReedit({ ...target, newText: '下一份草稿', expectedVersion: 8 })
      return result
    })
    await expect(x.service.commitRecordReedit(prepared)).resolves.toMatchObject({ status: 'committed', version: 8 })
    expect((await x.service.recordReeditEditor('source', 'r1')).draft?.textContent).toBe('下一份草稿')
    expect(x.writes).toHaveLength(1)
  })

  it('preserves hashtag evidence when editing only attachments', async () => {
    const hashTags = [{ tag: '主题', start_index: 0, length: 3 }]
    const x = await setup({ text_content: '#主题', content_payload: { payload_kind: 2, schema_version: 1, text_state: 1, media_refs: [media('a')], hash_tags: hashTags } })
    const prepared = await x.service.prepareRecordReedit({ ...target, expectedVersion: 7, attachments: [] })
    await x.service.commitRecordReedit(prepared)
    expect(x.writes[0]?.content_payload).toMatchObject({ hash_tags: hashTags })
  })

  it('rebuilds hashtag offsets from changed text and clears removed tags', async () => {
    const x = await setup({ template_kind: 1, content_payload: undefined })
    const prepared = await x.service.prepareRecordReedit({ ...target, newText: '😀 #新标签' })
    await x.service.commitRecordReedit(prepared)
    expect(x.writes[0]?.content_payload).toMatchObject({ hash_tags: [{ tag: '新标签', start_index: 3, length: 4 }] })
    const second = await x.service.prepareRecordReedit({ ...target, newText: '不再有标签' })
    await x.service.commitRecordReedit(second)
    expect((x.writes[1]?.content_payload as Record<string, unknown>).hash_tags).toBeUndefined()
  })

  it('does not let the Tool flatten a forward card into an ordinary text record', async () => {
    const x = await setup({ template_kind: 1, content_payload: { payload_kind: 1, schema_version: 1, text_state: 1, forward_records: { source_type: 'record', source_record_uids: ['other-record'] } } })
    await expect(x.service.prepareRecordReedit({ ...target, newText: '修改卡片' })).rejects.toMatchObject({ code: 'record-reedit-shape-unsupported' })
    expect(x.writes).toHaveLength(0)
    expect(x.files.uploadRefs).not.toHaveBeenCalled()
  })

  it('never starts a phantom submission after local persistence fails', async () => {
    const x = await setup()
    await x.service.recordReeditEditor('source', 'r1')
    const context = await x.service.saveRecordReeditDraft({ ...target, expectedVersion: 7, attachments: [] })
    const draft = (await x.stateStore.getRecordReeditDraft(42, context.sourceIdentityKey, 'r1'))!
    await rename(join(x.root, 'state.json'), join(x.root, 'state.backup'))
    await mkdir(join(x.root, 'state.json'))
    await expect(x.stateStore.putRecordReeditSubmission(42, {
      submissionId: 'test', state: 'pending', context, draft, itemUid: 'r1', title: '', textContent: draft.textContent, attachments: [],
    })).rejects.toBeDefined()
    expect(await x.stateStore.listRecordReeditSubmissions(42)).toEqual([])
    expect(x.writes).toHaveLength(0)
  })
  it('serializes concurrent admission for the same Record across renewed source capabilities', async () => {
    const x = await setup()
    await x.service.recordReeditEditor('source', 'r1')
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    x.files.uploadRefs.mockImplementationOnce(async () => { await gate; return [asset] })
    const input = { ...target, newText: '同一份候选', expectedVersion: 7, expectedDraftRevision: 0, attachments: [{ fileRef }] }
    try {
      const receipts = await Promise.all([
        x.service.submitRecordReedit(input),
        x.service.submitRecordReedit({ ...input, sourceRef: 'renewed-source' }),
      ])
      expect(receipts[0]!.submissionId).toBe(receipts[1]!.submissionId)
      expect(await x.stateStore.listRecordReeditSubmissions(42)).toHaveLength(1)
      release()
      await vi.waitFor(async () => expect((await x.service.recordReeditSubmissions('source'))[0]?.state).toBe('committed'))
      expect(x.writes).toHaveLength(1)
    } finally { release(); x.service.dispose() }
  })

  it('accepts a later valid candidate after the same Record admission failed', async () => {
    const x = await setup()
    await x.service.recordReeditEditor('source', 'r1')
    try {
      await expect(x.service.submitRecordReedit({ ...target, newText: '过期候选', expectedVersion: 6, attachments: [] }))
        .rejects.toMatchObject({ code: 'record-reedit-conflict' })
      const receipt = await x.service.submitRecordReedit({ ...target, newText: '新的候选', expectedVersion: 7, attachments: [] })
      expect(receipt.textContent).toBe('新的候选')
      await vi.waitFor(async () => expect((await x.service.recordReeditSubmissions('source'))[0]?.state).toBe('committed'))
      expect(x.writes).toHaveLength(1)
    } finally { x.service.dispose() }
  })

  it('deduplicates admission and does not let another submit mutate the in-flight snapshot', async () => {
    const x = await setup()
    await x.service.recordReeditEditor('source', 'r1')
    let release!: () => void
    x.files.uploadRefs.mockImplementationOnce(async () => { await new Promise<void>(resolve => { release = resolve }); return [asset] })
    const input = { ...target, newText: '第一份', expectedVersion: 7, expectedDraftRevision: 0, attachments: [{ fileRef }] }
    const first = await x.service.submitRecordReedit(input)
    expect((await x.service.submitRecordReedit(input)).submissionId).toBe(first.submissionId)
    await expect(x.service.submitRecordReedit({ ...input, newText: '第二份' })).rejects.toMatchObject({ code: 'record-reedit-in-progress' })
    const saved = (await x.stateStore.listRecordReeditSubmissions(42))[0]!
    expect((await x.stateStore.getRecordReeditDraft(42, saved.context.sourceIdentityKey, 'r1'))?.textContent).toBe('第一份')
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    release()
    await vi.waitFor(async () => expect((await x.service.recordReeditSubmissions('source'))[0]?.state).toBe('committed'))
    expect(x.writes).toHaveLength(1)
  })

  it('reconciles an interrupted remote write after restart without sending it twice', async () => {
    const x = await setup()
    await x.service.recordReeditEditor('source', 'r1')
    await x.service.submitRecordReedit({ ...target, newText: '保存结果', expectedVersion: 7, attachments: [] })
    await vi.waitFor(async () => expect((await x.service.recordReeditSubmissions('source'))[0]?.state).toBe('committed'))
    const job = (await x.stateStore.listRecordReeditSubmissions(42))[0]!
    job.state = 'committing'; delete job.result
    await x.stateStore.putRecordReeditSubmission(42, job, job.submissionId)
    const restarted = x.restart()
    await restarted.resumeRecordReeditSubmissions('source')
    await vi.waitFor(async () => expect((await restarted.recordReeditSubmissions('source'))[0]?.state).toBe('committed'))
    expect(x.writes).toHaveLength(1)
  })

  it('keeps an interrupted write uncertain when the owner still shows the old version', async () => {
    const x = await setup()
    await x.service.recordReeditEditor('source', 'r1')
    x.files.uploadRefs.mockRejectedValueOnce(new Error('offline'))
    await x.service.submitRecordReedit({ ...target, expectedVersion: 7, attachments: [{ fileRef }] })
    await vi.waitFor(async () => expect((await x.service.recordReeditSubmissions('source'))[0]?.state).toBe('failed'))
    const job = (await x.stateStore.listRecordReeditSubmissions(42))[0]!
    job.state = 'committing'; job.expectedCommittedFingerprint = 'a'.repeat(64)
    await x.stateStore.putRecordReeditSubmission(42, job, job.submissionId)
    const restarted = x.restart()
    await restarted.resumeRecordReeditSubmissions('source')
    await vi.waitFor(async () => expect((await restarted.recordReeditSubmissions('source'))[0]?.state).toBe('uncertain'))
    expect(x.writes).toHaveLength(0)
  })

  it('unblocks recovery when reconciliation proves the owner has a conflicting newer version', async () => {
    const x = await setup()
    await x.service.recordReeditEditor('source', 'r1')
    x.files.uploadRefs.mockRejectedValueOnce(new Error('offline'))
    await x.service.submitRecordReedit({ ...target, newText: '保留候选', expectedVersion: 7, attachments: [{ fileRef }] })
    await vi.waitFor(async () => expect((await x.service.recordReeditSubmissions('source'))[0]?.state).toBe('failed'))
    const job = (await x.stateStore.listRecordReeditSubmissions(42))[0]!
    job.state = 'committing'; job.expectedCommittedFingerprint = 'a'.repeat(64)
    await x.stateStore.putRecordReeditSubmission(42, job, job.submissionId)
    x.core.version = 8
    x.core.text_content = '另一端的新正文'
    const restarted = x.restart()
    await restarted.resumeRecordReeditSubmissions('source')
    await vi.waitFor(async () => expect((await restarted.recordReeditSubmissions('source'))[0]?.state).toBe('failed'))
    expect((await restarted.recordReeditEditor('source', 'r1')).draft?.textContent).toBe('保留候选')
    expect(x.writes).toHaveLength(0)
    const discard = await restarted.prepareDiscardRecordReeditDraft('source', 'r1')
    await expect(restarted.discardRecordReeditDraft(discard)).resolves.toMatchObject({ status: 'discarded' })
    expect(await restarted.recordReeditSubmissions('source')).toEqual([])
  })

  it('recovers a failed submission candidate even after its editable draft was removed', async () => {
    const x = await setup()
    await x.service.recordReeditEditor('source', 'r1')
    x.files.uploadRefs.mockRejectedValueOnce(new Error('offline'))
    await x.service.submitRecordReedit({ ...target, newText: '不能丢', expectedVersion: 7, attachments: [{ fileRef }] })
    await vi.waitFor(async () => expect((await x.service.recordReeditSubmissions('source'))[0]?.state).toBe('failed'))
    const job = (await x.stateStore.listRecordReeditSubmissions(42))[0]!
    await x.stateStore.removeRecordReeditDraft(42, job.context.sourceIdentityKey, 'r1', job.draft.draftRevision)
    expect((await x.restart().recordReeditEditor('source', 'r1')).draft?.textContent).toBe('不能丢')
  })

  it('does not resurrect a failed candidate after the user explicitly discards it', async () => {
    const x = await setup()
    await x.service.recordReeditEditor('source', 'r1')
    x.files.uploadRefs.mockRejectedValueOnce(new Error('offline'))
    await x.service.submitRecordReedit({ ...target, newText: '放弃这份', expectedVersion: 7, attachments: [{ fileRef }] })
    await vi.waitFor(async () => expect((await x.service.recordReeditSubmissions('source'))[0]?.state).toBe('failed'))
    const discard = await x.service.prepareDiscardRecordReeditDraft('source', 'r1')
    await x.service.discardRecordReeditDraft(discard)
    expect((await x.service.recordReeditEditor('source', 'r1')).draft).toBeUndefined()
    expect(await x.stateStore.recordReeditFileRefs(42)).not.toContain(fileRef)
  })

  it('preserves a newer draft when the accepted submission finishes', async () => {
    const x = await setup()
    await x.service.recordReeditEditor('source', 'r1')
    let release!: () => void
    x.files.uploadRefs.mockImplementationOnce(async () => { await new Promise<void>(resolve => { release = resolve }); return [asset] })
    await x.service.submitRecordReedit({ ...target, newText: '已提交', expectedVersion: 7, attachments: [{ fileRef }] })
    const newer = await x.service.saveRecordReeditDraft({ ...target, newText: '后续草稿', expectedVersion: 7, attachments: [] })
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    release()
    await vi.waitFor(async () => expect((await x.service.recordReeditSubmissions('source'))[0]?.state).toBe('committed'))
    expect(x.writes[0]?.text_content).toBe('已提交')
    expect((await x.stateStore.getRecordReeditDraft(42, newer.sourceIdentityKey, 'r1'))?.textContent).toBe('后续草稿')
  })
  it('completes without coupling the business result to separate draft cleanup', async () => {
    const x = await setup()
    await x.service.recordReeditEditor('source', 'r1')
    const remove = vi.spyOn(x.stateStore, 'removeRecordReeditDraft').mockRejectedValue(new Error('separate cleanup unavailable'))
    await x.service.submitRecordReedit({ ...target, newText: '服务器已成功', expectedVersion: 7, attachments: [] })
    await vi.waitFor(async () => expect((await x.service.recordReeditSubmissions('source'))[0]?.state).toBe('committed'))
    expect(remove).not.toHaveBeenCalled()
    expect(await x.stateStore.getRecordReeditDraft(42, (await x.stateStore.listRecordReeditSubmissions(42))[0]!.context.sourceIdentityKey, 'r1')).toBeUndefined()
    expect(x.writes).toHaveLength(1)
  })
  it('does not let a disposed runtime issue a write after its upload finishes', async () => {
    const x = await setup()
    await x.service.recordReeditEditor('source', 'r1')
    let release!: () => void
    x.files.uploadRefs.mockImplementationOnce(async () => { await new Promise<void>(resolve => { release = resolve }); return [asset] })
    await x.service.submitRecordReedit({ ...target, expectedVersion: 7, attachments: [{ fileRef }] })
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    x.service.dispose()
    release()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(x.writes).toHaveLength(0)
    expect((await x.stateStore.listRecordReeditSubmissions(42))[0]?.state).toBe('pending')
    const restarted = x.restart()
    await restarted.resumeRecordReeditSubmissions('source')
    await vi.waitFor(async () => expect((await restarted.recordReeditSubmissions('source'))[0]?.state).toBe('committed'))
    expect(x.writes).toHaveLength(1)
  })
  it('releases a committed receipt only after its matching projection is acknowledged', async () => {
    const x = await setup()
    await x.service.recordReeditEditor('source', 'r1')
    const accepted = await x.service.submitRecordReedit({ ...target, expectedVersion: 7, attachments: [] })
    await x.service.acknowledgeRecordReeditSubmission('source', accepted.submissionId, 7)
    expect(await x.stateStore.listRecordReeditSubmissions(42)).toHaveLength(1)
    await vi.waitFor(async () => expect((await x.service.recordReeditSubmissions('source'))[0]?.state).toBe('committed'))
    await x.service.acknowledgeRecordReeditSubmission('source', 'wrong-id', 8)
    expect(await x.stateStore.listRecordReeditSubmissions(42)).toHaveLength(1)
    await x.service.acknowledgeRecordReeditSubmission('source', accepted.submissionId, 8)
    expect(await x.stateStore.listRecordReeditSubmissions(42)).toEqual([])
  })
  it('does not clear a newly recreated draft during recovery of an older commit', async () => {
    const x = await setup()
    await x.service.recordReeditEditor('source', 'r1')
    await x.service.submitRecordReedit({ ...target, newText: '旧提交', expectedVersion: 7, attachments: [] })
    await vi.waitFor(async () => expect((await x.service.recordReeditSubmissions('source'))[0]?.state).toBe('committed'))
    const job = (await x.stateStore.listRecordReeditSubmissions(42))[0]!
    job.state = 'committing'; delete job.result
    await x.stateStore.putRecordReeditSubmission(42, job, job.submissionId)
    const newer = await x.stateStore.putRecordReeditDraft(42, { ...job.draft, textContent: '新的未提交草稿', baseVersion: 8 }, 0)
    expect(newer.draftRevision).toBeGreaterThan(1)
    const restarted = x.restart()
    await restarted.resumeRecordReeditSubmissions('source')
    await vi.waitFor(async () => expect((await restarted.recordReeditSubmissions('source'))[0]?.state).toBe('committed'))
    expect((await x.stateStore.getRecordReeditDraft(42, job.context.sourceIdentityKey, 'r1'))?.textContent).toBe('新的未提交草稿')
  })
  it('does not allow a Tool commit to race an admitted UI edit of the same record', async () => {
    const x = await setup()
    await x.service.recordReeditEditor('source', 'r1')
    const input = { ...target, expectedVersion: 7, attachments: [{ fileRef }] }
    const tool = await x.service.prepareRecordReedit(input)
    let release!: () => void
    x.files.uploadRefs.mockImplementationOnce(async () => { await new Promise<void>(resolve => { release = resolve }); return [asset] })
    await x.service.submitRecordReedit(input)
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    await expect(x.service.commitRecordReedit(tool)).rejects.toMatchObject({ code: 'record-reedit-in-progress' })
    expect(x.writes).toHaveLength(0)
    release()
    await vi.waitFor(async () => expect((await x.service.recordReeditSubmissions('source'))[0]?.state).toBe('committed'))
  })

  it('accepts a durable local submission before uploading or saving remotely', async () => {
    const x = await setup()
    await x.service.recordReeditEditor('source', 'r1')
    let release!: () => void
    x.files.uploadRefs.mockImplementationOnce(async () => { await new Promise<void>(resolve => { release = resolve }); return [asset] })
    const accepted = await x.service.submitRecordReedit({ ...target, newText: '立即显示', expectedVersion: 7, attachments: [{ fileRef }] })
    expect(accepted).toMatchObject({ state: 'pending', textContent: '立即显示', itemUid: 'r1' })
    expect(x.writes).toHaveLength(0)
    const restored = new ArkmeStateStore(x.root)
    expect((await restored.listRecordReeditSubmissions(42))[0]?.draft.textContent).toBe('立即显示')
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    release()
    await vi.waitFor(async () => expect((await x.service.recordReeditSubmissions('source'))[0]?.state).toBe('committed'))
    expect(x.writes).toHaveLength(1)
  })

  it('saves UI drafts locally after opening without another owner detail request', async () => {
    const x = await setup()
    await x.service.recordReeditEditor('source', 'r1')
    x.core.version = 8
    const saved = await x.service.saveRecordReeditDraft({ ...target, newText: '离线候选', expectedVersion: 7, attachments: [{ fileAssetUid: 'a' }] })
    expect(saved.baseVersion).toBe(7)
    await expect(x.service.commitRecordReedit(saved)).rejects.toMatchObject({ code: 'record-reedit-conflict' })
    expect(x.writes).toHaveLength(0)
  })

  it('retains failed submissions and their files without blocking other drafts', async () => {
    const x = await setup()
    await x.service.recordReeditEditor('source', 'r1')
    x.files.uploadRefs.mockRejectedValueOnce(new Error('上传失败'))
    const accepted = await x.service.submitRecordReedit({ ...target, expectedVersion: 7, attachments: [{ fileRef }] })
    await vi.waitFor(async () => expect((await x.service.recordReeditSubmissions('source'))[0]?.state).toBe('failed'))
    expect(await x.stateStore.recordReeditFileRefs(42)).toContain(fileRef)
    expect((await x.stateStore.listRecordReeditSubmissions(42))[0]?.submissionId).toBe(accepted.submissionId)
    x.switchAccount()
    expect(await x.stateStore.listRecordReeditSubmissions(99)).toEqual([])
  })

  it.each([false, true])('does not mistake an uncertain attachment upload for an uncertain Record update (background: %s)', async withBackground => {
    const background = withBackground ? [{ ...media('ambient', 1), content_file_role: 4 }] : []
    const x = await setup({ content_payload: { payload_kind: 2, schema_version: 1, text_state: 1, media_refs: [media('a'), ...background] } })
    await x.service.recordReeditEditor('source', 'r1')
    x.files.uploadRefs.mockRejectedValueOnce(new ArkmePluginError('file-upload-unknown', '附件上传结果未知', false, 502, { writeOutcomeUnknown: true }))
    await x.service.submitRecordReedit({ ...target, expectedVersion: 7, attachments: [{ fileRef }] })
    await vi.waitFor(async () => expect((await x.service.recordReeditSubmissions('source'))[0]?.state).toBe('failed'))
    expect(x.update).not.toHaveBeenCalled()
    expect(await x.stateStore.recordReeditFileRefs(42)).toContain(fileRef)
  })

  it('initializes the owner payload when adding the first attachment to an older text record', async () => {
    const x = await setup({ template_kind: 1, content_payload: undefined })
    const p = await x.service.prepareRecordReedit({ ...target, expectedVersion: 7, attachments: [{ fileRef }] })
    await x.service.commitRecordReedit(p)
    expect(x.writes[0]).toMatchObject({ content_payload: { schema_version: 1, text_state: 1, payload_kind: 2 } })
  })
  it('keeps background audio outside editable attachments', async () => {
    const background = { ...media('background', 2), file_name: 'ambient.m4a', duration_sec: 3, content_file_role: 4 }
    const x = await setup({ content_payload: { payload_kind: 2, schema_version: 1, text_state: 1,
      media_refs: [media('a'), media('b', 1), background], background_sound_amplitudes: [0.2, 0.7] } })
    try {
      const editor = await x.service.recordReeditEditor('source', 'r1')
      expect(editor.attachments.map(item => item.selection)).toEqual([{ fileAssetUid: 'a' }, { fileAssetUid: 'b' }])
      expect(editor.hasVoice).toBe(false)
      await expect(x.service.prepareRecordReedit({ ...target, expectedVersion: 7,
        attachments: [{ fileAssetUid: 'background' }] })).rejects.toMatchObject({ code: 'record-reedit-attachment-invalid' })
      const prepared = await x.service.prepareRecordReedit({ ...target, newText: '编辑后的正文', expectedVersion: 7, attachments: [] })
      await x.service.commitRecordReedit(prepared)
      expect(x.writes[0]).toMatchObject({ template_kind: 1, text_content: '编辑后的正文', content_payload: {
        payload_kind: 1, background_sound_amplitudes: [0.2, 0.7], media_refs: [
          { file_asset_uid: 'background', file_name: 'ambient.m4a', duration_sec: 3, content_file_role: 4 },
        ],
      } })
      expect((x.writes[0]!.content_payload as any).media_refs[0]).not.toHaveProperty('binding_type')
      expect(x.files.uploadRefs).not.toHaveBeenCalled()
    } finally { x.service.dispose() }
  })

  it.each(['ui', 'tool'] as const)('preserves multiple background segments while %s replaces ordinary attachments', async entry => {
    const backgrounds = [0, 1].map(index => ({ ...media('ambient-' + index, index + 2), content_file_role: 4 }))
    const x = await setup({ content_payload: { payload_kind: 2, schema_version: 1, text_state: 1,
      text_format: 'markdown', media_refs: [media('a'), media('b', 1), ...backgrounds], background_sound_amplitudes: [0.1, 0.8] } })
    try {
      const input = { ...target, newText: '    edited\n', expectedVersion: 7, attachments: [{ fileAssetUid: 'b' }, { fileRef }] }
      if (entry === 'ui') {
        await x.service.recordReeditEditor('source', 'r1')
        await x.service.submitRecordReedit(input)
        await vi.waitFor(async () => expect((await x.service.recordReeditSubmissions('source'))[0]?.state).toBe('committed'))
      } else {
        await x.service.commitRecordReedit(await x.service.prepareRecordReedit(input))
      }
      expect(x.writes).toHaveLength(1)
      expect(x.writes[0]).toMatchObject({ template_kind: 2, text_content: '    edited\n', content_payload: {
        text_format: 'markdown', payload_kind: 2, background_sound_amplitudes: [0.1, 0.8], media_refs: [
          { file_asset_uid: 'b' }, { file_asset_uid: 'new-asset' }, ...backgrounds,
        ],
      } })
      expect(x.files.uploadRefs).toHaveBeenCalledWith([fileRef])
    } finally { x.service.dispose() }
  })

  it.each([undefined, [], null, [0.2]])('does not reject text editing solely for waveform metadata: %j', async waveform => {
    const x = await setup({ template_kind: 1, content_payload: { payload_kind: 1, schema_version: 1, text_state: 1,
      background_sound_amplitudes: waveform } })
    try {
      expect((await x.service.recordReeditEditor('source', 'r1')).attachments).toEqual([])
      await x.service.commitRecordReedit(await x.service.prepareRecordReedit({ ...target, newText: '修改正文' }))
      expect(x.writes[0]).toMatchObject({ template_kind: 1, text_content: '修改正文' })
      const payload = x.writes[0]!.content_payload as any
      expect(payload.background_sound_amplitudes).toEqual(Array.isArray(waveform) && waveform.length ? waveform : undefined)
    } finally { x.service.dispose() }
  })

  it.each([undefined, []])('does not accept background audio as the sole user content (selection %j)', async attachments => {
    const x = await setup({ template_kind: 1, content_payload: { payload_kind: 1, schema_version: 1, text_state: 1,
      media_refs: [{ ...media('background'), content_file_role: 4 }] } })
    try {
      await x.service.recordReeditEditor('source', 'r1')
      await expect(x.service.prepareRecordReedit({ ...target, newText: '', expectedVersion: 7,
        ...(attachments === undefined ? {} : { attachments }) })).rejects.toMatchObject({ code: 'record-reedit-content-invalid' })
      expect(x.writes).toEqual([])
    } finally { x.service.dispose() }
  })

  it.each(['ui', 'tool'] as const)('uses the owner mixed-voice payload when %s clears editable media but background refs remain', async entry => {
    const x = await setup({ template_kind: 4, content_payload: { payload_kind: 4, schema_version: 1, text_state: 1,
      voice: { source_file_asset_uid: 'voice', duration_millis: 3000 },
      media_refs: [media('a'), { ...media('background', 1), content_file_role: 4 }] } })
    try {
      const input = { ...target, newText: '', expectedVersion: 7, attachments: [] }
      if (entry === 'ui') {
        const editor = await x.service.recordReeditEditor('source', 'r1')
        expect(editor.hasVoice).toBe(true)
        expect(editor.attachments.map(item => item.selection)).toEqual([{ fileAssetUid: 'a' }])
        await x.service.submitRecordReedit(input)
        await vi.waitFor(async () => expect((await x.service.recordReeditSubmissions('source'))[0]?.state).toBe('committed'))
      } else {
        await x.service.commitRecordReedit(await x.service.prepareRecordReedit(input))
      }
      expect(x.writes[0]).toMatchObject({ template_kind: 4, content_payload: { payload_kind: 4,
        voice: { source_file_asset_uid: 'voice' }, media_refs: [{ file_asset_uid: 'background', content_file_role: 4 }] } })
    } finally { x.service.dispose() }
  })

  it('keeps original ambient audio when a text record gains and then loses its first editable attachment', async () => {
    const background = { ...media('ambient'), content_file_role: 4 }
    const x = await setup({ template_kind: 1, content_payload: { payload_kind: 1, schema_version: 1, text_state: 1,
      media_refs: [background], background_sound_amplitudes: [0.2] } })
    try {
      await x.service.commitRecordReedit(await x.service.prepareRecordReedit({ ...target, expectedVersion: 7, attachments: [{ fileRef }] }))
      expect(x.writes[0]).toMatchObject({ template_kind: 2, content_payload: { payload_kind: 2, media_refs: [
        { file_asset_uid: 'new-asset' }, { ...background, sort_order: 1 },
      ] } })
      await x.service.commitRecordReedit(await x.service.prepareRecordReedit({ ...target, expectedVersion: 8, attachments: [] }))
      expect(x.writes[1]).toMatchObject({ template_kind: 1, content_payload: { payload_kind: 1,
        media_refs: [background], background_sound_amplitudes: [0.2] } })
    } finally { x.service.dispose() }
  })

  it.each(['waveform', 'asset'] as const)('detects a background %s change without dropping the prepared draft', async changed => {
    const x = await setup({ content_payload: { payload_kind: 2, schema_version: 1, text_state: 1,
      media_refs: [media('a'), { ...media('background', 1), content_file_role: 4 }], background_sound_amplitudes: [0.2] } })
    try {
      const prepared = await x.service.prepareRecordReedit({ ...target, newText: '草稿', expectedVersion: 7, attachments: [] })
      const payload = x.core.content_payload as any
      if (changed === 'waveform') payload.background_sound_amplitudes = [0.7]
      else payload.media_refs[1].file_asset_uid = 'another-background'
      await expect(x.service.commitRecordReedit(prepared)).rejects.toMatchObject({ code: 'record-reedit-conflict' })
      expect(x.writes).toEqual([])
      expect(await x.stateStore.getRecordReeditDraft(42, prepared.sourceIdentityKey, 'r1')).toBeDefined()
    } finally { x.service.dispose() }
  })

  it('restores a background record draft after restart and preserves ambient audio on submit', async () => {
    const x = await setup({ content_payload: { payload_kind: 2, schema_version: 1, text_state: 1,
      media_refs: [media('a'), { ...media('background', 1), content_file_role: 4 }], background_sound_amplitudes: [0.2] } })
    await x.service.recordReeditEditor('source', 'r1')
    await x.service.saveRecordReeditDraft({ ...target, newText: '恢复的草稿', expectedVersion: 7, attachments: [] })
    x.service.dispose()
    const restarted = x.restart(true)
    try {
      const editor = await restarted.recordReeditEditor('source', 'r1')
      expect(editor.draft).toMatchObject({ textContent: '恢复的草稿', attachments: [] })
      await restarted.commitRecordReedit(await restarted.prepareRecordReedit(target))
      expect(x.writes[0]).toMatchObject({ template_kind: 1, text_content: '恢复的草稿', content_payload: {
        background_sound_amplitudes: [0.2], media_refs: [{ file_asset_uid: 'background', content_file_role: 4 }],
      } })
    } finally { restarted.dispose() }
  })

  it.each([false, true])('checks background metadata when reconciling a lost response (owner changed: %s)', async changed => {
    const x = await setup({ template_kind: 1, content_payload: { payload_kind: 1, schema_version: 1, text_state: 1,
      media_refs: [{ ...media('background'), content_file_role: 4 }], background_sound_amplitudes: [0.2] } })
    try {
      const prepared = await x.service.prepareRecordReedit({ ...target, newText: '修改正文' })
      x.update.mockImplementationOnce(async body => {
        Object.assign(x.core, body, { version: 8 })
        if (changed) (x.core.content_payload as any).background_sound_amplitudes = [0.8]
        throw new ArkmePluginError('network-failed', '未知结果', false, 502, { writeOutcomeUnknown: true })
      })
      const committed = x.service.commitRecordReedit(prepared)
      if (changed) {
        await expect(committed).rejects.toMatchObject({ code: 'record-reedit-conflict' })
        expect(await x.stateStore.getRecordReeditDraft(42, prepared.sourceIdentityKey, 'r1')).toBeDefined()
      } else {
        await expect(committed).resolves.toMatchObject({ status: 'committed', version: 8 })
        expect(x.core.content_payload).toMatchObject({ background_sound_amplitudes: [0.2],
          media_refs: [{ file_asset_uid: 'background', content_file_role: 4 }] })
      }
      expect(x.update).toHaveBeenCalledTimes(1)
    } finally { x.service.dispose() }
  })

  it.each(['ui', 'tool'] as const)('retains repeated owner background references without blocking %s edits', async entry => {
    const backgrounds = [1, 2].map(sortOrder => ({ ...media('ambient', sortOrder), content_file_role: 4 }))
    const x = await setup({ content_payload: { payload_kind: 2, schema_version: 1, text_state: 1,
      media_refs: [media('a'), ...backgrounds], background_sound_amplitudes: [0.2, 0.4] } })
    try {
      const input = { ...target, newText: '保留重复背景音', expectedVersion: 7, attachments: [] }
      if (entry === 'ui') {
        await x.service.recordReeditEditor('source', 'r1')
        await x.service.submitRecordReedit(input)
        await vi.waitFor(async () => expect((await x.service.recordReeditSubmissions('source'))[0]?.state).toBe('committed'))
      } else {
        await x.service.commitRecordReedit(await x.service.prepareRecordReedit(input))
      }
      expect(x.writes).toHaveLength(1)
      expect(x.writes[0]).toMatchObject({ template_kind: 1, content_payload: {
        background_sound_amplitudes: [0.2, 0.4], media_refs: backgrounds.map((ref, sort_order) => ({ ...ref, sort_order })),
      } })
    } finally { x.service.dispose() }
  })

  it('uses the owner content role instead of a file-binding alias to classify editable media', async () => {
    const x = await setup({ content_payload: { payload_kind: 2, schema_version: 1, text_state: 1,
      media_refs: [{ ...media('a'), content_file_role: 1, binding_type: 4 }] } })
    try {
      const editor = await x.service.recordReeditEditor('source', 'r1')
      expect(editor.attachments.map(item => item.selection)).toEqual([{ fileAssetUid: 'a' }])
      await x.service.commitRecordReedit(await x.service.prepareRecordReedit({ ...target, newText: '修改正文', expectedVersion: 7, attachments: [] }))
      expect(x.writes[0]).toMatchObject({ template_kind: 1, content_payload: { media_refs: [] } })
    } finally { x.service.dispose() }
  })

  it('does not let retained background segments consume the nine editable attachment slots', async () => {
    const attachments = Array.from({ length: 9 }, (_, index) => media('image-' + index, index))
    const backgrounds = Array.from({ length: 12 }, (_, index) => ({ ...media('ambient-' + index, index + 9), content_file_role: 4 }))
    const x = await setup({ content_payload: { payload_kind: 2, schema_version: 1, text_state: 1, media_refs: [...attachments, ...backgrounds] } })
    try {
      const editor = await x.service.recordReeditEditor('source', 'r1')
      expect(editor.attachments).toHaveLength(9)
      await x.service.commitRecordReedit(await x.service.prepareRecordReedit({ ...target, newText: '修改正文', expectedVersion: 7,
        attachments: editor.attachments.map(item => item.selection) }))
      expect((x.writes[0]!.content_payload as any).media_refs).toHaveLength(21)
    } finally { x.service.dispose() }
  })

  it('rejects an uploaded asset that would reuse the ambient asset as ordinary media before writing', async () => {
    const x = await setup({ template_kind: 1, content_payload: { payload_kind: 1, schema_version: 1, text_state: 1,
      media_refs: [{ ...media('ambient'), content_file_role: 4 }] } })
    x.files.uploadRefs.mockResolvedValueOnce([{ ...asset, fileAssetUid: 'ambient' }])
    try {
      const prepared = await x.service.prepareRecordReedit({ ...target, expectedVersion: 7, attachments: [{ fileRef }] })
      await expect(x.service.commitRecordReedit(prepared)).rejects.toMatchObject({ code: 'record-reedit-attachment-invalid' })
      expect(x.writes).toEqual([])
      expect(await x.stateStore.getRecordReeditDraft(42, prepared.sourceIdentityKey, 'r1')).toBeDefined()
    } finally { x.service.dispose() }
  })

  it.each(['put', 'migrate'])('does not overwrite a concurrently created attachment draft from legacy %s', async action => {
    const x = await setup({ template_kind: 1, display_kind: 1, content_payload: { payload_kind: 1, schema_version: 1, text_state: 1 } })
    const detail = await x.service.longArticleDetail('source', 'r1')
    let release!: () => void
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    vi.spyOn(x.service, 'longArticleDetail').mockImplementationOnce(async () => { entered(); await gate; return detail })
    const legacy = { sourceRef: 'source', itemUid: 'r1', title: '', textContent: 'legacy', durationMillis: 0, updatedAtMillis: 1 }
    if (action === 'migrate') await x.stateStore.putLongArticleDraft(42, legacy)
    const pending = action === 'put' ? x.service.putLongArticleDraft(legacy) : x.service.getLongArticleDraft('source', 'r1')
    const rejected = expect(pending).rejects.toMatchObject({ code: 'record-reedit-draft-changed' })
    await started
    const p = await x.service.prepareRecordReedit({ ...target, expectedVersion: 7, attachments: [] })
    release()
    await rejected
    expect((await x.stateStore.getRecordReeditDraft(42, p.sourceIdentityKey, 'r1'))?.attachments).toEqual([])
  })
  it('hydrates original thumbnails through the existing authorized Record media projection', async () => {
    const x = await setup()
    const view = await x.service.recordReeditEditor('source', 'r1')
    expect(x.readMedia).toHaveBeenCalledOnce()
    expect(view.attachments[0]).toMatchObject({ selection: { fileAssetUid: 'a' }, asset: { size: 20, fileName: 'a.png' }, block: { kind: 'image', mediaRef: expect.any(String), originalRef: expect.any(String) } })
    expect(JSON.stringify(view)).not.toContain('https://example.com')
  })
  it('adds, removes and orders attachments without uploading before confirmation', async () => {
    const x = await setup()
    const prepared = await x.service.prepareRecordReedit({ ...target, expectedVersion: 7, attachments: [{ fileRef }, { fileAssetUid: 'b' }] })
    expect(x.files.uploadRefs).not.toHaveBeenCalled()
    expect(prepared.attachmentChanges).toEqual({ added: 1, removed: 1, retained: 1, reordered: false })
    await x.service.commitRecordReedit(prepared)
    expect(x.writes[0]).toMatchObject({ text_content: '原文', template_kind: 2, content_payload: {
      payload_kind: 2, media_refs: [{ ...media('new-asset'), file_name: 'new.png' }, media('b', 1)],
    } })
    expect((x.writes[0]!.content_payload as any).media_refs[0].file_name).toBe('new.png')
  })

  it('preserves the attachment candidate when a subsequent text edit omits attachments', async () => {
    const x = await setup()
    await x.service.prepareRecordReedit({ ...target, expectedVersion: 7, attachments: [{ fileAssetUid: 'b' }] })
    const p = await x.service.prepareRecordReedit({ ...target, newText: '新文' })
    await x.service.commitRecordReedit(p)
    expect((x.writes[0]!.content_payload as any).media_refs).toEqual([media('b')])
  })

  it('clears editable media and returns to plain text', async () => {
    const x = await setup()
    const p = await x.service.prepareRecordReedit({ ...target, expectedVersion: 7, attachments: [] })
    await x.service.commitRecordReedit(p)
    expect(x.writes[0]).toMatchObject({ template_kind: 1, content_payload: { payload_kind: 1, media_refs: [] } })
  })

  it('allows attachment-only records but rejects removing their last usable content', async () => {
    const x = await setup({ text_content: '' })
    const p = await x.service.prepareRecordReedit({ ...target, expectedVersion: 7, attachments: [{ fileAssetUid: 'a' }] })
    await x.service.commitRecordReedit(p)
    await expect(x.service.prepareRecordReedit({ ...target, expectedVersion: 8, attachments: [] })).rejects.toMatchObject({ code: 'record-reedit-content-invalid' })
  })
  it('marks empty media text unavailable instead of claiming an available text projection', async () => {
    const x = await setup()
    const p = await x.service.prepareRecordReedit({ ...target, expectedVersion: 7, newText: '', attachments: [{ fileAssetUid: 'a' }] })
    await x.service.commitRecordReedit(p)
    expect(x.writes[0]).toMatchObject({ text_content: '', content_payload: { text_state: 3 } })
  })
  it('does not silently turn a long article into a media record', async () => {
    const x = await setup({ template_kind: 1, display_kind: 1, content_payload: { payload_kind: 1, schema_version: 1, text_state: 1 } })
    expect((await x.service.recordReeditEditor('source', 'r1')).maxAttachments).toBe(0)
    await expect(x.service.prepareRecordReedit({ ...target, expectedVersion: 7, attachments: [{ fileRef }] })).rejects.toMatchObject({ code: 'record-reedit-shape-unsupported' })
    expect(x.files.uploadRefs).not.toHaveBeenCalled()
  })
  it('does not submit duplicate assets when a newly uploaded file resolves to a retained asset', async () => {
    const x = await setup()
    x.files.uploadRefs.mockResolvedValueOnce([{ ...asset, fileAssetUid: 'a' }])
    const p = await x.service.prepareRecordReedit({ ...target, expectedVersion: 7, attachments: [{ fileAssetUid: 'a' }, { fileRef }] })
    await expect(x.service.commitRecordReedit(p)).rejects.toMatchObject({ code: 'record-reedit-attachment-invalid' })
    expect(x.writes).toEqual([])
  })
  it('persists an empty UI draft but refuses to submit it', async () => {
    const x = await setup()
    const p = await x.service.prepareRecordReedit({ ...target, expectedVersion: 7, newText: '', attachments: [] }, { draftOnly: true })
    expect((await x.stateStore.getRecordReeditDraft(42, p.sourceIdentityKey, 'r1'))?.textContent).toBe('')
    await expect(x.service.commitRecordReedit(p)).rejects.toMatchObject({ code: 'record-reedit-content-invalid' })
    expect(x.writes).toEqual([])
  })
  it('does not let a legacy long-article consumer drop an attachment draft', async () => {
    const x = await setup({ template_kind: 1, display_kind: 1, content_payload: { payload_kind: 1, schema_version: 1, text_state: 1 } })
    const p = await x.service.prepareRecordReedit({ ...target, expectedVersion: 7, attachments: [] })
    await expect(x.service.getLongArticleDraft('source', 'r1')).rejects.toMatchObject({ code: 'record-reedit-attachments-editor-required' })
    await expect(x.service.putLongArticleDraft({ sourceRef: 'source', itemUid: 'r1', title: '', textContent: 'legacy', durationMillis: 0, updatedAtMillis: 1 })).rejects.toMatchObject({ code: 'record-reedit-attachments-editor-required' })
    await expect(x.service.removeLongArticleDraft('source', 'r1')).rejects.toMatchObject({ code: 'record-reedit-attachments-editor-required' })
    await expect(x.service.updateLongArticle('source', 'r1', { title: '标题', textContent: 'legacy', version: 7, editDurationMillis: 0 })).rejects.toMatchObject({ code: 'record-reedit-attachments-editor-required' })
    expect((await x.stateStore.getRecordReeditDraft(42, p.sourceIdentityKey, 'r1'))?.attachments).toEqual([])
  })

  it.each([
    { attachments: [{ fileAssetUid: 'foreign' }], expectedVersion: 7, code: 'record-reedit-attachment-invalid' },
    { attachments: [{ fileAssetUid: 'a' }, { fileAssetUid: 'a' }], expectedVersion: 7, code: 'record-reedit-attachment-invalid' },
    { attachments: [{ fileAssetUid: 'a', fileRef }], expectedVersion: 7, code: 'record-reedit-attachment-invalid' },
    { attachments: Array.from({ length: 10 }, (_, i) => ({ fileAssetUid: `asset-${i}` })), expectedVersion: 7, code: 'record-reedit-attachment-invalid' },
    { attachments: [{ fileRef: '/tmp/file.png' }], expectedVersion: 7, code: 'record-reedit-attachment-invalid' },
    { attachments: [], expectedVersion: undefined, code: 'record-reedit-version-invalid' },
    { attachments: [], expectedVersion: 6, code: 'record-reedit-conflict' },
  ])('rejects invalid selections or missing/stale baseline: $code', async input => {
    const x = await setup()
    await expect(x.service.prepareRecordReedit({ ...target, ...input } as never)).rejects.toMatchObject({ code: input.code })
    expect(x.writes).toEqual([])
    expect(x.files.uploadRefs).not.toHaveBeenCalled()
  })

  it.each([false, true])('keeps a dynamic photo paired and preserves the independent voice while clearing media (background: %s)', async withBackground => {
    const voice = { source_file_asset_uid: 'voice', duration_millis: 1200, transcription_state: 2 }
    const photo = { ...media('still'), dynamic_photo: { logical_uid: 'live', role: 'cover' } }
    const motion = { ...media('motion', 1), render_role: 4, dynamic_photo: { logical_uid: 'live', role: 'motion' } }
    const background = withBackground ? [{ ...media('ambient', 3), content_file_role: 4 }] : []
    const x = await setup({ template_kind: 4, text_content: '', content_payload: { payload_kind: 4, schema_version: 1, text_state: 2, voice, media_refs: [photo, motion, media('b', 2), ...background] } })
    let p = await x.service.prepareRecordReedit({ ...target, expectedVersion: 7, attachments: [{ fileAssetUid: 'still' }] })
    await x.service.commitRecordReedit(p)
    expect((x.writes[0]!.content_payload as any).media_refs).toEqual([photo, motion, ...background.map(ref => ({ ...ref, sort_order: 2 }))])
    p = await x.service.prepareRecordReedit({ ...target, expectedVersion: 8, attachments: [] })
    await x.service.commitRecordReedit(p)
    const kind = withBackground ? 4 : 3
    expect(x.writes[1]).toMatchObject({ template_kind: kind, content_payload: { payload_kind: kind, text_state: 2, voice, media_refs: background.map(ref => ({ ...ref, sort_order: 0 })) } })
  })

  it('persists attachment selections and changes the revision when only order changes', async () => {
    const x = await setup()
    const a = await x.service.prepareRecordReedit({ ...target, expectedVersion: 7, attachments: [{ fileAssetUid: 'a' }, { fileAssetUid: 'b' }] })
    const b = await x.service.prepareRecordReedit({ ...target, expectedVersion: 7, attachments: [{ fileAssetUid: 'b' }, { fileAssetUid: 'a' }] })
    expect(b.draftRevision).toBeGreaterThan(a.draftRevision)
    await expect(x.service.commitRecordReedit(a)).rejects.toMatchObject({ code: 'record-reedit-draft-changed' })
    const restored = await new ArkmeStateStore(x.root).getRecordReeditDraft(42, a.sourceIdentityKey, 'r1')
    expect(restored?.attachments).toEqual([{ fileAssetUid: 'b' }, { fileAssetUid: 'a' }])
    expect((await x.service.recordReeditEditor('source', 'r1')).draft?.attachments?.map(v => v.selection)).toEqual(restored?.attachments)
  })

  it('does not rebase a restored attachment draft onto a newer owner version', async () => {
    const x = await setup()
    await x.service.prepareRecordReedit({ ...target, expectedVersion: 7, attachments: [{ fileAssetUid: 'a' }] })
    x.core.version = 8
    const p = await x.service.prepareRecordReedit(target)
    expect(p.baseVersion).toBe(7)
    await expect(x.service.commitRecordReedit(p)).rejects.toMatchObject({ code: 'record-reedit-conflict' })
  })

  it('rejects a stale UI draft revision without overwriting another consumer', async () => {
    const x = await setup()
    const p = await x.service.prepareRecordReedit({ ...target, expectedVersion: 7, expectedDraftRevision: 0, attachments: [{ fileAssetUid: 'a' }] })
    await expect(x.service.prepareRecordReedit({ ...target, expectedVersion: 7, expectedDraftRevision: 0, attachments: [] })).rejects.toMatchObject({ code: 'record-reedit-draft-changed' })
    expect((await x.stateStore.getRecordReeditDraft(42, p.sourceIdentityKey, 'r1'))?.attachments).toEqual([{ fileAssetUid: 'a' }])
  })

  it.each([false, true])('retains a draft after upload failure and after an account switch during upload (background: %s)', async withBackground => {
    const background = withBackground ? [{ ...media('ambient', 1), content_file_role: 4 }] : []
    const x = await setup({ content_payload: { payload_kind: 2, schema_version: 1, text_state: 1, media_refs: [media('a'), ...background] } })
    const p = await x.service.prepareRecordReedit({ ...target, expectedVersion: 7, attachments: [{ fileRef }] })
    x.files.uploadRefs.mockRejectedValueOnce(new Error('upload failed'))
    await expect(x.service.commitRecordReedit(p)).rejects.toThrow('upload failed')
    x.files.uploadRefs.mockImplementationOnce(async () => { x.switchAccount(); return [asset] })
    await expect(x.service.commitRecordReedit(p)).rejects.toMatchObject({ code: 'record-reedit-account-changed' })
    expect(x.writes).toEqual([])
    expect(await x.stateStore.getRecordReeditDraft(42, p.sourceIdentityKey, 'r1')).toBeDefined()
  })
  it.each([false, true])('restores a missing local file as unavailable and allows removing it without losing text (background: %s)', async withBackground => {
    const background = withBackground ? [{ ...media('ambient', 1), content_file_role: 4 }] : []
    const x = await setup({ content_payload: { payload_kind: 2, schema_version: 1, text_state: 1, media_refs: [media('a'), ...background] } })
    await x.service.prepareRecordReedit({ ...target, expectedVersion: 7, newText: '草稿正文', attachments: [{ fileRef }] })
    x.files.files.mockResolvedValueOnce([])
    const editor = await x.service.recordReeditEditor('source', 'r1')
    expect(editor.draft?.attachments?.[0]).toMatchObject({ selection: { fileRef }, unavailable: true })
    const p = await x.service.prepareRecordReedit({ ...target, expectedVersion: 7, attachments: [] })
    await x.service.commitRecordReedit(p)
    expect(x.writes[0]).toMatchObject({ text_content: '草稿正文', template_kind: 1 })
  })

  it('rejects a changed draft after upload instead of applying an obsolete confirmation', async () => {
    const x = await setup()
    const p = await x.service.prepareRecordReedit({ ...target, expectedVersion: 7, attachments: [{ fileRef }] })
    x.files.uploadRefs.mockImplementationOnce(async () => {
      await x.service.prepareRecordReedit({ ...target, expectedVersion: 7, attachments: [{ fileAssetUid: 'a' }] })
      return [asset]
    })
    await expect(x.service.commitRecordReedit(p)).rejects.toMatchObject({ code: 'record-reedit-draft-changed' })
    expect(x.writes).toEqual([])
  })
  it.each([false, true])('checks the account after the final draft read before writing (attachments=%s)', async withAttachments => {
    const x = await setup()
    const p = await x.service.prepareRecordReedit({ ...target, newText: '更新', ...(withAttachments ? { expectedVersion: 7, attachments: [{ fileRef }] } : {}) })
    const read = x.stateStore.getRecordReeditDraft.bind(x.stateStore)
    let reads = 0
    vi.spyOn(x.stateStore, 'getRecordReeditDraft').mockImplementation(async (...args) => {
      const draft = await read(...args)
      reads += 1
      if (reads === (withAttachments ? 2 : 1)) x.switchAccount()
      return draft
    })
    await expect(x.service.commitRecordReedit(p)).rejects.toMatchObject({ code: 'record-reedit-account-changed' })
    expect(x.writes).toEqual([])
  })

  it('reconciles an unknown successful write including the changed template and attachments', async () => {
    const x = await setup({ template_kind: 1, content_payload: { payload_kind: 1, schema_version: 1, text_state: 1 } })
    const p = await x.service.prepareRecordReedit({ ...target, expectedVersion: 7, attachments: [{ fileRef }] })
    x.update.mockImplementationOnce(async body => {
      Object.assign(x.core, body, { version: 8 })
      throw new ArkmePluginError('network-failed', '未知结果', false, 502, { writeOutcomeUnknown: true })
    })
    await expect(x.service.commitRecordReedit(p)).resolves.toMatchObject({ status: 'committed', version: 8 })
    expect(x.update).toHaveBeenCalledTimes(1)
  })
})
