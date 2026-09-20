import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ArkmeMessageContent } from '../src/client/ArkmeRichContent.js'
import type { ArkmeTimelineItem } from '../src/types.js'

it.each(['bubble', 'detail', 'voice'] as const)('renders Bot prose as Markdown in %s while preserving human plain text', presentation => {
  for (const [senderKind, textFormat] of [['bot', 'plain'], ['human', 'plain'], ['human', 'markdown']] as const) {
    const item = { itemUid: 'note', senderName: '作者', senderKind, isMe: false, sendAtMillis: 1,
      textContent: '## 标题\n\n**重点** 和 `topic_uid`', title: '', status: 1, textFormat, ...(presentation === 'voice' ? { templateKind: 3, contentBlocks: [{ kind: 'audio' as const, mediaRef: 'opaque-audio', sortOrder: 0, fileName: 'voice.mp3', mimeType: 'audio/mpeg', durationSec: 3 }] } : {}) } satisfies ArkmeTimelineItem
    const html = renderToStaticMarkup(<ArkmeMessageContent item={item} presentation={presentation === 'voice' ? 'detail' : presentation} collapseText={false} />)
    expect(html.includes('<h2>')).toBe(senderKind === 'bot' || textFormat === 'markdown')
    expect(/<strong(?:\s|>)/.test(html)).toBe(senderKind === 'bot' || textFormat === 'markdown')
    expect(item.textFormat).toBe(textFormat)
    expect(item.textContent).toBe('## 标题\n\n**重点** 和 `topic_uid`')
  }
})


it.each(['bubble', 'detail'] as const)('does not reinterpret a title-only Bot record in %s', presentation => {
  const item = { itemUid: 'title-only', senderName: 'Bot', senderKind: 'bot', isMe: false, sendAtMillis: 1,
    textContent: '', title: '**原始标题**', status: 1, textFormat: 'plain' } satisfies ArkmeTimelineItem
  const html = renderToStaticMarkup(<ArkmeMessageContent item={item} presentation={presentation} collapseText={false} />)
  expect(html).toContain('**原始标题**')
  expect(html).not.toContain('data-arkme-text-format="markdown"')
})
