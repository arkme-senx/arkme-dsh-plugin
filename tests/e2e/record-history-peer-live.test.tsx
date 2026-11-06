import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { ServiceRuntime, type ArkmeServiceConfig } from '../../src/services/service.js'
import { ArkmeStateStore } from '../../src/state-store.js'
import { SourceService } from '../../src/services/source-service.js'
import { MediaService } from '../../src/services/media-service.js'
import { ChatService } from '../../src/services/chat-service.js'
import { RecordEditHistoryService } from '../../src/services/record-edit-history-service.js'
import { ArkmeService } from '../../src/arkme-service.js'
import { createArkmeHostApi } from '../../src/host-api.js'
import { createArkmeSdk } from '../../src/sdk/index.js'
import { createArkmeCoreToolDefinitions } from '../../src/tools/index.js'
import { ArkmeRecordEditHistory } from '../../src/client/ArkmeRecordEditHistory.js'
import { arkmeRecordTextFormat } from '../../src/markdown.js'

const ready = process.env.JOTMO_HISTORY_CHAT_READY
it.skipIf(!ready)('peer history UI → public SDK/Host → Chat → Record → Mongo → version review → retry/pagination', async () => {
 const chatUrl = readFileSync(ready!, 'utf8'), f = JSON.parse(readFileSync(ready! + '.json', 'utf8'))
 expect(new URL(chatUrl).hostname).toBe('127.0.0.1')
 const root = await mkdtemp(join(tmpdir(), 'peer history ')), state = new ArkmeStateStore(root)
 const session = { userId: f.peer, accessToken: 'synthetic-peer', refreshToken: 'synthetic-only' }
 const config = { environment: 'test', chatBaseUrl: chatUrl, recordBaseUrl: f.recordUrl, authBaseUrl: 'http://127.0.0.1:1', requestTimeoutMs: 15000, fileStateDirectory: root } as ArkmeServiceConfig
 const runtime = new ServiceRuntime(config, { read: async () => session, write: async () => {}, delete: async () => {} }, state)
 const source = new SourceService(runtime, {} as never, {} as never)
 const media = new MediaService(runtime, {} as never, {} as never, {} as never)
 const chat = new ChatService(runtime, source, {} as never, media, {} as never, {} as never, {} as never, {} as never, {} as never)
 const history = new RecordEditHistoryService(runtime, { projectPage: async (snapshots, target, signal) => {
  const pages = await media.hydrateRecordSnapshotMediaPage(snapshots, session, target.kind === 'chat' ? target : undefined, signal)
  return snapshots.map((snapshot, index) => {
   const contentBlocks = media.richContentBlocks(snapshot, session.userId, pages[index])
   return { title: String(snapshot.title ?? ''), textContent: String(snapshot.text_content), textFormat: arkmeRecordTextFormat(snapshot), contentBlocks,
    ...(media.recordMediaUnavailable(snapshot, contentBlocks) ? { mediaUnavailable: true } : {}) }
  })
 } })
 const owner = { config, runtime, chat, recordEditHistory: history, relatedRecording: { isEnabled: () => false } }
 const facade = { ...owner, providerCapabilities: ArkmeService.prototype.providerCapabilities,
 recordEditHistoryPage: ArkmeService.prototype.recordEditHistoryPage.bind(owner as never), recordRevisionSnapshot: ArkmeService.prototype.recordRevisionSnapshot.bind(owner as never) }
 let handler: ReturnType<typeof createArkmeHostApi>
 const server = createServer((req,res) => void handler(req,res)); server.listen(0,'127.0.0.1');await once(server,'listening')
 const port = (server.address() as {port:number}).port
 handler=createArkmeHostApi(facade as never,{expectedPort:port,allowNonLoopback:false})
 const sdk=createArkmeSdk({fetchImpl:(url,init)=>fetch(new URL(String(url),`http://127.0.0.1:${port}`),init)})
 const refs = async () => {
  const sourceRef=await source.sealSourceRef(session.userId,'group_chat',f.session,'history')
  const secret=await state.uniqueCode()
  const actionRef=(chat as any).sealMessageActionRef((chat as any).messageActionRefPayload({sourceKind:'chat_relation',userId:session.userId,sourceOwnerRef:f.session,chatSessionUid:f.session,relationUid:f.relation,recordOwnerUserId:f.owner,recordUid:f.record,senderUserId:f.owner,senderName:'author',title:'',textContent:'history 55',textFormat:'plain',sendAtMillis:1,sourceSequence:f.sequence,templateKind:1,displayKind:0}),secret)
  return {sourceRef,actionRef}
 }
 let view:ReactTestRenderer|undefined
 try {
  const {sourceRef,actionRef}=await refs()
  const reader={page:(s:string,a:string,c?:number,signal?:AbortSignal)=>sdk.recordEditHistory(s,a,c,signal)}
  await act(async()=>{view=create(<ArkmeRecordEditHistory sourceRef={sourceRef} messageActionRef={actionRef} reader={reader} author={{isMe:false,senderName:'author'}}/>)})
  const wait=async(check:()=>void)=>vi.waitFor(async()=>{await act(async()=>{});check()},{timeout:20000,interval:100})
  const retry=()=>view!.root.findAllByType('button').find(n=>n.children.includes('重试'))!
  await wait(()=>expect(retry()).toBeDefined())
  await fetch(chatUrl+'/review',{method:'POST'})
  await act(async()=>retry().props.onClick())
  await wait(()=>expect(view!.root.findAllByProps({'data-arkme-history-bubble':true})).toHaveLength(49))
  expect(JSON.stringify(view!.toJSON())).not.toContain('history rejected 52')
  expect(JSON.stringify(view!.toJSON())).not.toContain('historical private device')
  const more=view!.root.findAllByType('button').find(n=>n.children.includes('加载更多'))!
  await act(async()=>more.props.onClick());await wait(()=>expect(retry()).toBeDefined())
  await fetch(chatUrl+'/review',{method:'POST'});await act(async()=>retry().props.onClick())
  await wait(()=>expect(view!.root.findAllByProps({'data-arkme-history-bubble':true})).toHaveLength(54))
  const page=await sdk.recordEditHistory(sourceRef,actionRef)
  const tool=createArkmeCoreToolDefinitions(facade as never).find(t=>t.name==='arkme_record_history')!
  const output=JSON.stringify(await tool.execute({source_ref:sourceRef,message_action_ref:actionRef,cursor_version:0},{callId:'peer-history-read',signal:new AbortController().signal} as never))
  expect(output).toContain('history 55');expect(output).not.toContain('historical private device');expect(output).not.toContain('history rejected 52')
  await expect(sdk.recordRevisionSnapshot(sourceRef,actionRef,page.items[0]!.revisionUid)).rejects.toMatchObject({body:{code:'record-snapshot-private'}})
  expect(await (await fetch(chatUrl+'/verify')).json()).toMatchObject({ok:true})
  session.userId=f.owner;session.accessToken='synthetic-owner'
  const own=await refs(), ownPage=await sdk.recordEditHistory(own.sourceRef,own.actionRef)
  expect(ownPage.items).toHaveLength(50)
  const snapshot=await sdk.recordRevisionSnapshot(own.sourceRef,own.actionRef,'history-revision-53')
  expect(snapshot).toMatchObject({editDurationMillis:0,captureContext:{clientName:'historical private device'}})
  session.userId=f.peer;session.accessToken='synthetic-peer'
  await fetch(chatUrl+'/revoke',{method:'POST'})
  await expect(sdk.recordEditHistory(sourceRef,actionRef)).rejects.toThrow()
  console.log('PASS: peer original history UI and public SDK/Host; 55 real Record revisions; independent group review; rejected version omitted; retry and 2 pages preserve 54 allowed versions; owner-only snapshot/zero; current relation unchanged; revoked peer denied')
 } finally {await act(async()=>view?.unmount());sdk.dispose();runtime.dispose();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true})}
},120000)
