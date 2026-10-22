import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatService } from '../src/services/chat-service.js'
import type { ArkmeRecordingWorkbenchItem, ArkmeTimelineItem } from '../src/types.js'
const mocks = vi.hoisted(() => ({ call: vi.fn(), copy: vi.fn() }))
vi.mock('../src/client/api.js', async original => ({ ...await original<typeof import('../src/client/api.js')>(), callArkme: mocks.call }))
vi.mock('../src/client/clipboard-text.js', () => ({ copyText: mocks.copy }))
import { RecordingTranscriptSelectionBar } from '../src/client/recordings/RecordingTranscriptSelectionBar.js'
const RecordingTranscriptCopyLink = (props: { items: ArkmeRecordingWorkbenchItem[]; scope: string; onNotice(text: string): void }) => <RecordingTranscriptSelectionBar {...props} playing={false} onCopy={() => {}} onPlay={() => {}} onForward={() => {}} onExit={() => {}} />
import { CopyLinkSnapshotContent } from '../src/client/CopyLinkSnapshotContent.js'

const item = (id = 'one', sessionKey = 'session') => ({ itemId: id, itemRef: `sealed-${id}`, sessionKey, transcriptSource: 'system' }) as ArkmeRecordingWorkbenchItem
const result = { sid: 'abcdefghijklmnop', url: 'https://jotmo.com/s/abcdefghijklmnop' }
let renderer: ReactTestRenderer
beforeEach(() => { mocks.call.mockReset(); mocks.copy.mockReset(); mocks.call.mockResolvedValue(result); mocks.copy.mockResolvedValue(undefined) })
afterEach(async () => { await act(async () => renderer?.unmount()) })
const button = () => renderer.root.findAllByType('button').find(button => ['复制链接', '已复制链接', '正在生成…'].includes(button.props['aria-label']))!

describe('recording copy-link interaction', () => {
  it('copies the common result and reuses it after a clipboard failure', async () => {
    const notice = vi.fn(); mocks.copy.mockRejectedValueOnce(new Error('denied'))
    await act(async () => { renderer = create(<RecordingTranscriptCopyLink items={[item()]} scope="prod:42:day" onNotice={notice} />) })
    await act(async () => button().props.onClick({ currentTarget: null }))
    expect(notice).toHaveBeenLastCalledWith('链接已生成，剪贴板写入失败，请再次点击复制链接')
    await act(async () => button().props.onClick({ currentTarget: null }))
    expect(mocks.call).toHaveBeenCalledTimes(1)
    expect(mocks.call).toHaveBeenCalledWith('recordings.copy-link', { itemRefs: ['sealed-one'] }, expect.any(AbortSignal))
    expect(mocks.copy).toHaveBeenLastCalledWith(result.url)
    expect(button().props['aria-label']).toBe('已复制链接')
  })
  it('keeps a failed selection retryable and disables invalid cross-session selections', async () => {
    const notice = vi.fn(); mocks.call.mockRejectedValueOnce(new Error('审核未通过'))
    await act(async () => { renderer = create(<RecordingTranscriptCopyLink items={[item()]} scope="prod:42:day" onNotice={notice} />) })
    await act(async () => button().props.onClick({ currentTarget: null }))
    expect(notice).toHaveBeenLastCalledWith('审核未通过'); expect(button().props.disabled).toBe(false)
    expect(mocks.copy).not.toHaveBeenCalled()
    await act(async () => renderer.update(<RecordingTranscriptCopyLink items={[item(), item('two', 'other')]} scope="prod:42:day" onNotice={notice} />))
    expect(button().props.disabled).toBe(true)
  })
  it.each(['selection', 'account', 'unmount'])('ignores a late response after %s changes and prevents duplicate clicks', async kind => {
    let resolve!: (value: typeof result) => void
    mocks.call.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const notice = vi.fn()
    await act(async () => { renderer = create(<RecordingTranscriptCopyLink items={[item()]} scope="prod:42:day" onNotice={notice} />) })
    await act(async () => { button().props.onClick({ currentTarget: null }); button().props.onClick({ currentTarget: null }) })
    expect(mocks.call).toHaveBeenCalledTimes(1)
    await act(async () => { if (kind === 'unmount') renderer.unmount(); else renderer.update(<RecordingTranscriptCopyLink items={[item(kind === 'selection' ? 'two' : 'one')]} scope={kind === 'account' ? 'prod:43:day' : 'prod:42:day'} onNotice={notice} />) })
    await act(async () => { resolve(result) })
    expect(mocks.copy).not.toHaveBeenCalled()
  })
})

describe('recording copy-link read projection', () => {
  const raw = () => ({ sid: result.sid, access_mode: 'link_read_only', display_title: '录音片段', generated_at: 1788490000000,
    items: [{ sender_display_name: '分享人', send_at: 1788490000000, template_kind: 5, title: '录音片段', text_content: '不应重复显示的摘要',
      structured_content: { structured_kind: 1, duration_millis: 12000, long_recording_segments: [
        { speaker_number: 0, speaker_label: '甲', text: '第一句完整原文', start_millis: 1428000, end_millis: 1438000 },
        { speaker_number: 1, speaker_label: '乙', text: '第二句完整原文', start_millis: 1601000, end_millis: 1603000 },
      ] }, media_items: [] }], presentation: [{ kind: 'item', item_index: 0 }],
  })
  function reader(data: ReturnType<typeof raw>) {
    const post = vi.fn(async () => data)
    const media = { forwardContentBlocks: vi.fn(() => []) }
    const service = new ChatService({ requireSession: async () => ({ userId: 42 }), authenticatedChatPost: post } as never, {} as never, {} as never, media as never, {} as never, {} as never, {} as never, {} as never, {} as never)
    return { service, post }
  }
  it('retains only authorized segments and renders their speakers and offsets in the common detail', async () => {
    const { service, post } = reader(raw())
    const detail = await service.resolveMessageCopyLink(result.sid)
    const shared = detail.items[0]!
    expect(shared.structuredContent?.longRecordingSegments).toHaveLength(2)
    const html = renderToStaticMarkup(<CopyLinkSnapshotContent item={shared} snapshot={{ itemUid: 'snapshot', textContent: shared.textContent, title: shared.title } as ArkmeTimelineItem} shareWebsite="https://jotmo.com" />)
    expect(html).toContain('第一句完整原文'); expect(html).toContain('第二句完整原文'); expect(html).toContain('00:23:48')
    expect(html).not.toContain('不应重复显示的摘要'); expect(html).toContain('甲'); expect(html).toContain('乙')
    expect(post).toHaveBeenCalledTimes(1)
  })
  it('rejects malformed segment ranges instead of showing invented timestamps', async () => {
    const data = raw(); data.items[0]!.structured_content.long_recording_segments[0]!.end_millis = -1
    await expect(reader(data).service.resolveMessageCopyLink(result.sid)).rejects.toThrow()
  })
})
