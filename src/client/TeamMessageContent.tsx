import { useEffect, useState } from 'react'
import type { ArkmeContentBlock, ArkmeTimelineItem } from '../types.js'
import type { TeamMessage } from '../team-app-contract.js'
import { callArkme } from './api.js'
import { ArkmeMessageContent } from './ArkmeRichContent.js'
import { ArkmeMediaAccessContext } from './media-access.js'
import { teamText as tr } from './team-messaging-i18n.js'

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
  const [grant, setGrant] = useState<{key:string;urls:Map<string,string>}>(), [error, setError] = useState(''), [attempt, setAttempt] = useState(0)
  const refsKey = JSON.stringify(message.media.map(media => media.ref))
  useEffect(() => {
    const controller = new AbortController()
    setGrant(undefined); setError('')
    void Promise.all((JSON.parse(refsKey) as string[]).map(async ref => {
      const result = await callArkme<{ url: string }>('team.app.media', { mediaRef: ref }, controller.signal)
      if (!result.url || typeof result.url !== 'string') throw new Error(tr('附件暂不可用'))
      return [ref, result.url] as const
    })).then(values => { if (!controller.signal.aborted) setGrant({key:refsKey,urls:new Map(values)}) })
      .catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : tr('附件暂不可用')) })
    return () => controller.abort()
  }, [refsKey, attempt])
  const urls = grant?.key === refsKey ? grant.urls : undefined
  const item = teamMessagePresentation(message)
  if (message.media.length > 0 && !urls) return <>
    {item.textContent && <ArkmeMessageContent item={{ ...item, contentBlocks: [] }} mediaSelectionIsExplicit />}
    {error ? <p role="alert">{error} <button onClick={() => setAttempt(value => value + 1)}>{tr('重试')}</button></p> : <span role="status">{tr('正在读取…')}</span>}
  </>
  return <ArkmeMediaAccessContext.Provider value={{ url: block => urls?.get(block.mediaRef) ?? '' }}>
    <ArkmeMessageContent sessionAttachmentPreview item={item} sourceIdentityKey={message.key} mediaSelectionIsExplicit />
  </ArkmeMediaAccessContext.Provider>
}
