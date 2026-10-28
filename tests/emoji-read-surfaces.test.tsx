import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { ArkmeArkoRow, ArkmeDirectoryRow, ArkmeTopicCard } from '../src/client/ArkmeVirtualWorkspace.js'
import { RecordRow } from '../src/client/ArkmeSearchSurface.js'
import { ArkmeMessageSnapshotDialogContent } from '../src/client/ArkmeMessageSnapshotDialog.js'
import { previewText } from '../src/share-link-preview.js'
import type { ArkmeSearchRecordItem, ArkmeTimelineItem } from '../src/types.js'

const text = '文字 [im_emoji:yummy_face] [jm_emoji:thumb_up] 😊 [im_emoji:unknown] https://example.com'
const noop = () => {}
const item: ArkmeTimelineItem = { itemUid: 'emoji-record', senderName: '我', isMe: true, sendAtMillis: 1, title: '', textContent: text, status: 1 }

const surfaces = [
  ['directory contribution', () => <ArkmeDirectoryRow avatar={null} title="会话" preview={text} selected={false} onClick={noop} />],
  ['AI directory', () => <ArkmeArkoRow selected={false} latestPreview={text} onClick={noop} />],
  ['topic directory', () => <ArkmeTopicCard source={{sourceRef:'topic',kind:'topic',displayName:'主题',activeAtMillis:0,unreadCount:0,latestPreview:text}} selected={false} hovered={false} onHoverChange={noop} onSelect={noop} actions={null} />],
  ['message snapshot', () => <ArkmeMessageSnapshotDialogContent item={item} />],
  ...([1, 3, 4] as const).map(sourceKind => [`search source ${sourceKind}`, () => <RecordRow item={{recordUid:'emoji',sourceKind,sendAtMillis:1,title:'快记',textContent:text,snippet:text,media:[],files:[]} as ArkmeSearchRecordItem} onClick={noop} />] as const),
] as const

it.each(surfaces)('%s renders legacy and current emoji without turning preview URLs into controls', (_name, render) => {
  const markup = renderToStaticMarkup(render())
  expect(markup).toContain('data-arkme-rich-emoji="yummy_face"')
  expect(markup).toContain('data-arkme-rich-emoji="thumb_up"')
  expect(markup).not.toContain('[im_emoji:yummy_face]')
  expect(markup).not.toContain('[jm_emoji:thumb_up]')
  expect(markup).toContain('[im_emoji:unknown]')
  expect(markup).toContain('😊')
  expect(markup).not.toContain('<a ')
})

it('does not cut a share preview in the middle of an emoji token or Unicode grapheme', () => {
  expect(previewText('正文[im_emoji:yummy_face]结束', 8)).toBe('正文…')
  expect(previewText('[jm_emoji:thumb_up]', 30)).toBe('[jm_emoji:thumb_up]')
  expect(previewText('A👨‍👩‍👧‍👦B', 4)).toBe('A…')
})
