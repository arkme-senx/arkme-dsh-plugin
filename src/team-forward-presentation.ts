import type { ArkmeContentBlock,ArkmeForwardRecordsPreview,ArkmeForwardRecordPreviewItem } from './types.js'
import { remapLongArticleAssets } from './long-article-content.js'

const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}
const text=(value:unknown)=>typeof value==='string'?value:''
const number=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:0
const list=(value:unknown):Record<string,unknown>[]=>Array.isArray(value)?value.map(object):[]

/** Pure projection of Team-owned frozen cards. File delivery belongs to the
 * authenticated target adapter; source owners never become actionable users. */
export function projectTeamForward(raw:unknown,files:(items:Record<string,unknown>[],longArticle:boolean)=>ArkmeContentBlock[]):ArkmeForwardRecordsPreview|undefined {
 const payload=object(object(raw).forward_records)
 if(payload.source_type!=='team_message')return undefined
 const items:ArkmeForwardRecordPreviewItem[]=[]
 let truncated=false
 const visit=(node:Record<string,unknown>,depth:number)=>{
  for(const item of list(node.items)){
   if(items.length>=100||depth>8){truncated=true;return}
   const nested=object(item.forward_records)
   if(Array.isArray(nested.items)){visit(nested,depth+1);continue}
   const media=list(item.files),longArticle=item.display_kind===1
   const blocks=files(media,longArticle)
   let body=text(item.text)
   if(longArticle&&item.text_format==='markdown')body=remapLongArticleAssets(body,new Map(media.map((file,index)=>[`arkme-asset:${text(file.file_asset_uid)}`,`arkme-asset:media-${index}`])))
   items.push({senderName:text(item.owner_name)||text(item.source_display_name)||'用户',sendAtMillis:number(item.send_at),title:text(item.title),textContent:body,textFormat:item.text_format==='markdown'?'markdown':'plain',sourceType:'team_message',displayKind:number(item.display_kind),templateKind:number(item.template_kind),...(blocks.length?{contentBlocks:blocks}:{}),...(media.length>blocks.length?{mediaUnavailable:true as const}:{})})
  }
 }
 visit(payload,0)
 return {title:text(payload.title)||'转发消息',createdAtMillis:number(payload.created_at),summaryLines:Array.isArray(payload.summary_lines)?payload.summary_lines.filter((value):value is string=>typeof value==='string'):[],items,...(truncated?{truncated:true as const}:{})}
}
