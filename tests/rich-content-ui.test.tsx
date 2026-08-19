import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ArkmeAttachmentDraftTile, ArkmeMediaPreview, ArkmeMessageContent, arkmeImagePreviewDragPosition, arkmeNextImagePreviewScale } from '../src/client/ArkmeRichContent.js'
import { ArkmeLongArticleDialog } from '../src/client/ArkmeLongArticleDialog.js'
import { arkmeClipboardImageFiles } from '../src/client/ArkmeSidebar.js'

describe('Arkme rich content presentation', () => {
  it('keeps the preview scrollable at 1x so portrait images preserve their natural height', () => {
    const image = { kind: 'image' as const, mediaRef: 'long-image-ref', fileName: 'long.png', mimeType: 'image/png', size: 1, sortOrder: 0 }
    const html = renderToStaticMarkup(<ArkmeMediaPreview blocks={[image]} selected={image} onSelect={() => undefined} onClose={() => undefined} />)
    expect(html).toContain('data-arkme-image-preview-viewport="true"')
    expect(html).toContain('data-arkme-image-preview-scale="1"')
    expect(html).toContain('overflow:auto')
    expect(html).toContain('overscroll-behavior:contain')
    expect(html).toContain('width:100%;min-height:100%')
    expect(html).toContain('width:100%;height:auto')
    expect(html).toContain('title="双击放大图片"')
    expect(arkmeNextImagePreviewScale(1)).toBe(2)
    expect(arkmeNextImagePreviewScale(2)).toBe(1)
  })

  it('moves a scrollable image viewport opposite to the pointer drag at any scale', () => {
    expect(arkmeImagePreviewDragPosition({ clientX: 400, clientY: 500, scrollLeft: 80, scrollTop: 120 }, 340, 300))
      .toEqual({ left: 140, top: 320 })
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
    expect(html).toContain('background:rgba(127,127,127,.06)')
    expect(html).toContain('margin:4px 0 0 22px')
    expect(html).toContain('margin:8px 0 0 22px')
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

    const jotmoEmojiHtml = renderToStaticMarkup(<ArkmeMessageContent item={{
      itemUid: 'jotmo-emoji', senderName: '我', isMe: true, sendAtMillis: 1, status: 1,
      title: '', textContent: '[jm_emoji:angry_face]'.repeat(301),
    }} />)
    expect(jotmoEmojiHtml).not.toContain('data-arkme-text-collapsible')
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
    expect(html).toContain('data-arkme-audio="compact"')
    expect(html).toContain('01:05')
    expect(html).toContain('data-arkme-file-card="file"')
    expect(html).toContain('-webkit-line-clamp:2')
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
