import type {ArkmeContentBlock,ArkmeTimelineItem} from '../types.js'
import type {TeamMessage} from '../team-app-contract.js'
import {createArkmeSdk} from '../sdk/index.js'
import {teamMessagePresentation} from './TeamMessageContent.js'
import {prepareAskDshNotes} from './ask-dsh-notes.js'
import {readAskDshOriginal} from './use-ask-dsh.js'
import {remapLongArticleAssets} from '../long-article-assets.js'

interface TeamMaterialReader {
  preflight(conversationRef:string,selections:{messageRef:string;version:number}[],signal:AbortSignal):Promise<TeamMessage[]>
  original(block:ArkmeContentBlock,signal:AbortSignal):Promise<Blob>
}

export const canAskDshTeamMessage = (message: TeamMessage): boolean => message.state === 'published' && message.contentStatus === 'available' && !!message.content && message.seq > 0

/** Preflight precedes even pure-text export. Only returned bodies are fed to
 * the shared preparer; its timeline-text preference cannot restore stale text. */
export async function prepareTeamAskDshNotes(conversationRef:string,selected:readonly TeamMessage[],sourceName:string,signal:AbortSignal,progress?:(text:string)=>void,reader?:TeamMaterialReader):Promise<File[]>{
  signal.throwIfAborted()
  if(!selected.length||selected.length>100||selected.some(m=>m.state!=='published'||m.contentStatus!=='available'||m.version<=0))throw new Error('请选择 1 至 100 条当前可读的团队消息')
  const port=reader??{preflight:(ref,selections,readSignal)=>createArkmeSdk().preflightTeamMessages(ref,selections,readSignal),original:readAskDshOriginal}
  const fresh=await port.preflight(conversationRef,selected.map(message=>({messageRef:message.ref,version:message.version})),signal)
  signal.throwIfAborted()
  if(fresh.length!==selected.length||fresh.some((message,index)=>message.key!==selected[index]!.key||message.version!==selected[index]!.version||message.contentStatus!=='available'))throw new Error('选中的团队消息已变化，请重新选择')
  const items=fresh.map((message,index)=>{
    if(message.mediaComplete===false||!message.forwardRecords&&message.content?.template_kind!==1&&!message.media.length)throw new Error('完整附件清单暂不可用，请刷新后重试')
    const item=teamMessagePresentation({...message,sender:{...message.sender,nickname:selected[index]!.sender.nickname}})
    const originalBlock=(block:ArkmeContentBlock):ArkmeContentBlock=>{
      const media=message.media.find(media=>media.ref===block.mediaRef)
      if(!media)throw new Error('完整附件清单暂不可用，请刷新后重试')
      // Keep an already issued grant only for the exact authorized asset and
      // body version. Each first download still reauthorizes through Team;
      // completed local files retain the existing personal cache contract.
      const original=selected[index]!.media.find(old=>old.key===media.key)?.ref??media.ref
      return {...block,originalRef:original,fileAssetUid:media.key}
    }
    // Forward detail rows have their own inline aliases. Export resources share
    // one namespace, so rewrite those aliases to the authorized media identity.
    // The selected card is one intent: never export a partial detail silently.
    const forward=item.forwardRecords
    if(forward&&(forward.truncated||!forward.items.length||forward.items.some(row=>row.truncated||row.mediaUnavailable)))throw new Error('完整转发内容暂不可用或过大，请打开详情后重试')
    return {...item,exportSourceName:sourceName,contentBlocks:(item.contentBlocks??[]).map(originalBlock),
      ...(forward?{forwardRecords:{...forward,items:forward.items.map(row=>{
        const blocks=row.contentBlocks??[],converted=blocks.map(originalBlock)
        const aliases=new Map(blocks.flatMap((block,position)=>block.fileAssetUid?[[`arkme-asset:${block.fileAssetUid}`,`arkme-asset:${converted[position]!.fileAssetUid}`]]:[]))
        return {...row,textContent:row.textFormat==='markdown'?remapLongArticleAssets(row.textContent,aliases):row.textContent,contentBlocks:converted}
      })}}:{})}
  })
  return await prepareAskDshNotes(items,{
    detail:async(item:ArkmeTimelineItem)=>({itemUid:item.itemUid,title:item.title,textContent:item.textContent,startAtMillis:item.sendAtMillis,contentBlocks:item.contentBlocks!,backgroundSound:'unknown'}),
    original:port.original,
  },signal,progress)
}
