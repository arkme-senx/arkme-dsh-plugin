import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SessionStore from '@deepseek-ai/dsh-session'
import { CallId, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
// Keep the existing 0.1.0 inbox fixture while the takeover matrix uses 0.1.5 Agents.
import { Inbox } from 'dsh-agent-legacy-test'
import { afterEach, expect, it, vi } from 'vitest'
import { registerArkmeTools } from '../src/tools/registry/registrar.js'
import { createArkmeSdk } from '../src/sdk/index.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
const progress = { accountKey: 'test:1', cycle: 1, revision: 1, phase: 'syncing', completed: 2, total: 10, pending: 8, terminal: 0 }
afterEach(() => { vi.unstubAllGlobals() })
it('official DSH sessions discover/call status and explicit-grant retry through the same Host owner', async () => {
  const ctx = new Context(); await ctx.plugin(SessionStore); await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
  const status = vi.fn(async () => progress), retry = vi.fn(async () => progress)
  const owner = { messageSyncStatus: status, retryMessageSync: retry }
  try {
    registerArkmeTools(ctx, owner as never, 'business')
    const session = ctx.sessions.create(), agent = { id: session.id, session }
    expect(ctx.tools.schemas(agent as never).map(t=>t.name)).toContain('arkme_message_sync_status')
    const result = await ctx.tools.execute({ callId: CallId('sync-status'), agent: agent as never, signal: new AbortController().signal, name: 'arkme_message_sync_status', arguments: {} })
    expect(result.isError).toBe(false); expect(String(result.value)).toContain('"completed": 2')
    await expect(dispatchArkmeHostOperation(owner as never, 'chat.sync.status', {})).resolves.toEqual(progress)
    await expect(dispatchArkmeHostOperation(owner as never, 'chat.sync.retry', {})).resolves.toEqual(progress)
    expect(status).toHaveBeenCalledTimes(2); expect(retry).toHaveBeenCalledTimes(1)
  } finally { await ctx.fiber.dispose() }
})
it('SDK detects unsupported providers, scopes calls to its route, shares observers and disposes transport', async () => {
  const calls: string[] = []; let supported = false
  const sdk = createArkmeSdk({ route: '/custom/api', fetchImpl: (async (input, init) => {
    expect(input).toBe('/custom/api'); const request=JSON.parse(String(init?.body)); calls.push(request.operation)
    return new Response(JSON.stringify({ ok: true, value: request.operation === 'provider.capabilities' ? { contractVersion: 1, features: { accountMessageSync: supported } } : progress }), { headers: { 'content-type': 'application/json' } })
  }) as typeof fetch })
  await expect(sdk.messageSyncStatus()).rejects.toMatchObject({ body: { code: 'CAPABILITY_UNSUPPORTED' } })
  expect(calls).not.toContain('chat.sync.status'); supported=true
  await expect(sdk.messageSyncStatus()).resolves.toEqual(progress); await expect(sdk.retryMessageSync()).resolves.toEqual(progress)
  const sockets: FakeSocket[] = []
  class FakeSocket {
    onmessage?: (event: { data: string }) => void; onopen?: ()=>void; onclose?: ()=>void; onerror?: ()=>void
    close=vi.fn()
    constructor(url: string) { expect(url).toBe('/custom/api/events'); sockets.push(this) }
  }
  vi.stubGlobal('WebSocket', FakeSocket)
  const first=vi.fn(), second=vi.fn(), abort=new AbortController()
  const stop=sdk.observeMessageSync(first), stopSecond=sdk.observeMessageSync(second, { signal: abort.signal })
  await vi.waitFor(()=>expect(sockets).toHaveLength(1))
  sockets[0]!.onmessage?.({ data: JSON.stringify({ type: 'message-sync-progress', progress: { ...progress, completed: 3, revision: 2 }, revision: 10 }) })
  expect(first.mock.calls.at(-1)?.[0].completed).toBe(3); expect(second.mock.calls.at(-1)?.[0].completed).toBe(3)
  stop(); expect(sockets[0]!.close).not.toHaveBeenCalled(); abort.abort(); stopSecond(); expect(sockets[0]!.close).toHaveBeenCalledTimes(1)
})

it('requires a human confirmation before the registered DSH retry Tool runs', async () => {
  const ctx = new Context(); await ctx.plugin(SessionStore); await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
  const retry=vi.fn(async()=>progress)
  const mounted=await ctx.plugin(Object.assign((inner:Context)=>registerArkmeTools(inner,{retryMessageSync:retry} as never,'business'),{inject:['tools','systemPrompt']}))
  const session=ctx.sessions.create(), inbox=new Inbox(session,{inserted(){},discarded(){},claimed(){}})
  const agent={id:session.id,session,inbox} as Agent
  let count=0
  const human=(text:string)=>{
    inbox.append('next-step',createUserMessage({content:[{type:'text',text}],source:{kind:'user'}}))
    for(const value of inbox.claim('next-step',0)) session.append('user/message',value,{surfaceOp:'append'})
  }
  const invoke=async()=>{
    const callId=CallId(`sync-retry-${++count}`),name='arkme_message_sync_retry'
    const call=session.append('tool/call',{turn:1,step:count,callId,name,arguments:'{}'})
    const result=await ctx.tools.execute({callId,name,arguments:{},agent,signal:new AbortController().signal})
    session.append('tool/result',{turn:1,step:count,message:createToolResultMessage({callId,content:result.content,isError:result.isError})},{surfaceOp:'append',sourceEventSeqs:[call.seq]})
    return result
  }
  try {
    human('重新检查消息同步'); expect(JSON.stringify(await invoke())).toContain('confirmation_required'); expect(retry).not.toHaveBeenCalled()
    human('确认重新检查消息同步'); expect((await invoke()).isError).toBe(false); expect(retry).toHaveBeenCalledTimes(1)
  } finally { await mounted.dispose();await ctx.fiber.dispose() }
})
