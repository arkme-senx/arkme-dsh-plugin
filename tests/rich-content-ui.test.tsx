import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ArkmeAttachmentDraftTile, ArkmeMediaPreview, ArkmeMessageContent, ArkmeRecordDetailContent, arkmeContainedImageRect, arkmeImagePreviewAnchoredTop, arkmeImagePreviewDragTop, arkmeNextImagePreviewMode } from '../src/client/ArkmeRichContent.js'
import { ArkmeLongArticleDialog } from '../src/client/ArkmeLongArticleDialog.js'
import { ForwardRecordsDetail } from '../src/client/ArkmeNoteDetails.js'
import { arkmeClipboardImageFiles, arkmeShouldDismissAnchoredMenu } from '../src/client/ArkmeSidebar.js'

describe('Arkme rich content presentation', () => {
  it('gives every forwarded transcript segment its own avatar, including consecutive turns by the same speaker', () => {
    const html = renderToStaticMarkup(<ForwardRecordsDetail onClose={() => {}} item={{
      itemUid: 'forward-speakers', senderName: '转发者', isMe: true, sendAtMillis: 0, status: 1, title: '', textContent: '',
      forwardRecords: { title: '录音转写', createdAtMillis: 0, summaryLines: [], items: [{
        senderName: '录音作者', avatarRef: 'author-avatar', sendAtMillis: 0, title: '', textContent: '',
        segments: ['甲', '乙', '乙', '甲'].map((speakerName, index) => ({
          speakerName, textContent: `第${index + 1}段正文`, startMillis: index * 1000, endMillis: (index + 1) * 1000,
        })),
      }] },
    }} />)
    expect(html.match(/data-arkme-forward-segment="true"/gu)).toHaveLength(4)
    expect(html.match(/aria-label="转写说话人头像"/gu) ?? []).toHaveLength(4)
    expect(html).toContain('第4段正文')
    expect(html).not.toContain('<audio')
  })

  it('keeps recording detail text, speaker offsets and only authorized audio, including partial states', () => {
    const html = renderToStaticMarkup(<ForwardRecordsDetail onClose={() => {}} item={{
      itemUid: 'forward', senderName: '转发者', isMe: true, sendAtMillis: 0, status: 1, title: '', textContent: '',
      forwardRecords: { title: '录音转写', createdAtMillis: 0, summaryLines: [], truncated: true, items: [{
        senderName: '原作者', sendAtMillis: 0, title: '', textContent: '单独的摘要', sourceType: 'long_recording_segments',
        segments: [{ speakerName: '说话人甲', textContent: '完整片段'.repeat(100), startMillis: 60000, endMillis: 90000 }],
      }] },
    }} />)
    expect(html).toContain('单独的摘要')
    expect(html).toContain('完整片段'.repeat(100))
    expect(html).toContain('说话人甲')
    expect(html).toContain('01:00–01:30')
    expect(html).toContain('当前展示部分转发记录')
    expect(html).not.toContain('1970')
    expect(html).not.toContain('<audio')
    expect(html).not.toContain('data-arkme-text-collapsible')
    expect(html).toContain('width:min(372px, 100%)')
  })
  it('shows a single-line forward heading and at most three summary lines without a nested card shell', () => {
    const html = renderToStaticMarkup(<ArkmeMessageContent item={{
      itemUid: 'forward', senderName: '我', isMe: true, sendAtMillis: 1, status: 1, title: '', textContent: '',
      forwardRecords: { title: '会议讨论', createdAtMillis: 1, summaryLines: [], items: Array.from({ length: 4 }, (_, i) => ({
        senderName: '同事', sendAtMillis: 1, title: '', textContent: `摘要${i}`,
      })) },
    }} />)
    expect(html).toContain('摘要2')
    expect(html).not.toContain('摘要3')
    expect(html).toContain('white-space:nowrap')
    expect(html).toContain('font-size:14px')
    expect(html).not.toContain('border:1px solid')
    expect(html).not.toContain('background:')
  })

  it('keeps the complete text and article body readable in detail presentation', () => {
    const html = renderToStaticMarkup(<ArkmeMessageContent presentation="detail" item={{
      itemUid: 'article', senderName: '我', isMe: true, sendAtMillis: 1, status: 1,
      title: '长文标题', textContent: '完整正文'.repeat(100), displayKind: 1,
    }} />)
    expect(html).toContain('长文标题')
    expect(html).toContain('完整正文'.repeat(100))
    expect(html).not.toContain('data-arkme-long-article="preview"')
    expect(html).not.toContain('data-arkme-text-collapsible')
  })
  it('contains the whole image initially and exposes fixed-width zoom without horizontal overflow', () => {
    const image = { kind: 'image' as const, mediaRef: 'long-image-ref', fileName: 'long.png', mimeType: 'image/png', size: 1, sortOrder: 0 }
    const html = renderToStaticMarkup(<ArkmeMediaPreview blocks={[image]} selected={image} onSelect={() => undefined} onClose={() => undefined} />)
    expect(html).toContain('data-arkme-image-preview-viewport="true"')
    expect(html).toContain('data-arkme-image-preview-mode="contained"')
    expect(html).toContain('overflow-x:hidden')
    expect(html).toContain('overflow-y:hidden')
    expect(html).toContain('overscroll-behavior:contain')
    expect(html).toContain('width:100%;height:100%;overflow:hidden')
    expect(html).toContain('width:100%;height:100%;object-fit:contain')
    expect(html).toContain('title="双击铺满宽度"')
    expect(arkmeNextImagePreviewMode('contained')).toBe('width')
    expect(arkmeNextImagePreviewMode('width')).toBe('contained')
  })

  it('moves only the vertical viewport opposite to pointer drag and anchors width zoom at the double-click point', () => {
    expect(arkmeImagePreviewDragTop({ clientY: 500, scrollTop: 120 }, 300)).toBe(320)
    expect(arkmeImagePreviewAnchoredTop(0.75, 2400, 300)).toBe(1500)
    expect(arkmeImagePreviewAnchoredTop(-1, 2400, 300)).toBe(0)
  })

  it('matches the client contained scale for a portrait image without cropping', () => {
    expect(arkmeContainedImageRect(960, 720, 720, 3000)).toEqual({
      left: 393.6,
      top: 0,
      width: 172.79999999999998,
      height: 720,
    })
  })

  it('renders image, video, audio, file, and long-article content through local media refs', () => {
    const html = renderToStaticMarkup(<ArkmeMessageContent item={{
      itemUid: 'record-1', senderName: '我', isMe: true, sendAtMillis: 1, status: 1,
      title: '长文标题', textContent: '长文正文', displayKind: 1,
      contentBlocks: [
        { kind: 'image', mediaRef: 'image-ref', fileName: 'a.png', mimeType: 'image/png', size: 1, sortOrder: 0 },
        { kind: 'video', mediaRef: 'video-ref', fileName: 'a.mp4', mimeType: 'video/mp4', size: 2, sortOrder: 1 },
        { kind: 'audio', mediaRef: 'audio-ref', fileName: 'a.m4a', mimeType: 'audio/mp4', size: 3, sortOrder: 2 },
        { kind: 'file', mediaRef: 'file-ref', fileName: 'a.pdf', mimeType: 'application/pdf', size: 4, sortOrder: 3 },
      ],
    }} />)
    expect(html).toContain('长文标题')
    expect(html).toContain('长文正文')
    expect(html).toContain('/arkme-self/api/media?ref=image-ref')
    expect(html).toContain('<video')
    expect(html).toContain('<audio')
    expect(html).toContain('download="a.pdf"')
    expect(html).toContain('data-arkme-long-article="preview"')
    expect(html).toContain('data-arkme-long-article-inner="true"')
    expect(html).toContain('aria-label="查看长文 长文标题"')
    expect(html).not.toContain('background:rgba(127,127,127,.06)')
    expect(html).toContain('margin:8px 0 0')
    expect(html).toContain('<svg')
    expect(html).not.toContain('📝')
    expect(html).toContain('4字')
  })

  it('promotes an untitled long-article body to the heading without duplicating its preview', () => {
    const html = renderToStaticMarkup(<ArkmeMessageContent item={{
      itemUid: 'article-without-title', senderName: '我', isMe: true, sendAtMillis: 1, status: 1,
      title: '', textContent: '正文作为标题', templateKind: 8,
    }} />)
    expect(html).toContain('aria-label="查看长文 正文作为标题"')
    expect(html.match(/正文作为标题/gu)).toHaveLength(2)
    expect(html).toContain('6字')
    expect(html).not.toContain('</p>')
  })

  it('keeps short text content-sized without a shared minimum width', () => {
    const html = renderToStaticMarkup(<ArkmeMessageContent item={{
      itemUid: 'short', senderName: '我', isMe: true, sendAtMillis: 1, status: 1,
      title: '', textContent: '测试',
    }} />)
    expect(html).toContain('测试')
    expect(html).not.toContain('min-width:180')
    expect(html).toContain('width:max-content')
    expect(html).not.toContain('data-arkme-text-collapsible')
  })

  it('highlights visible member mentions only when the conversation enables mention rendering', () => {
    const item = {
      itemUid: 'mention-visible', senderName: '我', isMe: true, sendAtMillis: 1, status: 1,
      title: '', textContent: '@小林 处理一下',
    }
    const plainHtml = renderToStaticMarkup(<ArkmeMessageContent item={item} />)
    expect(plainHtml).toContain('@小林 处理一下')
    expect(plainHtml).not.toContain('--dsw-alias-state-business-primary')

    const highlightedHtml = renderToStaticMarkup(<ArkmeMessageContent item={item} highlightMentions />)
    expect(highlightedHtml).toContain('<span style="color:var(--dsw-alias-state-business-primary, #3964fe)">@小林</span>')
    expect(highlightedHtml).toContain(' 处理一下')
  })

  it('shows a precise fallback when record media delivery is temporarily unavailable', () => {
    const html = renderToStaticMarkup(<ArkmeMessageContent item={{
      itemUid: 'media-unavailable', senderName: '我', isMe: true, sendAtMillis: 1, status: 1,
      title: '', textContent: '', contentBlocks: [], mediaUnavailable: true,
    }} />)
    expect(html).toContain('媒体暂时无法加载')
    expect(html).not.toContain('暂不支持的非文本内容')
  })

  it('collapses desktop long text to five lines but leaves emoji-only text expanded', () => {
    const longHtml = renderToStaticMarkup(<ArkmeMessageContent item={{
      itemUid: 'long', senderName: '我', isMe: true, sendAtMillis: 1, status: 1,
      title: '', textContent: '长'.repeat(301),
    }} />)
    expect(longHtml).toContain('data-arkme-text-collapsible="true"')
    expect(longHtml).toContain('-webkit-line-clamp:5')
    expect(longHtml).toContain('aria-expanded="false"')
    expect(longHtml).toContain('展开')
    expect(longHtml).toContain('color:var(--dsw-alias-label-tertiary, #9097a1)')
    expect(longHtml).not.toContain('--dsw-alias-state-business-primary')

    const emojiHtml = renderToStaticMarkup(<ArkmeMessageContent item={{
      itemUid: 'emoji', senderName: '我', isMe: true, sendAtMillis: 1, status: 1,
      title: '', textContent: '😀'.repeat(301),
    }} />)
    expect(emojiHtml).not.toContain('data-arkme-text-collapsible')

    const arkmeEmojiHtml = renderToStaticMarkup(<ArkmeMessageContent item={{
      itemUid: 'arkme-emoji', senderName: '我', isMe: true, sendAtMillis: 1, status: 1,
      title: '', textContent: '[jm_emoji:angry_face]'.repeat(301),
    }} />)
    expect(arkmeEmojiHtml).not.toContain('data-arkme-text-collapsible')
    expect(arkmeEmojiHtml).toContain('data-arkme-rich-emoji="angry_face"')
    expect(arkmeEmojiHtml).toContain('data:image/svg+xml;base64,')
    expect(arkmeEmojiHtml).not.toContain('[jm_emoji:angry_face]')
  })

  it.each([
    { count: 1, columns: 1 },
    { count: 2, columns: 2 },
    { count: 4, columns: 2 },
    { count: 5, columns: 3 },
    { count: 10, columns: 3 },
  ])('uses the desktop media grid for $count ordered visual blocks', ({ count, columns }) => {
    const html = renderToStaticMarkup(<ArkmeMessageContent item={{
      itemUid: `media-${String(count)}`, senderName: '我', isMe: true, sendAtMillis: 1, status: 1,
      title: '', textContent: '',
      contentBlocks: Array.from({ length: count }, (_, index) => ({
        kind: index === 1 ? 'video' as const : 'image' as const,
        mediaRef: `ref-${String(index)}`, fileName: `${String(index)}.png`, mimeType: 'image/png', size: 1, sortOrder: index,
      })),
    }} />)
    expect(html).toContain(`data-arkme-media-count="${String(count)}"`)
    expect(html).toContain(`data-arkme-media-columns="${String(columns)}"`)
    if (count > 1) expect(html.indexOf('ref-0')).toBeLessThan(html.indexOf(`ref-${String(count - 1)}`))
  })

  it('renders compact audio and two-line file cards independently of text width', () => {
    const html = renderToStaticMarkup(<ArkmeMessageContent item={{
      itemUid: 'compact', senderName: '我', isMe: true, sendAtMillis: 1, status: 1,
      title: '', textContent: '短', contentBlocks: [
        { kind: 'audio', mediaRef: 'voice-ref', fileName: 'voice.m4a', mimeType: 'audio/mp4', size: 3, durationSec: 65, sortOrder: 0 },
        { kind: 'file', mediaRef: 'file-ref', fileName: '非常长的文件名称需要显示两行然后省略.pdf', mimeType: 'application/pdf', size: 4, sortOrder: 1 },
      ],
    }} />)
    expect(html).toContain('data-arkme-voice="inline"')
    expect(html).toContain('1:05')
    expect(html).not.toContain('data-arkme-voice-transcript')
    expect(html).toContain('data-arkme-file-card="file"')
    expect(html).toContain('-webkit-line-clamp:2')
  })

  it.each([3, 4])('places voice kind %s before its transcript, with no separate player plate or duplicate text', (templateKind) => {
    const html = renderToStaticMarkup(<ArkmeMessageContent item={{
      itemUid: 'voice', senderName: 'lucis', isMe: false, sendAtMillis: 1, status: 1,
      templateKind, title: '', textContent: '123456。', recordDurationMillis: 2_000,
      contentBlocks: [{ kind: 'audio', mediaRef: 'voice-ref', fileName: 'voice.m4a', mimeType: 'audio/mp4', size: 3, sortOrder: 0 }],
    }} />)
    expect(html).toContain('data-arkme-voice="inline"')
    expect(html).toContain('0:02')
    expect(html.match(/123456。/gu)).toHaveLength(1)
    expect(html.indexOf('0:02')).toBeLessThan(html.indexOf('123456。'))
    expect(html).not.toMatch(/<p(?:\s|>)/u)
    expect(html).not.toContain('••')
    expect(html).not.toContain('width:188px')
    expect(html).not.toContain('border-radius')
  })

  it('keeps generic audio attachments separate from unrelated body text', () => {
    const html = renderToStaticMarkup(<ArkmeMessageContent item={{
      itemUid: 'attachment', senderName: 'lucis', isMe: false, sendAtMillis: 1, status: 1,
      templateKind: 2, title: '', textContent: '附件说明', recordDurationMillis: 42_000,
      contentBlocks: [{ kind: 'audio', mediaRef: 'music-ref', fileName: 'music.mp3', mimeType: 'audio/mpeg', size: 3, sortOrder: 0 }],
    }} />)
    expect(html).not.toContain('data-arkme-voice-transcript')
    expect(html).toContain('--:--')
    expect(html).not.toContain('0:42')
  })

  it.each([3, 4])('renders voice kind %s details while preserving original/polished text selection', (templateKind) => {
    const item = {
      itemUid: 'voice', senderName: 'lucis', isMe: false, sendAtMillis: 1, status: 1,
      templateKind, title: '', textContent: '原始正文',
      aiPolish: { state: 'polished' as const, originalText: '原文'.repeat(200), polishedText: '润色'.repeat(200) },
      contentBlocks: [{ kind: 'audio' as const, mediaRef: 'voice-ref', fileName: 'voice.m4a', mimeType: 'audio/mp4', size: 3, durationSec: 2, sortOrder: 0 }],
    }
    for (const showOriginal of [false, true]) {
      const html = renderToStaticMarkup(<ArkmeRecordDetailContent item={item} showOriginal={showOriginal} />)
      expect(html).toContain('data-arkme-voice="inline"')
      expect(html).toContain((showOriginal ? '原文' : '润色').repeat(200))
      expect(html).not.toContain('-webkit-line-clamp')
      expect(html).not.toContain(showOriginal ? '润色' : '原文')
    }
  })

  it('renders composer attachments as square Jotmo-style preview tiles', () => {
    const fileHtml = renderToStaticMarkup(<ArkmeAttachmentDraftTile
      asset={{ fileAssetUid: 'pdf-asset', fileName: '如何查看微信接收的文件.pdf', mimeType: 'application/pdf', size: 4, fileKind: 4 }}
      onRemove={() => undefined}
    />)
    expect(fileHtml).toContain('data-arkme-attachment-tile="file-icon"')
    expect(fileHtml).toContain('data-arkme-file-type="PDF"')
    expect(fileHtml).toContain('width:48px;height:48px')
    expect(fileHtml).toContain('title="如何查看微信接收的文件.pdf"')
    expect(fileHtml).toContain('aria-label="移除如何查看微信接收的文件.pdf"')

    const imageHtml = renderToStaticMarkup(<ArkmeAttachmentDraftTile
      asset={{ fileAssetUid: 'image-asset', fileName: 'clipboard.png', mimeType: 'image/png', size: 8, fileKind: 1 }}
      previewUrl="blob:clipboard-preview"
      onRemove={() => undefined}
    />)
    expect(imageHtml).toContain('data-arkme-attachment-tile="image-preview"')
    expect(imageHtml).toContain('src="blob:clipboard-preview"')
  })

  it('extracts clipboard images without consuming text-only clipboard content', () => {
    const image = new File(['image'], 'clipboard.png', { type: 'image/png' })
    const text = new File(['text'], 'clipboard.txt', { type: 'text/plain' })
    const clipboardWithImage = {
      items: [
        { kind: 'string', getAsFile: () => null },
        { kind: 'file', getAsFile: () => text },
        { kind: 'file', getAsFile: () => image },
      ],
      files: [],
    } as unknown as Pick<DataTransfer, 'files' | 'items'>
    expect(arkmeClipboardImageFiles(clipboardWithImage)).toEqual([image])

    const textOnlyClipboard = {
      items: [{ kind: 'string', getAsFile: () => null }],
      files: [],
    } as unknown as Pick<DataTransfer, 'files' | 'items'>
    expect(arkmeClipboardImageFiles(textOnlyClipboard)).toEqual([])
  })

  it('dismisses the add menu only for pointer targets outside both menu and trigger', () => {
    const insideMenu = {} as Node
    const insideTrigger = {} as Node
    const outside = {} as Node
    const menu = { contains: (target: Node | null) => target === insideMenu }
    const trigger = { contains: (target: Node | null) => target === insideTrigger }

    expect(arkmeShouldDismissAnchoredMenu(insideMenu, menu, trigger)).toBe(false)
    expect(arkmeShouldDismissAnchoredMenu(insideTrigger, menu, trigger)).toBe(false)
    expect(arkmeShouldDismissAnchoredMenu(outside, menu, trigger)).toBe(true)
    expect(arkmeShouldDismissAnchoredMenu(null, menu, trigger)).toBe(false)
    expect(arkmeShouldDismissAnchoredMenu(insideMenu, menu, null)).toBe(false)
    expect(arkmeShouldDismissAnchoredMenu(outside, menu, null)).toBe(true)
  })

  it('renders a separate long-article composer with title, body, timer, count, and publish action', () => {
    const html = renderToStaticMarkup(<ArkmeLongArticleDialog sourceRef="source-1" onClose={() => undefined} />)
    expect(html).toContain('data-arkme-long-article-dialog="create"')
    expect(html).toContain('placeholder="请输入标题"')
    expect(html).toContain('placeholder="请输入正文内容"')
    expect(html).toContain('0秒')
    expect(html).toContain('0字')
    expect(html).toContain('发布')
  })

  it('recognizes the Jotmo template-8 article contract without a legacy display kind', () => {
    const html = renderToStaticMarkup(<ArkmeMessageContent item={{
      itemUid: 'article-8', senderName: '我', isMe: true, sendAtMillis: 1, status: 1,
      title: '模板长文', textContent: '正文', templateKind: 8,
    }} />)
    expect(html).toContain('data-arkme-message-content="article"')
    expect(html).toContain('data-arkme-long-article="preview"')
  })
})
