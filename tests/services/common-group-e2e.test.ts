import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { CallId } from '@deepseek-ai/dsh-llm'
import { expect, it } from 'vitest'
import { ServiceRuntime, type ArkmeServiceConfig } from '../../src/services/service.js'
import { SourceService } from '../../src/services/source-service.js'
import { ProfileService } from '../../src/services/profile-service.js'
import { CommonGroupService } from '../../src/services/common-group-service.js'
import { ArkmeLocalDatabase } from '../../src/local-database.js'
import { ArkmeStateStore } from '../../src/state-store.js'
import { registerArkmeTools } from '../../src/tools/registry/registrar.js'
import type { ArkmeCommonGroupPage } from '../../src/common-groups.js'

const endpoint = process.env.JOTMO_COMMON_GROUP_E2E_URL
// Paired with Chat TestCommonGroupOwnerFixture: real HTTP, Mongo and DSH Session.
it.skipIf(!endpoint)('runs persistent paging and explicit reconciliation through official DSH and real Chat', async () => {
  expect(endpoint).toMatch(/^https:\/\/127\.0\.0\.1:\d+$/)
  expect((await fetch(`${endpoint}/fixture/reset`,{method:'POST'})).ok).toBe(true)
  const path=await mkdtemp(join(tmpdir(),'common group e2e '))
  const session={userId:1001,accessToken:'common-group-fixture',refreshToken:'fixture-refresh'}
  const sessions={async read(){return session},async write(){},async delete(){}}
  const create=()=>{
    const db=new ArkmeLocalDatabase(path,new ArkmeStateStore(path))
    const runtime=new ServiceRuntime({environment:'test',chatBaseUrl:endpoint,authBaseUrl:endpoint,requestTimeoutMs:10000} as ArkmeServiceConfig,sessions,db)
    const source=new SourceService(runtime,new ProfileService(runtime),{} as never)
    const owner=new CommonGroupService(runtime,source)
    return {db,runtime,source,owner,close(){owner.dispose();source.dispose();runtime.dispose();db.close()}}
  }
  let local=create()
  const ctx=new Context();await ctx.plugin(SessionStore);await ctx.plugin(SystemPrompt);await ctx.plugin(ToolRuntime)
  const dshSession=ctx.sessions.create();const agent={id:dshSession.id,session:dshSession}
  registerArkmeTools(ctx,{listCommonGroups:(...args:Parameters<CommonGroupService['list']>)=>local.owner.list(...args),syncCommonGroups:(...args:Parameters<CommonGroupService['sync']>)=>local.owner.sync(...args)} as never,'business')
  const sourceRef=await local.source.sealSourceRef(1001,'private_chat','private','测试联系人')
  let calls=0
  const invoke=async(params:Record<string,unknown>={})=>{
    const result=await ctx.tools.execute({callId:CallId(`common-${++calls}`),agent:agent as never,signal:new AbortController().signal,name:'arkme_common_groups',arguments:{source_ref:sourceRef,...params}})
    expect(result.isError,JSON.stringify(result)).toBe(false)
    return JSON.parse(String(result.value).split('<data_from_arkme>\n')[1]!.split('\n</data_from_arkme>')[0]!) as ArkmeCommonGroupPage
  }
  try {
    expect(ctx.tools.schemas().some(s=>s.name==='arkme_common_groups')).toBe(true)
    expect((await invoke()).totalCached).toBe(0)
    const first=await invoke({sync:true});expect(first.items).toHaveLength(20);expect(first.syncHasMore).toBe(true)
    local.close();local=create() // resume the committed discovery cursor after a process-equivalent restart
    expect((await invoke()).totalCached).toBe(20)
    expect((await invoke({sync:true})).totalCached).toBe(40)
    const done=await invoke({sync:true});expect(done.totalCached).toBe(41);expect(done.syncHasMore).toBe(false)
    const page2=await invoke({cursor:done.nextCursor}),page3=await invoke({cursor:page2.nextCursor})
    expect([done.items.length,page2.items.length,page3.items.length,page3.hasMore]).toEqual([20,20,1,false])
    const foreign=await local.source.sealSourceRef(2002,'private_chat','private','other')
    await expect(local.owner.list(foreign)).rejects.toThrow('当前账号')
    const change=await fetch(`${endpoint}/fixture/change`,{method:'POST'});expect(change.ok).toBe(true)
    let updated=await invoke({sync:true})
    for(let i=0;updated.syncHasMore&&i<10;i++)updated=await invoke({sync:true})
    expect(updated.syncHasMore).toBe(false);expect(updated.totalCached).toBe(40)
    expect(updated.items[0]!.source.displayName).toBe('改名后的共同群')
    expect(updated.items[0]!.source.sourceRef).toMatch(/^arkme-source-v1\./)
    console.info(`Common groups E2E: ${calls} real DSH Session tool calls, 20/20/1 paging and restart resume`)
  } finally {local.close();await ctx.fiber.dispose();await rm(path,{recursive:true,force:true})}
},60000)
