import { describe, expect, it, vi } from 'vitest'
import { ArkmeService } from '../src/arkme-service.js'
import { ArkmePluginError, ServiceRuntime } from '../src/services/service.js'

function fixture() {
  let owner=11,accessToken='test-jwt'
  const runtime={config:{environment:'prod'},requireSession:vi.fn(async()=>({userId:owner,accessToken})),postDirect:vi.fn(async()=>({items:[]})),
    refreshAccessToken:vi.fn(async()=>{accessToken='refreshed-test-jwt'})}
  const target={config:runtime.config,runtime}
  const call=(user=11,path='/api/v1/team-codex/tasks/list',signal=new AbortController().signal)=>
    ArkmeService.prototype.teamCodexPost.call(target as never,user,path,{},signal)
  return {runtime,target,call,setOwner:(id:number)=>{owner=id}}
}
describe('team cloud JWT transport',()=>{
  it.each(['SERVICE_UNAVAILABLE','TEAM_FORBIDDEN'])('rejects HTTP 200 business failures without recording success: %s',async code=>{
    const f=fixture()
    const transport=Object.assign(Object.create(ServiceRuntime.prototype),{
      config:{requestTimeoutMs:500},
      fetchImpl:vi.fn(async()=>new Response(JSON.stringify({code:1002,message:'失败',data:{error_code:code}}),{status:200})),
    }) as ServiceRuntime
    f.runtime.postDirect.mockImplementation(transport.postDirect.bind(transport) as never)
    await expect(f.call(11,'/api/v1/team-codex/sources/confirm')).rejects.toMatchObject({code})
    expect(f.runtime.refreshAccessToken).not.toHaveBeenCalled()
  })
  it('handles a non-JSON HTTP 403 through the existing one-time JWT refresh',async()=>{
    const f=fixture()
    const transport=Object.assign(Object.create(ServiceRuntime.prototype),{
      config:{requestTimeoutMs:500},fetchImpl:vi.fn(async()=>new Response('Forbidden',{status:403})),
    }) as ServiceRuntime
    f.runtime.postDirect.mockImplementation(transport.postDirect.bind(transport) as never)
    await expect(f.call(11,'/api/v1/team-codex/connection/status')).rejects.toMatchObject({code:'auth-http-403'})
    expect(f.runtime.refreshAccessToken).toHaveBeenCalledTimes(1)
    expect(f.runtime.postDirect).toHaveBeenCalledTimes(2)
  })
  it.each(['/api/v1/team-codex/sources/confirm','/api/v1/team-codex/connection/status'])('allows the new contract route without changing the JWT boundary: %s',async path=>{
    const f=fixture();await f.call(11,path)
    expect(f.runtime.postDirect).toHaveBeenCalledWith('https://team.jotmo.cc',path,{},'test-jwt',[200],expect.any(AbortSignal),true)
    f.target.config.environment='test'
    await expect(f.call(11,path)).rejects.toThrow('当前环境未配置')
    expect(f.runtime.postDirect).toHaveBeenCalledTimes(1)
  })
  it('uses the login JWT only on the exact team service allowlist',async()=>{
    const f=fixture();await f.call()
    expect(f.runtime.postDirect).toHaveBeenCalledWith('https://team.jotmo.cc','/api/v1/team-codex/tasks/list',{},'test-jwt',[200],expect.any(AbortSignal),true)
    await expect(f.call(11,'https://elsewhere.invalid')).rejects.toThrow('当前环境未配置')
    expect(f.runtime.postDirect).toHaveBeenCalledTimes(1)
    f.target.config.environment='test'
    await expect(f.call()).rejects.toThrow('当前环境未配置')
  })
  it('refreshes an expired JWT through the existing owner runtime and retries once',async()=>{
    const f=fixture()
    f.runtime.postDirect.mockRejectedValueOnce(new ArkmePluginError('auth-http-403','expired',false,403))
    await f.call()
    expect(f.runtime.refreshAccessToken).toHaveBeenCalledTimes(1)
    expect(f.runtime.postDirect.mock.calls.at(-1)).toContain('refreshed-test-jwt')
  })
  it('allows member identity reads but not member removal',async()=>{
    const f=fixture()
    await f.call(11,'/api/v1/team/members/list')
    await expect(f.call(11,'/api/v1/team/members/remove')).rejects.toThrow('当前环境未配置')
    expect(f.runtime.postDirect).toHaveBeenCalledTimes(1)
  })
  it('never sends under another account or after cancellation',async()=>{
    const f=fixture();f.setOwner(22)
    await expect(f.call()).rejects.toThrow('账号已切换')
    expect(f.runtime.postDirect).not.toHaveBeenCalled()
    f.setOwner(11);const controller=new AbortController();controller.abort()
    await expect(f.call(11,undefined,controller.signal)).rejects.toThrow()
    expect(f.runtime.postDirect).not.toHaveBeenCalled()
  })
  it('stops if the owner changes during credential refresh',async()=>{
    const f=fixture()
    f.runtime.postDirect.mockRejectedValueOnce(new ArkmePluginError('auth-http-401','expired',false,401))
    f.runtime.refreshAccessToken.mockImplementation(async()=>{f.setOwner(22)})
    await expect(f.call()).rejects.toThrow('账号已切换')
    expect(f.runtime.postDirect).toHaveBeenCalledTimes(1)
  })
  it('rejects a late response after the owner changes',async()=>{
    const f=fixture()
    f.runtime.postDirect.mockImplementationOnce(async()=>{f.setOwner(22);return {items:[]}})
    await expect(f.call()).rejects.toThrow('账号已切换')
    expect(f.runtime.postDirect).toHaveBeenCalledTimes(1)
  })
  it('does not refresh or retry an unrelated transport failure',async()=>{
    const f=fixture()
    f.runtime.postDirect.mockRejectedValueOnce(new Error('offline'))
    await expect(f.call()).rejects.toThrow('offline')
    expect(f.runtime.refreshAccessToken).not.toHaveBeenCalled()
    expect(f.runtime.postDirect).toHaveBeenCalledTimes(1)
  })
})
