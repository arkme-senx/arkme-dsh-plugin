import { describe, expect, it } from 'vitest'
import { createHarnessDraftBridge, type DraftSessions, type DraftConversation, type NativeDraft } from '../src/client/harness-attachment-draft.js'
function fixture() {
  let current = 'old', created = 0, seq = 0, account = true
  const inputs = new Map<string, { draft: string; draftRev: number; attachmentIds: string[]; phase: string }>()
  inputs.set('old', { draft: '原有草稿', draftRev: 2, attachmentIds: ['old-file'], phase: 'plain' })
  const files = new Map<string, NativeDraft>()
  const uploads: Record<string, { status: string; message?: string }> = {}
  let fail = false
  const store = <T>(getSnapshot: () => T) => ({ getSnapshot, subscribe: () => () => {} })
  const conversation: DraftConversation = {
    input: { for: scope => ({ state: store(() => inputs.get((scope as { id: string }).id)!), addAttachments: ids => { inputs.get((scope as { id: string }).id)!.attachmentIds.push(...ids); return true } }) },
    createDrafts: (_id, batch) => batch.map(file => { const id = String(++seq); const draft: NativeDraft = { id, kind: file.type === 'image/png' ? 'image' : 'file', file }; files.set(id, draft); uploads[id] = { status: fail ? 'error' : 'ready', message: '上传失败' }; return draft }),
    releaseDraftAttachments: drafts => { for (const draft of drafts) files.delete(draft.id) },
    fileUploads: store(() => uploads),
  }
  const sessions: DraftSessions = {
    list: store(() => ({ current, byId: { old: { workspaceId: 'work' } } })),
    async create({ sessionId, workspaceId }) { expect(workspaceId).toBe('default-work'); created++; inputs.set(sessionId, { draft: '', draftRev: 0, attachmentIds: [], phase: 'plain' }); return sessionId },
    open(id) { current = id }, scope(id) { return { id, get: () => conversation } },
    binding: () => ({ session: { projections: { faceOf: () => store(() => ({ maxImagesPerMessage: 1, maxImageBytes: 10, maxMessageImageBytes: 10, mediaTypes: ['image/png'] })) } } }),
  }
  return { bridge: createHarnessDraftBridge(sessions, () => account, async () => 'default-work'), inputs, files, uploads, sessions, setFail: (value: boolean) => { fail = value }, changeAccount: () => { account = false }, created: () => created, current: () => current }
}
const request = () => ({ operationId: 'operation', files: [new File(['正文'], '快记摘录.md')], signal: new AbortController().signal })
describe('原生 DSH 附件草稿', () => {
  it('creates a separate conversation, attaches files without sending, and preserves old drafts', async () => {
    const f = fixture(); const result = await f.bridge.prepare(request())
    expect(result.sessionId).not.toBe('old')
    expect(f.inputs.get('old')).toMatchObject({ draft: '原有草稿', attachmentIds: ['old-file'] })
    expect(f.inputs.get(result.sessionId)).toMatchObject({ draft: '', attachmentIds: ['1'] })
    expect(await f.bridge.prepare(request())).toEqual(result)
    expect(f.created()).toBe(1)
  })
  it('cleans partial drafts and retries in the same newly created session', async () => {
    const f = fixture(); f.setFail(true)
    await expect(f.bridge.prepare(request())).rejects.toThrow('上传失败')
    expect(f.files.size).toBe(0); expect(f.current()).toBe('old')
    f.setFail(false); await f.bridge.prepare(request()); expect(f.created()).toBe(1)
  })
  it('refuses edited retry targets, account changes and unsupported versions', async () => {
    const f = fixture(); f.setFail(true)
    await expect(f.bridge.prepare(request())).rejects.toThrow()
    const target = [...f.inputs.keys()].find(id => id !== 'old')!
    f.inputs.get(target)!.draft = '用户输入'
    await expect(f.bridge.prepare(request())).rejects.toThrow('已被编辑')
    f.changeAccount(); await expect(f.bridge.prepare(request())).rejects.toThrow('账号')
    const old = createHarnessDraftBridge({} as DraftSessions, () => true)
    await expect(old.prepare(request())).rejects.toThrow('升级')
  })
  it('enforces host image limits before registering attachments', async () => {
    const f = fixture()
    await expect(f.bridge.prepare({ ...request(), files: [new File(['a'], '1.png', { type: 'image/png' }), new File(['b'], '2.png', { type: 'image/png' })] })).rejects.toThrow('限制')
    expect(f.files.size).toBe(0)
  })
  it('aborts in-flight uploads without handing partial context to the composer', async () => {
    const f = fixture(); const c = new AbortController()
    const pending = f.bridge.prepare({ ...request(), signal: c.signal, progress: text => { if (text.includes('附件')) c.abort() } })
    await expect(pending).rejects.toThrow()
    expect(f.files.size).toBe(0)
  })
})

it('does not steal a newly selected conversation while create is still pending', async () => {
  const f = fixture(), gate = Promise.withResolvers<void>()
  const create = f.sessions.create.bind(f.sessions)
  f.sessions.create = async options => { const id = await create(options); await gate.promise; return id }
  const pending = f.bridge.prepare(request())
  f.sessions.open('user-selected')
  gate.resolve()
  await expect(pending).rejects.toThrow('切换')
  expect(f.current()).toBe('user-selected'); expect(f.files.size).toBe(0)
})
