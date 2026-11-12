import type { ArkmeContentBlock,ArkmeForwardRecordsPreview,ArkmeForwardRecordPreviewItem } from './types.js'
import { remapLongArticleAssets } from './long-article-content.js'

const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}
const text=(value:unknown)=>typeof value==='string'?value:''
const number=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:0
const list=(value:unknown):Record<string,unknown>[]=>Array.isArray(value)?value.map(object):[]

/** Pure projection of Team-owned frozen cards. File delivery belongs to the
 * authenticated target adapter; source owners never become actionable users. */
export function projectTeamForward(raw:unknown,files:(items:Record<string,unknown>[],longArticle:boolean)=>ArkmeContentBlock[],
 onAvatarRow?:(item:ArkmeForwardRecordPreviewItem,index:number,kind:'leaf'|'card')=>void):ArkmeForwardRecordsPreview|undefined {
 const payload=object(object(raw).forward_records)
 // The frozen source can be ordinary Records; the delivered occurrence and media remain Team-owned.
 if(!['team_message','quick_records'].includes(text(payload.source_type)))return undefined
 let remaining=100
 let leafIndex=0
 let cardIndex=0
 const project=(node:Record<string,unknown>,depth:number,fallbackAt=0,fallbackTitle='转发消息'):ArkmeForwardRecordsPreview=>{
  const items:ArkmeForwardRecordPreviewItem[]=[]
  const createdAtMillis=number(node.created_at)||fallbackAt
  let truncated=depth>8
  for(const raw of depth<=8&&Array.isArray(node.items)?node.items.slice(0,101):[]){
   if(remaining===0){truncated=true;break}
   remaining--
   const item=object(raw)
   const nested=object(item.forward_records)
   const sourceTeam=object(item.source_representation),originTeam=object(item.origin_representation)
   const row:ArkmeForwardRecordPreviewItem={senderName:text(item.owner_name)||text(item.source_display_name)||'用户',
    ...(text(sourceTeam.name)&&text(sourceTeam.jotmo_id)?{sourceTeam:{name:text(sourceTeam.name),jotmoId:text(sourceTeam.jotmo_id)}}:{}),
    ...(text(originTeam.name)&&text(originTeam.jotmo_id)?{originTeam:{name:text(originTeam.name),jotmoId:text(originTeam.jotmo_id)}}:{}),
    sendAtMillis:number(item.send_at),title:text(item.title),textContent:'',sourceType:'team_message'}
   const hasNestedRows=Array.isArray(nested.items)&&nested.items.length>0
   // The backend sends separate preorder slots for nonempty cards and leaves.
   if(hasNestedRows)onAvatarRow?.(row,cardIndex++,'card')
   else onAvatarRow?.(row,leafIndex++,'leaf')
   if(hasNestedRows||nested.render_kind==='forward_records'||text(nested.title)){
    row.forwardRecords=project(nested,depth+1,row.sendAtMillis||createdAtMillis,row.title||'转发消息')
   }else{
    const media=list(item.files),longArticle=item.display_kind===1
    const blocks=files(media,longArticle)
    row.textFormat=item.text_format==='markdown'?'markdown':'plain'
    row.displayKind=number(item.display_kind)
    row.templateKind=number(item.template_kind)
    row.textContent=longArticle&&row.textFormat==='markdown'
     ? remapLongArticleAssets(text(item.text),new Map(media.map((file,index)=>[`arkme-asset:${text(file.file_asset_uid)}`,`arkme-asset:media-${index}`])))
     : text(item.text)
    if(blocks.length)row.contentBlocks=blocks
    if(media.length>blocks.length)row.mediaUnavailable=true
   }
   items.push(row)
  }
  return {title:text(node.title)||fallbackTitle,createdAtMillis,summaryLines:Array.isArray(node.summary_lines)?node.summary_lines.filter((value):value is string=>typeof value==='string'):[],items,...(truncated?{truncated:true as const}:{})}
 }
 return project(payload,0)
}
