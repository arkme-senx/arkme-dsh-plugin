import { defineConfig } from 'vite'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
let scenario='ready'
const content='可以。可以。引用只标记第二处。'
const anchor={version:1,projection:'arkme-text-v1',recordVersion:1,sourceDigest:createHash('sha256').update(JSON.stringify([content,'plain'])).digest('hex'),start:3,end:5,text:'可以',prefix:'可以。',suffix:'。引用只标记第二处。'}
export default defineConfig({root:fileURLToPath(new URL('.',import.meta.url)),server:{host:'127.0.0.1',port:43131,strictPort:true,fs:{allow:[fileURLToPath(new URL('../../..',import.meta.url))]}},plugins:[{name:'isolated-summary-owner',configureServer(server){server.middlewares.use(async(req,res,next)=>{
 if(req.url?.startsWith('/__scenario/')){scenario=req.url.slice('/__scenario/'.length);res.end('ok');return}
 if(req.url!=='/arkme-self/api')return next()
 let raw='';for await(const chunk of req)raw+=chunk
 const request=JSON.parse(raw),failed=scenario==='fail'
 res.setHeader('content-type','application/json')
 res.end(JSON.stringify(failed?{ok:false,error:{code:'fixture-unavailable',message:'评论汇总读取失败，请重试',retryable:true}}:{ok:true,value:request.params.actionRefs.map((actionRef:string)=>({actionRef,summary:{accessible:true,complete:true,commentCount:scenario==='zero'?0:125,quoteCount:scenario==='zero'?0:125,sourceRecordVersion:1,anchors:scenario==='zero'?[]:[anchor]}}))}))
 })}}]})
