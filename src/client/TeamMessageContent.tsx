import {watchTeamSourceRead,teamChangeAffectsSource} from './team-source-read.js'
import {subscribeTeamMessageChanges} from './team-messaging-events.js'
import {arkmeAuthStore} from './auth-store.js'
import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import type { ArkmeContentBlock, ArkmeTimelineItem, ArkmeTimelineMentionTarget } from '../types.js'
import type { TeamConversation, TeamMessage, TeamIdentity } from '../team-app-contract.js'
import { ArkmeMessageContent } from './ArkmeRichContent.js'
import { ArkmeMediaAccessContext,type ArkmeMediaAccess } from './media-access.js'
import type {ArkmeAttachmentNavigationEntry} from './attachment-preview-navigation.js'

// Presentation identity only: rotating grants and partial-media completion must
// not change the selected asset. Weak keys retain no message or media cache.
const attachmentKeys=new WeakMap<ArkmeContentBlock,string>()
function teamAttachmentKey(block:ArkmeContentBlock):string {
 return attachmentKeys.get(block)??`${block.sortOrder}:${block.mediaRef}`
}

export function teamMessagePresentation(message: TeamMessage): ArkmeTimelineItem {
  return {
    itemUid: message.key, senderName: message.sender.nickname, isMe: message.own,
    sendAtMillis: message.createdAt, title: message.content?.title ?? '',
    textFormat: message.content?.content_payload?.text_format === 'markdown' ? 'markdown' : 'plain',
    mentions:(message.content?.mentions ?? []).map(m=>({kind:'member',personRef:m.personRef,startIndex:m.startIndex,length:m.length,displayName:m.displayName})), textContent: message.content?.text_content ?? '', status: message.state === 'published' ? 1 : 2,
    version: message.version, recordVersion: message.version, templateKind: message.content?.template_kind ?? 1, displayKind: message.content?.display_kind ?? 0,
    ...(message.forwardRecords?{forwardRecords:message.forwardRecords}:{}),
    contentBlocks: (message.forwardRecords?[]:message.media).map((media, sortOrder): ArkmeContentBlock => {
      const block:ArkmeContentBlock={
      kind: media.mimeType.startsWith('image/') ? 'image' : media.mimeType.startsWith('video/') ? 'video' : media.mimeType.startsWith('audio/') ? 'audio' : 'file',
      ...(message.content?.display_kind === 1 ? { fileAssetUid: media.inlineRef } : {}), mediaRef: media.ref, fileName: media.name, mimeType: media.mimeType, size: media.size, sortOrder,
      }
      attachmentKeys.set(block,media.key)
      return block
    }),
  }
}

/** Existing loaded timeline material; each destination retains its own read owner. */
export function teamAttachmentNavigationEntries(messages:readonly TeamMessage[],conversation:Pick<TeamConversation,'ref'|'key'>,accountKey:string):ArkmeAttachmentNavigationEntry[] {
 return messages.flatMap<ArkmeAttachmentNavigationEntry>(message=>{
  if(message.state==='published'&&message.contentStatus==='revalidating'&&!message.historyPreview)return [{key:message.key,source:`${message.key}:${message.key}`,version:String(message.version),blocks:[],revalidating:true}]
  if(message.state!=='published'||message.contentStatus!=='available'||message.version<=0||message.historyPreview)return []
  const blocks=(teamMessagePresentation(message).contentBlocks??[]).filter(block=>block.kind==='image'||block.kind==='video')
  return blocks.length?[{key:message.key,source:`${message.key}:${message.key}`,version:String(message.version),blocks,
   blockKey:teamAttachmentKey,mediaAccess:teamMessageMediaAccess(message,conversation.ref,conversation.key,accountKey)}]:[]
 })
}

/** Only presentation is shared. URL grants and every byte read remain Team-scoped. */
export function TeamMessageContent({ message, conversationRef, presentation, onOpenArticle, conversationKey, readOnly = false,attachmentNavigationKey, onOpenPerson }: { onOpenPerson?: ((person: TeamIdentity) => void) | undefined; attachmentNavigationKey?:string|undefined;readOnly?:boolean; conversationKey?:string | undefined; message: TeamMessage; conversationRef?: string | undefined; presentation?: 'detail'; onOpenArticle?: (()=>void) | undefined }) {
  // Keep mounted media and its URL across equivalent authorized snapshots.
  // Keys include viewer, message, Record version and asset. Changed content or
  // lost access replaces/unmounts this scope; byte reads still reauthorize.
  const identity = JSON.stringify([message.key, message.version, message.contentStatus, message.content, message.media.map(media => media.key)])
  const snapshot = useRef({ identity, media: message.media, localMarkRef: message.localMarkRef })
  if (snapshot.current.identity !== identity) snapshot.current = { identity, media: message.media, localMarkRef: message.localMarkRef }
  const urls = new Map(snapshot.current.media.map(media => [media.ref, media.url]))
  const item = teamMessagePresentation({ ...message, media: snapshot.current.media })
  const mediaAccess=useTeamMessageMediaAccess(message,urls,conversationRef,conversationKey)
  if (message.historyPreview) return <div style={{whiteSpace:'pre-wrap'}}>{message.content?.text_content}</div>
  return <ArkmeMediaAccessContext.Provider value={mediaAccess}>
    <ArkmeMessageContent sessionAttachmentPreview highlightMentions item={item}
      {...(onOpenPerson ? { isMentionClickable: (_text: string, target?: ArkmeTimelineMentionTarget) => target?.kind === 'member' && !!target.personRef,
        onMentionClick: (_text: string, target?: ArkmeTimelineMentionTarget) => { if (target?.kind === 'member' && target.personRef) onOpenPerson({personRef:target.personRef,nickname:target.displayName}) } } : {})} sourceIdentityKey={message.key} mediaSelectionIsExplicit {...(attachmentNavigationKey===undefined?{}:{attachmentNavigationKey})} {...(onOpenArticle ? {onArticleOpen:onOpenArticle} : {})} {...(presentation ? { presentation } : {})}
      selectionTarget={!readOnly && conversationRef && snapshot.current.localMarkRef && message.state === 'published' && message.contentStatus === 'available'
        ? { item, sourceRef: conversationRef, localMarkRef: snapshot.current.localMarkRef,cloudMarkRef:message.ref,excerptOrigin:{kind:'team_message',itemRef:message.ref} } : undefined} />
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
 const mediaAccess=useTeamMessageMediaAccess(message,urls,conversationRef,conversationKey)
 return <ArkmeMediaAccessContext.Provider value={mediaAccess}>{children}</ArkmeMediaAccessContext.Provider>
}

export function teamMessageMediaAccess(message:TeamMessage,conversationRef:string|undefined,conversationKey:string|undefined,accountKey:string|undefined,urls=new Map(message.media.map(media=>[media.ref,media.url]))):ArkmeMediaAccess {
 const target={accountKey,conversationRef,conversationKey,messageRef:message.ref,messageKey:message.key,version:message.version,revision:message.revision}
 return {url:block=>urls.get(block.mediaRef)??'',readScopeKey:JSON.stringify([accountKey,conversationKey??conversationRef,message.key,message.version,message.state,message.contentStatus]),
  prepareImageWhileChecking:true,subscribeReadState:listener=>watchTeamSourceRead(target,listener)}
}

function useTeamMessageMediaAccess(message:TeamMessage,urls:Map<string,string>,conversationRef:string|undefined,conversationKey:string|undefined):ArkmeMediaAccess {
 const auth=arkmeAuthStore.getSnapshot().auth
 const accountKey=auth?.status==='authenticated'?`${auth.environment}:${auth.userId}`:undefined
 const readScopeKey=JSON.stringify([accountKey,conversationKey??conversationRef,message.key,message.version,message.state,message.contentStatus])
 const target={accountKey,conversationRef,conversationKey,messageRef:message.ref,messageKey:message.key,version:message.version,revision:message.revision}
 const current=useRef({scope:readScopeKey,target});current.current={scope:readScopeKey,target}
 const hasImages=message.media.some(media=>media.mimeType.startsWith('image/')&&media.url!=='')
 const readable=!!accountKey&&!!conversationRef&&message.state==='published'&&message.version>0&&message.contentStatus==='available'&&!message.historyPreview
 const presentation=useMemo(()=>({active:false,valid:readable,ref:message.ref,listeners:new Set<()=>void>()}),[readScopeKey,hasImages])
 useLayoutEffect(()=>{
  if(!hasImages)return
  presentation.active=true
  const invalidate=()=>{presentation.valid=false;for(const listener of presentation.listeners)listener()}
  const stop=subscribeTeamMessageChanges((account,receiptOnly,change)=>{
   if(account===accountKey&&!receiptOnly&&teamChangeAffectsSource(change,current.current.target))invalidate()
  })
  return()=>{presentation.active=false;for(const listener of presentation.listeners)listener();stop()}
 },[presentation])
 useLayoutEffect(()=>{
  // A new Host reference is a new authorized projection; an ordinary rerender
  // of the invalidated object must not restore its old presentation.
  if(presentation.ref!==message.ref){presentation.ref=message.ref;presentation.valid=readable}
 },[presentation,message.ref,readable])
 return {...teamMessageMediaAccess(message,conversationRef,conversationKey,accountKey,urls),
  ...(hasImages?{imagePresentation:{current:()=>{
   const now=arkmeAuthStore.getSnapshot().auth
   return presentation.active&&presentation.valid&&current.current.scope===readScopeKey&&now?.status==='authenticated'&&`${now.environment}:${now.userId}`===accountKey
  },subscribeInvalidation:(listener:()=>void)=>{presentation.listeners.add(listener);return()=>{presentation.listeners.delete(listener)}}}}:{})}
}

export function teamPendingReply(reply: import('../team-app-contract.js').TeamReplyTarget | undefined) {
 return reply ? {ref:reply.messageRef,key:reply.messageKey,seq:0,version:reply.version,state:'available' as const,text:reply.text,title:reply.title ?? '',media:reply.media ?? [],sender:{nickname:reply.senderName},...(reply.quote?{quote:reply.quote}:{})} : undefined
}
