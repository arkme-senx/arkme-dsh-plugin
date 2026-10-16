import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
// Keep the existing 0.1.0 inbox fixture while the takeover matrix uses 0.1.5 Agents.
import { Inbox } from 'dsh-agent-legacy-test'
import { CallId, createUserMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { registerArkmeTools, type ArkmeToolPorts } from '../src/tools/index.js'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { ArkmeService, type ArkmeServiceConfig } from '../src/arkme-service.js'
import { ArkmeStateStore } from '../src/state-store.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import { ArkmeSdk } from '../src/sdk/index.js'
import type { ArkmeSessionCredentials } from '../src/keychain-store.js'
// Only the browser's same-origin transport is supplied by the local Host fixture.
// Host dispatch, ArkmeService, HTTP clients, Backend/Team handlers and DB are real.
const bridge = vi.hoisted(() => ({ url: '' }))
vi.mock('../src/client/api.js', () => ({
  ArkmeClientError: class extends Error {},
  callArkme: async (operation: string, params?: unknown) => {
    const response = await fetch(bridge.url, { method: 'POST', body: JSON.stringify({ operation, params }) })
    const envelope = await response.json() as { ok: boolean; value: unknown; error?: { message: string } }
    if (!envelope.ok) throw new Error(envelope.error?.message)
    return envelope.value
  },
}))
import { ArkmeContactAddSurface } from '../src/client/ArkmeContactAddSurface.js'

it.skipIf(!process.env.JOTMO_CONTACT_E2E_DIR)('real plugin UI and SDK → Host → Backend/Team → Mongo admission', async () => {
  const dir = process.env.JOTMO_CONTACT_E2E_DIR!
  const team = JSON.parse(await readFile(join(dir, 'team.json'), 'utf8')) as Record<string,string>
  const backend = JSON.parse(await readFile(join(dir, 'backend.json'), 'utf8')) as { url: string }
  const stateDir = await mkdtemp(join(tmpdir(), 'contact plugin e2e '))
  let session: ArkmeSessionCredentials | undefined = { userId: 13, accessToken: team.plugin!, refreshToken: 'local-e2e-refresh' }
  const sessions = { read: async () => session, write: async (v: ArkmeSessionCredentials) => { session = v }, delete: async () => { session = undefined } }
  const requests: string[] = []
  const upstream = async (input: string | URL | Request, init?: RequestInit) => {
    requests.push(new URL(String(input)).pathname)
    return await fetch(input, init)
  }
  const service = new ArkmeService({ environment: 'test', authBaseUrl: backend.url, teamBaseUrl: team.url,
    chatBaseUrl: team.url, recordBaseUrl: team.url, subjectBaseUrl: team.url,
    routePath: '/api', requestTimeoutMs: 5000, maxTextLength: 20000, fileStateDirectory: stateDir,
  } as ArkmeServiceConfig, sessions, new ArkmeStateStore(stateDir), upstream)
  const host = createServer(async (req,res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk))
    try {
      const { operation, params } = JSON.parse(Buffer.concat(chunks).toString())
      // Self-profile hydration is unrelated to discovery and requires a signed-in UI shell.
      const value = operation === 'user.profile' ? {profile:null} : await dispatchArkmeHostOperation(service, operation, params)
      res.setHeader('content-type','application/json'); res.end(JSON.stringify({ok:true,value}))
    } catch (e) { res.setHeader('content-type','application/json'); res.end(JSON.stringify({ok:false,error:{message:String(e)}})) }
  })
  await new Promise<void>(resolve => host.listen(0,'127.0.0.1',resolve))
  bridge.url = `http://127.0.0.1:${(host.address() as {port:number}).port}/api`
  const sdk = new ArkmeSdk({ fetchImpl: async (_url,init) => await fetch(bridge.url,init) })
  let renderer: ReactTestRenderer | undefined
  const post = async (path: string, body: unknown, token = team.owner!) => {
    const response = await fetch(`${team.url}/api/v1/team/${path}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)})
    return await response.json() as {code:number,data:any}
  }
  try {
    await act(async () => { renderer = create(<ArkmeContactAddSurface compact shareWebsite="https://jiwo.cc" onSourceActivated={() => {throw new Error('team must never open private chat')}}/>) })
    const search = async (id: string) => {
      await act(async()=>{renderer!.root.findAllByType('input')[0]!.props.onChange({target:{value:id}})})
      await act(async()=>{renderer!.root.findByType('form').props.onSubmit({preventDefault(){}})})
      await act(async()=>{await vi.waitFor(()=>expect(renderer!.root.findAllByType('input')[0]!.props.disabled).toBe(false))})
    }
    const text = () => JSON.stringify(renderer!.toJSON())
    const joinTeam = async () => { const button = renderer!.root.findAllByType('button').find(v=>typeof v.props.children==='string' && v.props.children.includes('加入团队'))!; expect(button.props.disabled).toBe(false); await act(async()=>{await button.props.onClick()});
      // The real button intentionally dispatches without returning the promise.
      await vi.waitFor(()=>expect(JSON.stringify(renderer!.toJSON())).not.toContain('正在处理…'))
    }
    await search('arkme_cn'); expect(text()).toContain('即我官方团队'); expect(text()).not.toContain('该账号当前无法添加')
    await joinTeam(); expect(text()).toContain('申请已提交，等待审批')
    const list = await post('join-requests/list',{team_id:7}); expect(list.code).toBe(200)
    const application = list.data.items.find((v:any)=>v.user_id===13); expect(application.display_name).toBe('插件申请人')
    expect((await post('join-requests/decide',{team_id:7,user_id:13,revision:application.revision,approve:true},team.mobile)).code).not.toBe(200)
    expect((await post('join-requests/decide',{team_id:7,user_id:13,revision:application.revision,approve:false})).code).toBe(200)
    await search('arkme_cn'); expect(text()).toContain('申请加入团队')
    await expect(sdk.joinContactTeam('arkme_cn',crypto.randomUUID())).resolves.toEqual({state:'pending'})
    const second = (await post('join-requests/list',{team_id:7})).data.items.find((v:any)=>v.user_id===13)
    expect(second.revision).toBeGreaterThan(application.revision)
    expect((await post('join-requests/decide',{team_id:7,user_id:13,revision:second.revision,approve:true})).code).toBe(200)
    await search('arkme_cn'); expect(text()).toContain('已加入团队')
    expect((await post('members/leave',{team_id:7},team.plugin)).code).toBe(200)
    expect((await sdk.searchContact('arkme_cn')).team?.state).toBe('not_member')
    await search('open_team'); await joinTeam(); expect(text()).toContain('已加入团队')
    expect((await sdk.searchContact('closed_team')).team).toBeUndefined()
    expect((await sdk.searchContact('no_such_team')).team).toBeUndefined()
    const start = requests.length
    expect(await sdk.searchContact('person_contact')).toMatchObject({registered:true,displayName:'个人联系人'})
    expect(requests.slice(start)).not.toContain('/api/v1/team/discovery/search')
    expect(await sdk.searchContact('13800138000')).toMatchObject({registered:false,canAdd:true,inviteBySms:true})
    expect(requests.some(v=>v.includes('add-and-open'))).toBe(false)
    // The official DSH session discovers and invokes the same real Host owner.
    const ctx = new Context(); await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
    const mounted = await ctx.plugin(Object.assign((inner:Context) => registerArkmeTools(inner, {
      searchContact: service.searchContact.bind(service), joinContactTeam: service.joinContactTeam.bind(service),
    } as ArkmeToolPorts), {inject:['tools','systemPrompt']}))
    const toolSession = Session.create(SessionId('contact-http-session'))
    const inbox = new Inbox(toolSession,{inserted(){},discarded(){},claimed(){}})
    const agent = {id:toolSession.id,session:toolSession,inbox} as Agent
    let seq = 0
    const invoke = async (name:string,args:Record<string,unknown>) => {
      const callId = CallId(`contact-http-${++seq}`)
      const call = toolSession.append('tool/call',{turn:1,step:seq,callId,name,arguments:JSON.stringify(args)})
      const result = await ctx.tools.execute({callId,name,arguments:args,agent,signal:new AbortController().signal})
      toolSession.append('tool/result',{turn:1,step:seq,message:createToolResultMessage({callId,content:result.content,isError:result.isError})},{surfaceOp:'append',sourceEventSeqs:[call.seq]})
      return result
    }
    try {
      expect(ctx.tools.schemas(agent).map(v=>v.name)).toContain('arkme_team_join')
      expect((await invoke('arkme_contact_search',{identifier:'approval_team'})).isError).toBe(false)
      expect(JSON.stringify(await invoke('arkme_team_join',{jotmo_id:'approval_team'}))).toContain('confirmation_required')
      expect((await sdk.searchContact('approval_team')).team?.state).toBe('none')
      inbox.append('next-step',createUserMessage({content:[{type:'text',text:'确认申请加入团队 approval_team'}],source:{kind:'user'}}))
      for (const message of inbox.claim('next-step',0)) toolSession.append('user/message',message,{surfaceOp:'append'})
      expect((await invoke('arkme_team_join',{jotmo_id:'approval_team'})).isError).toBe(false)
      expect((await sdk.searchContact('approval_team')).team?.state).toBe('pending')
    } finally {await mounted.dispose(); await ctx.fiber.dispose()}
    const anon = await fetch(`${team.url}/api/v1/team/discovery/search`,{method:'POST',body:'{"jotmo_id":"arkme_cn"}'})
    expect(anon.status).toBe(403)
  } finally {
    if(renderer) act(()=>renderer!.unmount())
    service.dispose(); await new Promise<void>(resolve=>host.close(()=>resolve())); await rm(stateDir,{recursive:true,force:true})
  }
}, 60000)
