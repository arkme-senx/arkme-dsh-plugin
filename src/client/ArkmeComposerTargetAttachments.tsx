import type { ArkmeContentBlock } from '../types.js'
import { createArkmeSdk } from '../sdk/index.js'
import { arkmeTheme } from './arkme-theme.js'

export function ArkmeComposerTargetAttachments({blocks,url}:{blocks:readonly ArkmeContentBlock[];url?:(block:ArkmeContentBlock)=>string}) {
 return blocks.length ? <div style={{marginTop:5,display:'flex',gap:5,overflow:'hidden',color:arkmeTheme.tertiary,fontSize:10,lineHeight:'14px'}}>
   {blocks.slice(0,3).map((block,index)=><span key={`${block.mediaRef}:${index}`} title={block.fileName||'附件'}
     style={{width:42,height:34,display:'grid',placeItems:'center',overflow:'hidden',borderRadius:5,background:arkmeTheme.elevated,textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
     {block.kind==='image'?<><img style={{width:'100%',height:'100%',display:'block',objectFit:'cover'}} src={url?url(block):createArkmeSdk().mediaUrl(block.mediaRef)} alt={block.fileName||'图片附件'}/><span hidden>{block.fileName||'附件'}</span></>:block.fileName||'附件'}
   </span>)}
 </div>:null
}
