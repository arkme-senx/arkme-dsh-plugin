import {watchTeamSourceRead} from './team-source-read.js'
import {arkmeAuthStore} from './auth-store.js'
import { useRef, type ReactNode } from 'react'
import type { ArkmeContentBlock, ArkmeTimelineItem } from '../types.js'
import type { TeamMessage } from '../team-app-contract.js'
import { ArkmeMessageContent } from './ArkmeRichContent.js'
import { ArkmeMediaAccessContext,type ArkmeMediaAccess } from './media-access.js'

export function teamMessagePresentation(message: TeamMessage): ArkmeTimelineItem {
  return {
    itemUid: message.key, senderName: message.sender.nickname, isMe: message.own,
    sendAtMillis: message.createdAt, title: message.content?.title ?? '',
    textFormat: message.content?.content_payload?.text_format === 'markdown' ? 'markdown' : 'plain',
    mentions:(message.content?.mentions ?? []).map(m=>({kind:'member',startIndex:m.startIndex,length:m.length,displayName:m.displayName})), textContent: message.content?.text_content ?? '', status: message.state === 'published' ? 1 : 2,
    version: message.version, recordVersion: message.version, templateKind: message.content?.template_kind ?? 1,
    ...(message.forwardRecords?{forwardRecords:message.forwardRecords}:{}),
    contentBlocks: (message.forwardRecords?[]:message.media).map((media, sortOrder): ArkmeContentBlock => ({
      kind: media.mimeType.startsWith('image/') ? 'image' : media.mimeType.startsWith('video/') ? 'video' : media.mimeType.startsWith('audio/') ? 'audio' : 'file',
      mediaRef: media.ref, fileName: media.name, mimeType: media.mimeType, size: media.size, sortOrder,
    })),
  }
}

/** Only presentation is shared. URL grants and every byte read remain Team-scoped. */
export function TeamMessageContent({ message, conversationRef, presentation, onOpenArticle, conversationKey, readOnly = false }: { readOnly?:boolean; conversationKey?:string | undefined; message: TeamMessage; conversationRef?: string | undefined; presentation?: 'detail'; onOpenArticle?: (()=>void) | undefined }) {
  // Keep mounted media and its URL across equivalent authorized snapshots.
  // Keys include viewer, message, Record version and asset. Changed content or
  // lost access replaces/unmounts this scope; byte reads still reauthorize.
  const identity = JSON.stringify([message.key, message.version, message.contentStatus, message.content, message.media.map(media => media.key)])
  const snapshot = useRef({ identity, media: message.media, localMarkRef: message.localMarkRef })
  if (snapshot.current.identity !== identity) snapshot.current = { identity, media: message.media, localMarkRef: message.localMarkRef }
  const urls = new Map(snapshot.current.media.map(media => [media.ref, media.url]))
  const item = teamMessagePresentation({ ...message, media: snapshot.current.media })
  return <ArkmeMediaAccessContext.Provider value={teamMessageMediaAccess(message,urls,conversationRef,conversationKey)}>
    <ArkmeMessageContent sessionAttachmentPreview item={item} sourceIdentityKey={message.key} mediaSelectionIsExplicit {...(onOpenArticle ? {onArticleOpen:onOpenArticle} : {})} {...(presentation ? { presentation } : {})}
      selectionTarget={!readOnly && conversationRef && snapshot.current.localMarkRef && message.state === 'published' && message.contentStatus === 'available'
        ? { item, sourceRef: conversationRef, localMarkRef: snapshot.current.localMarkRef,cloudMarkRef:message.ref } : undefined} />
  </ArkmeMediaAccessContext.Provider>
}

export function teamReplyPresentation(message: TeamMessage) {
  const reply=message.reply
  return reply ? {itemUid:reply.key,senderName:reply.sender.nickname,title:reply.title ?? '',textContent:reply.text,
    contentBlocks: (reply.media ?? []).map((media,sortOrder) => ({kind:media.mimeType.startsWith('image/')?'image' as const:media.mimeType.startsWith('video/')?'video' as const:media.mimeType.startsWith('audio/')?'audio' as const:'file' as const,mediaRef:media.ref,fileName:media.name,mimeType:media.mimeType,size:media.size,sortOrder})),
    sequence:reply.seq,quoteState:reply.state,...(reply.quote ? {quote:reply.quote} : {})} : undefined
}

export function TeamMessageMediaScope({message,children,conversationRef,conversationKey}:{message:TeamMessage;children:ReactNode;conversationRef?:string|undefined;conversationKey?:string|undefined}) {
 const urls=new Map(message.media.map(media=>[media.ref,media.url]))
 return <ArkmeMediaAccessContext.Provider value={teamMessageMediaAccess(message,urls,conversationRef,conversationKey)}>{children}</ArkmeMediaAccessContext.Provider>
}

function teamMessageMediaAccess(message:TeamMessage,urls:Map<string,string>,conversationRef:string|undefined,conversationKey:string|undefined):ArkmeMediaAccess {
 const auth=arkmeAuthStore.getSnapshot().auth
 const accountKey=auth?.status==='authenticated'?`${auth.environment}:${auth.userId}`:undefined
 return {url:block=>urls.get(block.mediaRef)??'',subscribeReadState:listener=>watchTeamSourceRead({accountKey,conversationRef,conversationKey,messageRef:message.ref,messageKey:message.key,version:message.version,revision:message.revision},listener)}
}

export function teamPendingReply(reply: import('../team-app-contract.js').TeamReplyTarget | undefined) {
 return reply ? {ref:reply.messageRef,key:reply.messageKey,seq:0,version:reply.version,state:'available' as const,text:reply.text,title:reply.title ?? '',media:reply.media ?? [],sender:{nickname:reply.senderName},...(reply.quote?{quote:reply.quote}:{})} : undefined
}
