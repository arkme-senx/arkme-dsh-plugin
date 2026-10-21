// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { randomUUID, webcrypto } from 'node:crypto'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'
import { SourceService } from '../../src/services/source-service.js'
import { ChatService } from '../../src/services/chat-service.js'
import { ArkmeService } from '../../src/arkme-service.js'
import { createArkmeHostApi } from '../../src/host-api.js'
import { createArkmeCoreToolDefinitions } from '../../src/tools/index.js'
import { createArkmeSdk } from '../../src/sdk/index.js'
import { MessageUnderlineSession, underlineTargetKey } from '../../src/client/message-underline-session.js'
import { ArkmeMessageContent } from '../../src/client/ArkmeRichContent.js'
import { ArkmeMessageTextSelectionToolbar } from '../../src/client/ArkmeMessageTextSelection.js'
import { ArkmeQuotePreview } from '../../src/client/ArkmeQuotePreview.js'
import type { MessageSelectionTarget } from '../../src/client/ArkmeMessageTextSelection.js'
import type { ArkmeMessageQuote } from '../../src/message-quote.js'

const path = process.env.JOTMO_ANCHORS_FRONTEND_FIXTURE
it.skipIf(!path)('PC selection UI → SDK → real Host HTTP → Chat/Record acceptance and exact retry', async () => {
  const f = JSON.parse(readFileSync(path!, 'utf8'))
  for (const origin of [f.recordUrl, f.chatUrl]) expect(new URL(origin).hostname).toBe('127.0.0.1')
  const credentials = { userId:f.owner, accessToken:f.recordToken, refreshToken:'isolated-only' }
  const secret = randomUUID()
  // The synthetic account and profile replace Auth only. Mark and extension
  // endpoints, source signatures, transport and both domain owners are real.
  const config = {environment:'test',recordBaseUrl:'https://record.test',chatBaseUrl:'https://chat.test',requestTimeoutMs:15000,maxTextLength:40000} as ArkmeServiceConfig
  let loseNextMarkReceipt=false
  const runtime = new ServiceRuntime(config,{read:async()=>credentials,write:async()=>{},delete:async()=>{}},{uniqueCode:async()=>secret} as StateStore,
    async (input,init) => {
      const url = new URL(String(input)), chat = url.hostname==='chat.test'
      const headers=new Headers(init?.headers); headers.set('authorization',`Bearer ${chat?f.chatToken:f.recordToken}`)
      const response=await fetch(new URL(url.pathname,chat?f.chatUrl:f.recordUrl),{...init,headers})
      if(loseNextMarkReceipt && url.pathname.endsWith('/annotations/create')) {
        loseNextMarkReceipt=false;await response.arrayBuffer();throw new TypeError('injected lost acknowledgement after owner acceptance')
      }
      return response
    })
  const profile = {publicProfileSummariesByUserIds:async()=>new Map(),refreshProfile:async()=>({profile:{nickname:'我',displayName:'我',avatarRef:''}})}
  const source = new SourceService(runtime,profile as never,{} as never)
  source.privateChatViewerLabelsByUserIds=async()=>new Map()
  const chat = new ChatService(runtime,source,profile as never,{} as never,{} as never,{} as never,{} as never,{} as never,{scheduleChatSessionProjection:()=>{}} as never)
  const sourceRef=await source.sealSourceRef(f.owner,'group_chat',f.target.chat_session_uid,'isolated selected text')
  const actionRef=(chat as any).sealMessageActionRef((chat as any).messageActionRefPayload({sourceKind:'chat_relation',userId:f.owner,sourceOwnerRef:f.target.chat_session_uid,chatSessionUid:f.target.chat_session_uid,relationUid:f.target.relation_uid,recordOwnerUserId:f.peer,recordUid:f.target.record_uid,senderUserId:f.peer,senderName:'同事',title:'',textContent:f.text,textFormat:'plain',sendAtMillis:1,sourceSequence:f.target.sequence,templateKind:1,displayKind:0}),secret)
  const facade = {config,runtime,relatedRecording:{isEnabled:()=>false},providerCapabilities:ArkmeService.prototype.providerCapabilities,
    sourceUnderlineCapabilities:chat.sourceUnderlineCapabilities.bind(chat),sourceUnderlines:chat.sourceUnderlines.bind(chat),changeSourceUnderline:chat.changeSourceUnderline.bind(chat),captureSourceMessageAnchor:chat.captureSourceMessageAnchor.bind(chat),extendSourceMessage:chat.extendSourceMessage.bind(chat)}
  let handler: ReturnType<typeof createArkmeHostApi>
  const server=createServer((req,res)=>void handler(req,res));server.listen(0,'127.0.0.1');await once(server,'listening')
  const port=(server.address() as {port:number}).port
  handler=createArkmeHostApi(facade as never,{expectedPort:port,allowNonLoopback:false})
  const sdk=createArkmeSdk({fetchImpl:(url,init)=>fetch(new URL(String(url),`http://127.0.0.1:${port}`),init)})
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('crypto',webcrypto)
  Range.prototype.getBoundingClientRect=()=>new DOMRect(20,80,150,20)
  Range.prototype.getClientRects=()=>[new DOMRect(20,80,150,20)] as unknown as DOMRectList
  const target:MessageSelectionTarget={sourceRef,item:{itemUid:f.target.record_uid,recordOwnerUserId:f.peer,sequence:f.target.sequence,messageActionRef:actionRef,status:1,title:'',textContent:f.text,senderName:'同事',sendAtMillis:1,isMe:false}}
  const session=new MessageUnderlineSession(sourceRef,f.owner,()=>{},'cloud',{capabilities:(s,a)=>sdk.messageMarkCapabilities(s,a),list:(s,r,a)=>sdk.messageMarks(s,r,a),change:(s,r,c,a)=>sdk.changeMessageMark(s,r,c,a)})
  try {
    expect(facade.providerCapabilities().features.messageTextAnchorsV1).toBe(true)
    expect(await chat.sourceUnderlineCapabilities(sourceRef)).toMatchObject({supported:true})
    await session.prepare();expect(session.capability,session.notice).toMatchObject({supported:true});await session.read([target])
    expect(session.snapshots.get(underlineTargetKey(target))?.items,session.notice).toHaveLength(2)
    let written:Promise<unknown>|undefined
    const reply=(t:MessageSelectionTarget,q:ArkmeMessageQuote)=>{written=sdk.extendSourceMessage(sourceRef,t.item.messageActionRef!,'PC native reply',{quote:q,recordUid:randomUUID(),relationUid:randomUUID()})}
    await act(async()=>root.render(<><ArkmeMessageContent item={target.item} sourceRef={sourceRef}/><ArkmeMessageTextSelectionToolbar replySourceRef={sourceRef} onReply={reply} onUnderline={(t,a)=>session.change(t,{kind:'add',operationId:'pc-ui-add',anchor:a})} getMarks={()=>session.snapshots.get(underlineTargetKey(target))?.items??[]} onRemoveMark={(t,m)=>{written=session.change(t,{kind:'remove',operationId:'pc-ui-cancel',annotationId:m.id});return written as Promise<void>}}/></>))
    const select=async()=>{
      const p=host.querySelector('p')!,node=document.createTreeWalker(p,NodeFilter.SHOW_TEXT).nextNode()!
      await act(async()=>{const range=document.createRange();range.setStart(node,0);range.setEnd(node,2);document.getSelection()!.removeAllRanges();document.getSelection()!.addRange(range);p.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}))})
    }
    await select()
    let toolbar=document.querySelector('[role="toolbar"]')!
    // WebCrypto verification completes outside the mouse event's React act.
    // Wait for the actual verified action, not a fixed sleep or first render.
    await vi.waitFor(async () => {
      await act(async () => {})
      expect(toolbar.textContent).toContain('取消标记')
    }, { timeout: 5000 })
    await act(async()=>{(toolbar.querySelector('[aria-pressed="true"]') as HTMLButtonElement).click();await written})
    const after=await sdk.messageMarks(sourceRef,[actionRef]);expect(after[0]!.snapshot.items.map(i=>i.actorId)).toEqual([f.peer])
    const anchor=await sdk.captureMessageQuote(sourceRef,actionRef,0,2)
    await sdk.changeMessageMark(sourceRef,actionRef,{kind:'add',operationId:'pc-live-restored',anchor})
    await select();toolbar=document.querySelector('[role="toolbar"]')!
    written=undefined
    await act(async()=>{([...toolbar.querySelectorAll('button')].find(b=>b.textContent==='回复') as HTMLButtonElement).click()})
    await vi.waitFor(()=>expect(written).toBeDefined(), { timeout: 5000 })
    expect(await written).toMatchObject({localState:'synced'})
    const raw=await runtime.authenticatedChatPost<any>('/api/v1/chats/extensions/tree/page',{chat_session_uid:f.target.chat_session_uid,parent_record_owner_user_id:f.peer,parent_record_uid:f.target.record_uid,limit:20},credentials)
    expect(JSON.stringify(raw)).toContain('重点')
    const edge=raw.children.find((entry:any)=>entry.item.relation.record_uid===f.quoteChild).edge
    const parent=(chat as any).timelineExtensionProjection({extension_edge:edge},f.owner,new Map()).extensionParent
    await act(async()=>root.render(<ArkmeQuotePreview parent={parent}/>))
    expect(host.textContent).toContain('重点')
    // Lose only the response after the real owner commits. Tools must preserve
    // the original operation identity instead of inviting another write intent.
    const tool=createArkmeCoreToolDefinitions(facade as never).find(t=>t.name==='arkme_message_mark')!
    const args={source_ref:sourceRef,message_action_ref:actionRef,action:'add',start:3,end:8,operation_uid:'pc-tool-lost-receipt'}
    loseNextMarkReceipt=true
    const unknown=await tool.execute(args,{callId:'first',signal:new AbortController().signal} as never)
    expect(JSON.stringify(unknown)).toContain('unknown');expect(JSON.stringify(unknown)).toContain(args.operation_uid)
    const retry=await tool.execute(args,{callId:'retry',signal:new AbortController().signal} as never)
    expect(JSON.stringify(retry)).not.toContain('unknown')
    const marks=(await sdk.messageMarks(sourceRef,[actionRef]))[0]!.snapshot.items
    const added=marks.filter(mark=>mark.mine && mark.anchor.start===3)
    expect(added).toHaveLength(1)
    await sdk.changeMessageMark(sourceRef,actionRef,{kind:'remove',operationId:'pc-tool-cleanup',annotationId:added[0]!.id})
    console.log('PASS live PC component → SDK → Host HTTP → Record marks and Chat quoted child; source signatures include long owner IDs')
  } finally {session.dispose();await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
},120000)
