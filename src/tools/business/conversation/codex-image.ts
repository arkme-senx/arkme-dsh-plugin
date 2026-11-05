import{defineArkmeContextToolModule}from'../../contract/module.js'
import{createArkmeImageToolDefinition}from'../media/read-image.js'
export const codexImageTool=defineArkmeContextToolModule({
 meta:{id:'business.codex.image.v1',toolName:'arkme_codex_image_read',kind:'business',phase:'attachments',effect:'read',profiles:['business','hybrid']},
 create:(ctx,ports)=>({...createArkmeImageToolDefinition(ctx,{readImage:async(ref,options)=>{
   if(!ref.startsWith('codex_image_v1_'))throw Error('Use an exact imageRef from Codex events')
   if(options?.cacheOnly)throw Error('Codex image reads require current owner authorization')
   const value=await ports.readCodexImage(ref,{maxBytes:options?.maxBytes??20*1024*1024,...(options?.signal?{signal:options.signal}:{})})
   return {...value,bytes:value.data.byteLength}
 }}),name:'arkme_codex_image_read',description:'Read exactly one owner-only Codex imageRef returned by arkme_codex_work_records, after explicit human permission for this model to see it. Returns validated DSH image attachments, never an OSS URL or token. Team text access and administrator role grant no image access.'}),
})
