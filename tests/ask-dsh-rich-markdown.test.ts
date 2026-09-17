import { expect, it } from 'vitest'
import { prepareAskDshNotes } from '../src/client/ask-dsh-notes.js'
import type { ArkmeTimelineItem, ArkmeContentBlock } from '../src/types.js'
const file = (id: string, kind: ArkmeContentBlock['kind'] = 'file'): ArkmeContentBlock => ({ kind, fileAssetUid: id, originalRef: id, mediaRef: 'secret-preview', fileName: `${id}.dat`, size: 2048, mimeType: '', sortOrder: 0 })
const note = (extra: Partial<ArkmeTimelineItem> = {}): ArkmeTimelineItem => ({ itemUid: 'one', senderName: '客户备注', isMe: false, sendAtMillis: 1000, title: '标题', textContent: '正文', status: 1, contentBlocks: [], ...extra })
async function exportNote(item: ArkmeTimelineItem) {
  const reads: string[] = []
  const files = await prepareAskDshNotes([item], { detail: async () => { throw new Error('must use local data') }, original: async block => { reads.push(block.fileAssetUid!); return new Blob(['data']) } }, new AbortController().signal)
  return { text: await files[0]!.text(), files, reads }
}
it('keeps voice transcripts as body and adds mixed media metadata', async () => {
  const { text } = await exportNote(note({ templateKind: 4, textContent: '语音转写就是正文', contentBlocks: [{ ...file('audio', 'audio'), durationSec: 72 }, file('photo', 'image')] }))
  expect(text).toContain('类型：语音混合媒体快记')
  expect(text).toContain('音频时长：01:12')
  expect(text).toContain('语音转写就是正文')
  expect(text).not.toContain('### 语音转写')
  expect(text).toContain('audio.dat｜音频｜01:12｜2 KB')
})
it('exports forward ownership, segment times, truncation and deduplicated nested originals', async () => {
  const { text, files, reads } = await exportNote(note({ forwardRecords: { title: '汇总', createdAtMillis: 1000, summaryLines: ['摘要'], truncated: true, items: [
    { senderName: '原作者', sendAtMillis: 1000, title: '原消息', textContent: '原正文', contentBlocks: [file('shared')], truncated: true },
    { senderName: '录音作者', sendAtMillis: 1000, title: '录音', textContent: '', sourceType: 'long_recording_segments', segments: [{ speakerName: '说话人 2', textContent: '片段正文', startMillis: 12000, endMillis: 28000, contentBlocks: [file('shared')] }] },
  ] } }))
  for (const expected of ['原发送者：原作者', '原正文', '当前转发快照已截断', '此条原消息快照已截断', '00:12–00:28｜说话人：说话人 2', '片段正文', '### 原消息附件', '### 片段附件']) expect(text).toContain(expected)
  expect(reads).toEqual(['shared']); expect(files).toHaveLength(2)
  expect(text).not.toContain('secret-preview')
})
it('exports shared recording participants and local transcript or an explicit missing state', async () => {
  const shared = { sourceDigest: 'secret-digest', detailRef: 'secret-detail', sharedByUserId: 2, sharedAtMillis: 1000, displayAtMillis: 1000, endAtMillis: 2000, timeRangeText: '10:00–10:45', title: '会议', summary: '会议摘要', transcriptAvailable: false, participants: [{ displayName: '张工', role: 1 }] }
  const missing = await exportNote(note({ sharedRecording: shared }))
  expect(missing.text).toContain('转写未加载'); expect(missing.text).toContain('参与人：张工'); expect(missing.text).toContain('会议摘要'); expect(missing.text).not.toContain('secret-')
  const loaded = await exportNote(note({ sharedRecording: { ...shared, transcript: '张工：确认。', transcriptAvailable: true } }))
  expect(loaded.text).toContain('张工：确认。'); expect(loaded.text).not.toContain('转写未加载')
})
it('exports call, extension snapshot and distinct polish fields without reading parent attachments', async () => {
  const { text, reads } = await exportNote(note({ callRecord: { mediaType: 'audio', direction: 'outgoing', text: '已接通', startedAtMillis: 1000, durationSeconds: 332, summaryText: '通话摘要', callRef: 'secret-call' }, extensionParent: { itemUid: 'parent', senderName: '父作者', title: '父标题', textContent: '引用\n第二行', contentBlocks: [file('parent')] }, aiPolish: { state: 'polished', originalText: '原文', polishedText: '正文' } }))
  for (const value of ['通话方向：呼出', '通话时长：05:32', '通话摘要', '延展来源（已加载快照）', '> 引用\n> 第二行', '### 润色前原文', '原文', '未附原件']) expect(text).toContain(value)
  expect(text).not.toContain('### 已加载的润色结果'); expect(text).not.toContain('secret-call'); expect(reads).toEqual([])
})
it('preserves long Markdown and describes dynamic photos and stickers', async () => {
  const markdown = '# 标题\n\n| A | B |\n| - | - |\n| 1 | 2 |'
  const { text } = await exportNote(note({ displayKind: 1, textContent: markdown, contentBlocks: [{ ...file('photo', 'image'), dynamicPhoto: { logicalUid: 'live', motion: file('motion', 'video') as ArkmeContentBlock & { kind: 'video' } } }, { ...file('sticker', 'image'), renderRole: 3 }] }))
  expect(text).toContain('类型：长文'); expect(text).toContain(markdown)
  expect(text).toContain('动态照片「photo.dat」的运动视频'); expect(text).toContain('表情贴纸')
})
it('rejects missing nested originals instead of silently dropping them', async () => {
  await expect(exportNote(note({ forwardRecords: { title: '转发', createdAtMillis: 1000, summaryLines: [], items: [{ senderName: '作者', sendAtMillis: 1000, title: '', textContent: '', mediaUnavailable: true }] } }))).rejects.toThrow('附件清单')
})


it('maps embedded image references to the exported attachment filename', async () => {
  const { text } = await exportNote(note({ displayKind: 1, textContent: '![图片](arkme-asset:photo)', contentBlocks: [file('photo', 'image')] }))
  expect(text).toContain('![图片](photo.dat)')
  expect(text).not.toContain('arkme-asset:photo')
})
