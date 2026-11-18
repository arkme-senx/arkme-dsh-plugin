// @vitest-environment jsdom
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { ServiceRuntime, type ArkmeServiceConfig } from '../src/services/service.js'
import { RecordingService } from '../src/services/recording-service.js'
import { ArkmeStateStore } from '../src/state-store.js'

const bridge=vi.hoisted(()=>({run:undefined as undefined | ((operation:string,params:any,signal?:AbortSignal)=>Promise<any>)}))
vi.mock('../src/client/api.js',async original=>({...await original<typeof import('../src/client/api.js')>(),callArkme:(operation:string,params:any,signal?:AbortSignal)=>bridge.run!(operation,params,signal)}))
import { ArkmeRecordingSurface } from '../src/client/ArkmeRecordingSurface.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'

const directory=process.env.MODEL_EXECUTION_CIRCUIT_DIR
it.runIf(!!directory)('original recording UI traverses real owners, MQ worker, paid gateway, callback and ledger',async()=>{
 const audio=JSON.parse(await readFile(join(directory!,'audio.json'),'utf8')) as {url:string;token:string;user:number;day:number}
 const intelligent=JSON.parse(await readFile(join(directory!,'intelligent.json'),'utf8')) as {url:string}
 const gateway=JSON.parse(await readFile(join(directory!,'gateway.json'),'utf8')) as {url:string;secret:string}
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 vi.stubGlobal('ResizeObserver',class { observe(){} unobserve(){} disconnect(){} })
 const root=await mkdtemp(join(tmpdir(),'model execution owner circuit '))
 const config={environment:'test',authBaseUrl:intelligent.url,subjectBaseUrl:intelligent.url,recordBaseUrl:intelligent.url,chatBaseUrl:intelligent.url,botBaseUrl:intelligent.url,imBaseUrl:intelligent.url,webrtcBaseUrl:intelligent.url,worldBaseUrl:intelligent.url,relationBaseUrl:intelligent.url,intelligentBaseUrl:intelligent.url,audioBaseUrl:audio.url,memoryCoreBaseUrl:intelligent.url,routePath:'/arkme-self/api',requestTimeoutMs:10000,maxTextLength:20000,geetestCaptchaId:'synthetic',recordingWorkbenchEnabled:true} as ArkmeServiceConfig
 const sessions={read:async()=>({userId:audio.user,accessToken:audio.token,refreshToken:'synthetic'}),write:async()=>{},delete:async()=>{}}
 const owner=new RecordingService(new ServiceRuntime(config,sessions,new ArkmeStateStore(root)),{} as never)
 const operations:{operation:string;params:any}[]=[]
 bridge.run=async(operation,params,signal)=>{
  operations.push({operation,params})
  if(operation==='recordings.summary-model-config')return owner.recordingSummaryModelConfig(signal,params?.kind??'summary')
  if(operation==='recordings.analysis')return owner.recordingAnalysis(params,signal)
  if(operation==='recordings.day')return owner.recordingDayPart(params.dateStamp,params.part,signal,params.window)
  if(operation==='recordings.calendar')return owner.recordingCalendar(params.fromStamp,params.toStamp,signal)
  if(operation==='models.directory')return {accountScope:`test:${audio.user}`,models:[],failures:[],observedAt:Date.now()}
  if(operation==='auth.status')return {status:'authenticated',userId:audio.user,environment:'test'}
  if(operation==='auth.config')return {environment:'test',recordingWorkbenchEnabled:true}
  throw new Error(`unrelated fixture UI read unavailable: ${operation}`)
 }
 const stats=async()=>{
  const response=await fetch(gateway.url+'/fixture/stats',{method:'POST',headers:{'X-Internal-Secret':gateway.secret}})
  expect(response.status).toBe(200);return response.json() as Promise<{providerCalls:number;settlements:number;chargedNanoCNY:number}>
 }
 const text=()=>document.body.textContent??''
 const container=document.createElement('div');document.body.append(container)
 let renderer:Root | undefined
 const wait=async(predicate:()=>boolean)=>{const until=Date.now()+20000;while(!predicate()){if(Date.now()>until)throw new Error('UI circuit timed out: '+(renderer?text().slice(-1600):''));await act(async()=>{await new Promise(resolve=>setTimeout(resolve,50))})}}
 const button=(label:string)=>{const found=[...document.querySelectorAll('button')].filter(node=>node.textContent===label);expect(found).toHaveLength(1);return found[0]!}
 try {
  const choices=await owner.recordingAnalysis({action:'models',kind:'summary'})
  expect('config' in choices).toBe(true)
  if(!('config' in choices))throw new Error('catalog missing')
  const model=choices.config.options.find(x=>x.routeKey==='dashscope/qwen-flash')!
  expect(model.available).toBe(true);expect(model.binding).toBeDefined();expect(model.costDescription).toBeTruthy()
  await owner.recordingAnalysis({action:'select',kind:'summary',accountScope:`test:${audio.user}`,routeKey:model.routeKey})
  const timeline=await owner.recordingAnalysis({action:'models',kind:'timeline'})
  expect('config' in timeline && timeline.config.effectiveRouteKey).toBe('dashscope/deepseek-v4.1-flash')
  arkmeAuthStore.restoreWindowSession({status:'authenticated',userId:audio.user,environment:'test'} as never,{recordingWorkbenchEnabled:true} as never)
  await act(async()=>{renderer=createRoot(container);renderer.render(<ArkmeRecordingSurface onOpenRecordingImport={()=>{}} recordingRefreshRevision={0}/>)})
  await wait(()=>text().includes('今天完成模型执行方案评审'))
  await act(async()=>{button('总结').click()})
  await wait(()=>text().includes('点击生成总结'))
  await act(async()=>{button('点击生成总结').click()})
  await wait(()=>text().includes('确认并生成'))
  await act(async()=>{button('确认并生成').click()})
  await wait(()=>text().includes('继续本任务'))
  expect(text()).toContain('AI 额度不足')
  const failed=await owner.recordingProjection(audio.day,'summary');expect(failed.state).toBe('failed')
  const original=failed.items[0]!;expect(original.continuationAvailable).toBe(true)
  expect(await stats()).toMatchObject({providerCalls:0,settlements:0})
  const credit=await fetch(gateway.url+'/api/internal/v1/managed-ai/credits/grants',{method:'POST',headers:{'Content-Type':'application/json','X-Internal-Secret':gateway.secret},body:JSON.stringify({grant_uid:randomUUID(),user_id:audio.user,source:'backend_ai_purchase',source_id:randomUUID(),amount_nano_cny:'10000000000'})})
  expect(credit.status).toBe(200)
  const credited=await credit.json();expect(credited.code).toBe(200)
  await act(async()=>{const action=button('继续本任务');action.click();action.click()})
  await wait(()=>text().includes('完成模型执行验收'))
  const continued=await owner.recordingProjection(audio.day,'summary');expect(continued.state).toBe('ready');expect(continued.items).toHaveLength(1);expect(continued.items[0]?.id).toBe(original.id)
  expect(await stats()).toMatchObject({providerCalls:1,settlements:1})
  await act(async()=>{button('时间轴').click()})
  await wait(()=>text().includes('点击生成时间轴'))
  await act(async()=>{button('点击生成时间轴').click()})
  await wait(()=>text().includes('确认并生成'))
  await act(async()=>{button('确认并生成').click()})
  await wait(()=>text().includes('方案讨论'))
  const finished=await owner.recordingProjection(audio.day,'timeline');expect(finished.state).toBe('ready');expect(finished.items[0]?.timelineEvents.length).toBeGreaterThan(0)
  const financial=await stats();expect(financial).toMatchObject({providerCalls:2,settlements:2});expect(financial.chargedNanoCNY).toBeGreaterThan(0)
  expect(operations.filter(x=>x.operation==='recordings.analysis'&&x.params.action==='continue')).toHaveLength(1)
  await writeFile(join(directory!,'frontend-result.json'),JSON.stringify({originalUI:true,realReadOwner:true,realHTTP:true,realMQ:true,realWorker:true,realPublishedCatalog:true,insufficientBalanceNoDispatch:true,sameVersionContinuation:true,doubleClickSingleCommand:true,summaryTimelineSeparate:true,financial,summaryId:original.id,timelineId:finished.items[0]?.id},null,2))
 } finally {
  await act(async()=>renderer?.unmount());container.remove();owner.dispose();bridge.run=undefined;vi.unstubAllGlobals();await rm(root,{recursive:true,force:true})
  await writeFile(join(directory!,'finish'),'done')
 }
},90000)
