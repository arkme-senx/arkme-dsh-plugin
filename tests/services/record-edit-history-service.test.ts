import { describe, expect, it, vi } from 'vitest'
import { RecordEditHistoryService } from '../../src/services/record-edit-history-service.js'
import { recordManualEditFact } from '../../src/record-edit-history.js'

function fixture(response: unknown) {
  let userId = 42
  const runtime = { requireSession: vi.fn(async () => ({ userId })), authenticatedPost: vi.fn(async () => response), authenticatedChatPost: vi.fn(async () => response) }
  const projector = { projectPage: vi.fn(async (rows: Record<string, unknown>[]) => rows.map(raw => ({ textContent: raw.text_content, contentBlocks: raw.media_display_items ?? [] }))) }
  return { runtime, projector, service: new RecordEditHistoryService(runtime as never, projector as never), switchUser: () => { userId = 43 } }
}
const revision = (id: string, type = 1) => ({ revision_uid: id, record_uid: 'r1', revision_type: type, edit_at: 1700000000000, text_content: id })
const target = { kind: 'owned' as const, viewerUserId: 42, recordUid: 'r1' }

describe('Record edit history', () => {
  it('prefers explicit manual edit facts over legacy status; never infers from versions', () => {
    expect(recordManualEditFact({ has_manual_edit: false, edit_status: 4 })).toBe(false)
    expect(recordManualEditFact({ record_core: { has_manual_edit: true } })).toBe(true)
    expect(recordManualEditFact({ record: { payload: { edit_status: 3 } } })).toBe(true)
    expect(recordManualEditFact({ has_polish: true, edit_status: 2, version: 9 })).toBe(false)
    expect(recordManualEditFact({ version: 9 })).toBeUndefined()
  })
  it('reads owned history, preserves revision identity and renders only manual/original snapshots', async () => {
    const f = fixture({ items: [revision('manual'), revision('voice', 2), revision('polish', 3), revision('rewrite', 4), revision('original', 5)], has_more: false })
    const result = await f.service.page(target, 0)
    expect(result.items.map(item => item.revisionUid)).toEqual(['manual', 'original'])
    expect(f.runtime.authenticatedPost).toHaveBeenCalledWith('/api/v1/records/revisions/query', { record_uid: 'r1', limit: 50 }, { userId: 42 }, undefined)
    expect(f.runtime.authenticatedChatPost).not.toHaveBeenCalled()
  })
  it('routes chat through its relation gate without falling back to owned reads', async () => {
    const f = fixture({ items: [], has_more: true, next_cursor_edit_at: 100 })
    expect(await f.service.page({ kind: 'chat', viewerUserId: 42, recordUid: 'r1', chatSessionUid: 's1', relationUid: 'rel1', recordOwnerUserId: 42 }, 200)).toEqual({ items: [], hasMore: true, nextCursorEditAt: 100 })
    expect(f.runtime.authenticatedChatPost).toHaveBeenCalledWith('/api/v1/chats/records/revisions/query', { chat_session_uid: 's1', rel_uid: 'rel1', limit: 50, cursor_edit_at: 200 }, { userId: 42 }, undefined)
    expect(f.runtime.authenticatedPost).not.toHaveBeenCalled()
  })
  it('rejects a mixed-record response and non-progressing page rather than showing wrong history', async () => {
    await expect(fixture({ items: [{ ...revision('bad'), record_uid: 'other' }], has_more: false }).service.page(target, 0)).rejects.toThrow()
    await expect(fixture({ items: [], has_more: true, next_cursor_edit_at: 200 }).service.page(target, 200)).rejects.toThrow()
    await expect(fixture({}).service.page(target, 0)).rejects.toThrow()
  })
  it('rejects changed accounts and invalid cursors before querying', async () => {
    const f = fixture({ items: [], has_more: false }); f.switchUser()
    await expect(f.service.page(target, 0)).rejects.toThrow()
    expect(f.runtime.authenticatedPost).not.toHaveBeenCalled()
    await expect(fixture({}).service.page(target, -1)).rejects.toThrow()
  })
  it('passes only the historical snapshot and never fetches the current record media', async () => {
    const historic = { ...revision('rev'), media_display_items: [{ file_asset_uid: 'old-image' }] }
    const f = fixture({ items: [historic], has_more: false })
    await f.service.page(target, 0)
    expect(f.projector.projectPage).toHaveBeenCalledWith([historic], target, undefined)
  })
  it('rejects timestamps outside the renderable date range', async () => {
    await expect(fixture({ items: [{ ...revision('invalid-date'), edit_at: Number.MAX_SAFE_INTEGER }], has_more: false }).service.page(target)).rejects.toThrow()
  })
  it('rejects a response after account changes or cancellation during the request', async () => {
    const f = fixture({ items: [revision('private')], has_more: false })
    f.runtime.authenticatedPost.mockImplementationOnce(async () => { f.switchUser(); return { items: [revision('private')], has_more: false } })
    await expect(f.service.page(target)).rejects.toThrow()
    expect(f.projector.projectPage).not.toHaveBeenCalled()
    const aborted = fixture({ items: [revision('private')], has_more: false })
    const controller = new AbortController()
    aborted.runtime.authenticatedPost.mockImplementationOnce(async () => { controller.abort(); return { items: [revision('private')], has_more: false } })
    await expect(aborted.service.page(target, 0, controller.signal)).rejects.toThrow()
    expect(aborted.projector.projectPage).not.toHaveBeenCalled()
  })
  it('rejects account changes or cancellation during asynchronous media projection', async () => {
    const f = fixture({ items: [revision('private')], has_more: false })
    f.projector.projectPage.mockImplementationOnce(async () => { f.switchUser(); return [{ textContent: 'private', contentBlocks: [] }] })
    await expect(f.service.page(target)).rejects.toThrow()
    const g = fixture({ items: [revision('private')], has_more: false })
    const controller = new AbortController()
    g.projector.projectPage.mockImplementationOnce(async () => { controller.abort(); return [{ textContent: 'private', contentBlocks: [] }] })
    await expect(g.service.page(target, 0, controller.signal)).rejects.toThrow()
  })
  it('does not swallow owner failures', async () => {
    const f = fixture({}); f.runtime.authenticatedPost.mockRejectedValue(new Error('无权访问'))
    await expect(f.service.page(target, 0)).rejects.toThrow('无权访问')
  })
})
