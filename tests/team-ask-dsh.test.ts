import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { TeamConversation, TeamMessage } from '../src/team-app-contract.js'
const mocks = vi.hoisted(() => ({call:vi.fn()}))
vi.mock('../src/client/api.js',()=>({callArkme:mocks.call}))
import { prepareTeamAskDsh } from '../src/client/team-ask-dsh.js'
const conversation = {ref:'team-conversation',key:'conv',side:'team',channel:{name:'团队'},visitor:{nickname:'访客'}} as TeamConversation
const message: TeamMessage = {ref:'team-message',key:'m',seq:5,revision:1,side:'external',sender:{nickname:'我的备注'},own:false,state:'published',createdAt:1000,canEdit:false,canDelete:false,version:2,contentStatus:'available',content:{text_content:'选中的消息',template_kind:1},media:[]}
const signal = () => new AbortController().signal
beforeEach(()=>{mocks.call.mockReset();vi.stubGlobal('window',{location:{origin:'http://127.0.0.1:3102'}})})
afterEach(()=>vi.unstubAllGlobals())
const read = (value:TeamMessage) => mocks.call.mockResolvedValue({conversation,messages:[value],hasMore:false,beforeSeq:0})
it('exports only selected text with remark, source and time after a fresh Team read',async()=>{
  read({...message,sender:{nickname:'公开昵称'}})
  const files = await prepareTeamAskDsh(conversation,[message],'prod:11',signal(),()=>{})
  const text = await files[0]!.text()
  expect(text).toContain('选中的消息');expect(text).toContain('我的备注');expect(text).toContain('团队 · 访客')
  expect(text).not.toContain('team-message');expect(text).not.toContain('公开昵称')
  expect(mocks.call).toHaveBeenCalledWith('team.app.timeline',{conversationRef:'team-conversation',expectedAccountKey:'prod:11',beforeSeq:6,limit:1},expect.any(AbortSignal))
})
it.each(['changed','deleted','wrong-conversation','missing'])('rejects %s source before any draft preparation',async kind=>{
  const fresh = {...message,...(kind==='changed'?{version:3}:{}),...(kind==='deleted'?{contentStatus:'deleted'}:{})}
  mocks.call.mockResolvedValue({conversation:kind==='wrong-conversation'?{...conversation,key:'other'}:conversation,messages:kind==='missing'?[]:[fresh]})
  await expect(prepareTeamAskDsh(conversation,[message],'prod:11',signal(),()=>{})).rejects.toThrow('已变化或不可访问')
})
it('reads original attachments only from the reauthorizing Team route and includes them in the draft',async()=>{
  const file = {ref:'team-media',key:'asset',url:'/api/arkme/team/media?ref=team-media',name:'样例.txt',mimeType:'text/plain',size:3,kind:4}
  const withMedia = {...message,media:[file]};read(withMedia)
  const fetch = vi.fn(async()=>new Response('abc',{headers:{'content-type':'text/plain'}}));vi.stubGlobal('fetch',fetch)
  const files = await prepareTeamAskDsh(conversation,[withMedia],'prod:11',signal(),()=>{})
  expect(files).toHaveLength(2);expect(files[1]!.name).toBe('样例.txt');expect(await files[1]!.text()).toBe('abc')
  expect(String(fetch.mock.calls[0]![0])).toBe('http://127.0.0.1:3102/api/arkme/team/media?ref=team-media')
  expect(await files[0]!.text()).not.toContain('team-media')
})
it.each(['http://untrusted.invalid/team/media?ref=team-media','/api/team/media?ref=another','/api/chat/media?ref=team-media'])('rejects invalid attachment destination %s',async url=>{
  const withMedia={...message,media:[{ref:'team-media',key:'asset',url,name:'a.txt',mimeType:'text/plain',size:3,kind:4}]};read(withMedia)
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch)
  await expect(prepareTeamAskDsh(conversation,[withMedia],'prod:11',signal(),()=>{})).rejects.toThrow('读取地址无效')
  expect(fetch).not.toHaveBeenCalled()
})
it('fails instead of silently omitting an inaccessible or truncated attachment',async()=>{
  const withMedia={...message,media:[{ref:'media',key:'asset',url:'/api/team/media?ref=media',name:'a.txt',mimeType:'text/plain',size:9,kind:4}]};read(withMedia)
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('abc',{headers:{'content-type':'text/plain'}})))
  await expect(prepareTeamAskDsh(conversation,[withMedia],'prod:11',signal(),()=>{})).rejects.toThrow('不完整')
})
