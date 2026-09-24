import { useRef } from 'react'
import type { ArkmeContentBlock, ArkmeTimelineItem } from '../types.js'
import type { TeamMessage } from '../team-app-contract.js'
import { ArkmeMessageContent } from './ArkmeRichContent.js'
import { ArkmeMediaAccessContext } from './media-access.js'

export function teamMessagePresentation(message: TeamMessage): ArkmeTimelineItem {
  return {
    itemUid: message.key, senderName: message.sender.nickname, isMe: message.own,
    sendAtMillis: message.createdAt, title: message.content?.title ?? '',
    textFormat: message.content?.content_payload?.text_format === 'markdown' ? 'markdown' : 'plain',
    textContent: message.content?.text_content ?? '', status: message.state === 'published' ? 1 : 2,
    version: message.version, templateKind: message.content?.template_kind ?? 1,
    contentBlocks: message.media.map((media, sortOrder): ArkmeContentBlock => ({
      kind: media.mimeType.startsWith('image/') ? 'image' : media.mimeType.startsWith('video/') ? 'video' : media.mimeType.startsWith('audio/') ? 'audio' : 'file',
      mediaRef: media.ref, fileName: media.name, mimeType: media.mimeType, size: media.size, sortOrder,
    })),
  }
}

/** Only presentation is shared. URL grants and every byte read remain Team-scoped. */
export function TeamMessageContent({ message }: { message: TeamMessage }) {
  // Keep mounted media and its URL across equivalent authorized snapshots.
  // Keys include viewer, message, Record version and asset. Changed content or
  // lost access replaces/unmounts this scope; byte reads still reauthorize.
  const identity = JSON.stringify([message.key, message.version, message.media.map(media => media.key)])
  const snapshot = useRef({ identity, media: message.media })
  if (snapshot.current.identity !== identity) snapshot.current = { identity, media: message.media }
  const urls = new Map(snapshot.current.media.map(media => [media.ref, media.url]))
  const item = teamMessagePresentation({ ...message, media: snapshot.current.media })
  return <ArkmeMediaAccessContext.Provider value={{ url: block => urls.get(block.mediaRef) ?? '' }}>
    <ArkmeMessageContent sessionAttachmentPreview item={item} sourceIdentityKey={message.key} mediaSelectionIsExplicit />
  </ArkmeMediaAccessContext.Provider>
}
