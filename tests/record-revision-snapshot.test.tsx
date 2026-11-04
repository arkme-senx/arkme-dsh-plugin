import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatService } from '../src/services/chat-service.js'
import { MediaService } from '../src/services/media-service.js'
import type { ArkmeRecordEditHistoryReader } from '../src/record-edit-history.js'

vi.mock('../src/client/api.js', () => ({ callArkme: vi.fn() }))
vi.mock('../src/client/ArkmeRichContent.js', () => ({ ArkmeMessageContent: ({ item }: any) => <p>{item.textContent}</p> }))
vi.mock('../src/client/ArkmeMessageSnapshotDialog.js', () => ({
  ArkmeMessageSnapshotDialog: ({ detail, loading, loadError, onClose, onRetry }: any) => <div data-snapshot>
    <pre>{JSON.stringify({ detail, loading, loadError })}</pre><button onClick={onClose}>关闭快照</button><button onClick={onRetry}>重试快照</button>
  </div>,
}))
import { ArkmeRecordEditHistory } from '../src/client/ArkmeRecordEditHistory.js'
import { ArkmeRecordRevisionSnapshotDialog } from '../src/client/ArkmeRecordRevisionSnapshotDialog.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'

const target = { kind: 'owned' as const, viewerUserId: 42, recordUid: 'note' }
function hostFixture() {
  let userId = 42
  const runtime = { requireSession: async () => ({ userId }), authenticatedPost: vi.fn(async () => ({ record_uid: 'note' })) }
  const media = { recordBackgroundSoundRefs: vi.fn(() => []), hydrateRecordSnapshotMediaPage: vi.fn(async () => [[]]),
    richContentBlocks: vi.fn(() => []) }
  const chat = new ChatService(runtime as never, {} as never, {} as never, media as never, {} as never, {} as never, {} as never, {} as never, {} as never)
  return { chat, runtime, media, switchAccount: () => { userId = 43 } }
}
describe('revision-bound memory snapshots', () => {
  it('reads the known single-edit fact without subtracting adjacent revisions', async () => {
    const f = hostFixture()
    const detail = await f.chat.projectRecordRevisionSnapshot({ record_uid: 'note', revision_uid: 'edit', revision_type: 1, version: 3,
      edit_at: 1700000001000, text_content: '新版', record_duration_millis: 1000, edit_duration_known: true, edit_duration_millis: 3000 }, target)
    expect(detail.durationState).toBe('complete')
    expect(detail.recordDurationMillis).toBeUndefined()
    expect(detail.editDurationMillis).toBe(3000)
    expect(detail.startAtMillis).toBe(1700000001000 - 3000)
    const unknown = await f.chat.projectRecordRevisionSnapshot({ record_uid: 'note', revision_uid: 'edit', edit_at: 1700000001000,
      text_content: '新版', record_duration_millis: 1000, edit_duration_millis: 5000 }, target)
    expect(unknown.durationState).toBe('partial')
    expect(unknown.editDurationMillis).toBeUndefined()
  })

  it('distinguishes measured zero and later original-type baselines from creation', async () => {
    const f = hostFixture()
    const detail = await f.chat.projectRecordRevisionSnapshot({ record_uid: 'note', revision_uid: 'zero', revision_type: 5, version: 4,
      edit_at: 1000, edit_duration_known: true, edit_duration_millis: 0, record_duration_millis: 900,
      edit_capture_context: { captured_at: 2000 } }, target)
    expect(detail.durationState).toBe('complete')
    expect(detail.editDurationMillis).toBe(0)
    expect(detail.recordDurationMillis).toBeUndefined()
    expect(detail.completeAtMillis).toBe(2000)
    expect(detail.startAtMillis).toBe(2000)
  })
  it('resolves ambient playback from the historical assets instead of current-message media', async () => {
    const f = hostFixture()
    f.media.richContentBlocks.mockReturnValue([{ mediaRef: 'historical-audio', kind: 'audio' }] as never)
    const detail = await f.chat.projectRecordRevisionSnapshot({ record_uid: 'note', revision_uid: 'original', revision_type: 5, version: 1,
      edit_at: 1700000000000, text_content: '旧版', record_duration_millis: 4000,
      content_payload: { media_refs: [{ file_asset_uid: 'old-audio', content_file_role: 4 }], background_sound_amplitudes: [0.4] } }, target)
    expect(detail.backgroundSoundPlayback).toMatchObject({ mediaRefs: ['historical-audio'], amplitudes: [0.4], durationSeconds: 4 })
    expect(f.media.hydrateRecordSnapshotMediaPage.mock.calls[0]?.[0]).toMatchObject([{ content_payload: { media_refs: [{ file_asset_uid: 'old-audio' }] } }])
  })
  it('hydrates historical ambient roles through the real media service without exposing ordinary attachments', async () => {
    const f = hostFixture()
    const runtime = { ...f.runtime, config: { environment: 'test' } }
    const media = new MediaService(runtime as never, {} as never, {} as never, {} as never)
    const query = vi.spyOn(media, 'queryFileAssets').mockResolvedValue([{
      fileAssetUid: 'old-audio', fileName: 'ambient.m4a', mimeType: 'audio/mp4', fileKind: 2, size: 10,
      downloadUrl: 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/old-audio.m4a',
    }] as never)
    const chat = new ChatService(runtime as never, {} as never, {} as never, media, {} as never, {} as never, {} as never, {} as never, {} as never)
    const raw = { record_uid: 'note', revision_uid: 'old', revision_type: 5, version: 1, edit_at: 1700000000000, text_content: '旧版',
      content_payload: { media_refs: [{ file_asset_uid: 'old-audio', content_file_role: 4 },
        { file_asset_uid: 'ordinary-attachment', content_file_role: 1 }] } }
    expect(media.recordBackgroundSoundRefs(raw)).toHaveLength(1)
    const detail = await chat.projectRecordRevisionSnapshot(raw, target)
    expect(query).toHaveBeenCalledExactlyOnceWith(['old-audio'], undefined)
    expect(detail.backgroundSoundPlayback?.mediaRefs).toEqual([expect.stringMatching(/^arkme-media-v1\./)])
  })
  it('uses the selected revision environment and duration without reading current Record detail', async () => {
    const f = hostFixture()
    const detail = await f.chat.projectRecordRevisionSnapshot({ record_uid: 'note', revision_uid: 'old', edit_at: 1700000000000,
      text_content: '旧版正文', edit_duration_known: true, edit_duration_millis: 3200,
      edit_capture_context: { schema_version: 1, captured_at: 1700000000000, client_name: '旧设备', electric: 0, network_name: '旧网络' } }, target)
    expect(detail).toMatchObject({ revisionUid: 'old', textContent: '旧版正文', editDurationMillis: 3200,
      captureContext: { clientName: '旧设备', electric: 0, networkName: '旧网络' } })
    expect(f.runtime.authenticatedPost).toHaveBeenCalledExactlyOnceWith('/api/v1/records/location/context/get',
      { record_uid: 'note', revision_uid: 'old' }, expect.anything(), undefined, expect.anything())
  })
  it('does not attribute retained ambient content to an edit without its capture', async () => {
    const f = hostFixture()
    const detail = await f.chat.projectRecordRevisionSnapshot({ record_uid: 'note', revision_uid: 'unknown', version: 3,
      edit_at: 1700000000000, content_payload: { media_refs: [{ file_asset_uid: 'retained-audio', content_file_role: 4 }] } }, target)
    expect(detail.backgroundSound).toBe('unknown')
    expect(detail.backgroundSoundPlayback).toBeUndefined()
    expect(f.media.hydrateRecordSnapshotMediaPage).not.toHaveBeenCalled()
  })
  it('keeps absent historical device and duration data unknown', async () => {
    const f = hostFixture()
    const detail = await f.chat.projectRecordRevisionSnapshot({ record_uid: 'note', revision_uid: 'old', edit_at: 1700000000000, text_content: '旧版' }, target)
    expect(detail.durationState).toBe('not-recorded')
    expect(detail.captureContext).toBeUndefined()
    expect(detail.editDurationMillis).toBeUndefined()
    expect(detail.startAtMillis).toBeUndefined()
    expect(detail.completeAtMillis).toBe(1700000000000)
  })
  it('ignores location enrichment without the selected revision identity', async () => {
    const f = hostFixture()
    f.runtime.authenticatedPost.mockResolvedValueOnce({ record_uid: 'note',
      location: { lat: 31, lon: 115 }, position_detail: { address: '当前地点' } } as never)
    const detail = await f.chat.projectRecordRevisionSnapshot({ record_uid: 'note', revision_uid: 'old',
      edit_at: 1700000000000, text_content: '旧版' }, target)
    expect(detail.locationCapture).toBeUndefined()
    expect(detail.locationLabel).toBeUndefined()
  })
  it('accepts location enrichment explicitly bound to the selected revision', async () => {
    const f = hostFixture()
    f.runtime.authenticatedPost.mockResolvedValueOnce({ record_uid: 'note', revision_uid: 'old',
      location: { lat: 30.1, lon: 114.2 }, position_detail: { address: '当时地点' } } as never)
    const detail = await f.chat.projectRecordRevisionSnapshot({ record_uid: 'note', revision_uid: 'old',
      edit_at: 1700000000000, text_content: '旧版' }, target)
    expect(detail.locationCapture).toMatchObject({ latitude: 30.1, longitude: 114.2 })
    expect(detail.locationLabel).toContain('当时地点')
  })
  it('keeps the human capture clock independent of server revision time', async () => {
    const f = hostFixture()
    const detail = await f.chat.projectRecordRevisionSnapshot({ record_uid: 'note', revision_uid: 'old', revision_type: 5, version: 1,
      edit_at: 1700000000000, record_started_at: 1700000001000, capture_context: { schema_version: 1, captured_at: 1700000001000 }, text_content: '旧版' }, target)
    expect(detail.startAtMillis).toBe(1700000001000)
    expect(detail.completeAtMillis).toBe(1700000001000)
  })
  it('rejects a mismatched message, location revision, or account change', async () => {
    const raw = { record_uid: 'note', revision_uid: 'old', edit_at: 1700000000000, text_content: '旧版' }
    const f = hostFixture()
    await expect(f.chat.projectRecordRevisionSnapshot({ ...raw, record_uid: 'another' }, target)).rejects.toThrow()
    f.runtime.authenticatedPost.mockResolvedValueOnce({ record_uid: 'note', revision_uid: 'new' } as never)
    await expect(f.chat.projectRecordRevisionSnapshot(raw, target)).rejects.toThrow()
    f.runtime.authenticatedPost.mockImplementationOnce(async () => { f.switchAccount(); return { record_uid: 'note' } })
    await expect(f.chat.projectRecordRevisionSnapshot(raw, target)).rejects.toThrow()
  })
})

describe('history card memory menu', () => {
  let view: ReactTestRenderer | undefined
  afterEach(() => { act(() => view?.unmount()); view = undefined })
  it('rejects a mismatched revision, supports retry, and closes on an account change', async () => {
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
    const snapshot = vi.fn().mockResolvedValueOnce({ revisionUid: 'wrong', textContent: '另一版本' })
      .mockResolvedValue({ revisionUid: 'wanted', itemUid: 'note', textContent: '正确版本', backgroundSound: 'not-recorded' })
    const reader = { page: vi.fn(), snapshot }
    const onClose = vi.fn()
    await act(async () => { view = create(<ArkmeRecordRevisionSnapshotDialog sourceRef="source" messageActionRef="action" reader={reader}
      mine senderName="我" onClose={onClose} revision={{ revisionUid: 'wanted', kind: 'manual', editAtMillis: 1700000000000,
        content: { title: '', textContent: '预览', contentBlocks: [] } }} />) })
    expect(JSON.stringify(view!.toJSON())).toContain('记忆快照与所选版本不一致')
    expect(JSON.stringify(view!.toJSON())).not.toContain('另一版本')
    await act(async () => view!.root.findAllByType('button').find(node => node.children.includes('重试快照'))!.props.onClick())
    expect(JSON.stringify(view!.toJSON())).toContain('正确版本')
    act(() => arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 43 }))
    expect(onClose).toHaveBeenCalledOnce()
  })
  it('opens the chosen version from each card and preserves the history on close', async () => {
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
    const reader: ArkmeRecordEditHistoryReader = {
      page: vi.fn(async () => ({ items: [
        { revisionUid: 'edit', kind: 'manual' as const, editAtMillis: 1700000001000, content: { title: '', textContent: '新版', contentBlocks: [] } },
        { revisionUid: 'original', kind: 'original' as const, editAtMillis: 1700000000000, content: { title: '', textContent: '旧版', contentBlocks: [] } },
      ], hasMore: false })),
      snapshot: vi.fn(async (_source, _action, revisionUid) => ({ revisionUid, itemUid: 'note', textContent: revisionUid,
        backgroundSound: 'not-recorded' as const, captureContext: { clientName: revisionUid === 'edit' ? '编辑设备' : '创建设备' } })),
    }
    await act(async () => { view = create(<ArkmeRecordEditHistory sourceRef="source" messageActionRef="action" reader={reader} author={{ isMe: true, senderName: '我' }} />) })
    for (const [index, expected] of ['编辑设备', '创建设备'].entries()) {
      act(() => view!.root.findAllByProps({ 'data-arkme-history-bubble': true })[index]!.props.onContextMenu({ preventDefault() {}, stopPropagation() {}, clientX: 1, clientY: 2 }))
      await act(async () => view!.root.findByProps({ role: 'menuitem', 'aria-label': '记忆快照' }).props.onClick())
      expect(JSON.stringify(view!.toJSON())).toContain(expected)
      act(() => view!.root.findAllByType('button').find(node => node.children.includes('关闭快照'))!.props.onClick())
      expect(view!.root.findAllByProps({ 'data-arkme-history-bubble': true })).toHaveLength(2)
    }
    expect(reader.snapshot).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(view!.toJSON())).not.toContain('查看此版全文')
    expect(JSON.stringify(view!.toJSON())).not.toContain('原始消息')
  })
})
