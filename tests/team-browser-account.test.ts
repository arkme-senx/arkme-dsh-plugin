// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const provider = vi.hoisted(()=>vi.fn())
vi.mock('../src/sdk/index.js', async original=>({...await original<typeof import('../src/sdk/index.js')>(), callArkme:provider}))
import { callArkme } from '../src/client/api.js'
import { arkmeAuthStore, startArkmeAuthRevalidation } from '../src/client/auth-store.js'
import { ArkmeClientError } from '../src/sdk/index.js'
beforeEach(()=>{
  provider.mockReset()
  arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:1996})
})
afterEach(()=>vi.restoreAllMocks())
it('pins no-ref Team directory/open requests to the visible account, without changing ordinary calls',async()=>{
  provider.mockResolvedValue({})
  await callArkme('team.app.official')
  expect(provider).toHaveBeenLastCalledWith('team.app.official',{expectedAccountKey:'test:1996'},undefined)
  await callArkme('team.app.conversations',{side:'team',expectedAccountKey:'test:1996'})
  expect(provider).toHaveBeenLastCalledWith('team.app.conversations',{side:'team',expectedAccountKey:'test:1996'},undefined)
  await callArkme('auth.status')
  expect(provider).toHaveBeenLastCalledWith('auth.status',undefined,undefined)
})
it('rejects a retained view from the previous account before sending any request',async()=>{
  await expect(callArkme('team.app.conversations',{side:'team',expectedAccountKey:'test:1999'})).rejects.toMatchObject({body:{code:'team-account-changed'}})
  expect(provider).not.toHaveBeenCalled()
})
it('drops an old Team response after an account switch',async()=>{
  let release!: (value:unknown)=>void
  provider.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve}))
  const refresh=vi.spyOn(arkmeAuthStore,'refresh').mockResolvedValue({status:'authenticated',environment:'test',userId:1999})
  const pending=callArkme('team.app.conversations',{side:'team'})
  arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:1999})
  release({items:[{private:'old account data'}]})
  await expect(pending).rejects.toMatchObject({body:{code:'team-account-changed'}})
  expect(refresh).toHaveBeenCalledTimes(1)
})
it('refreshes stale browser auth on a Host mismatch without replaying the rejected operation',async()=>{
  provider.mockRejectedValue(new ArkmeClientError({code:'team-account-changed',message:'账号已变化',retryable:false}))
  const refresh=vi.spyOn(arkmeAuthStore,'refresh').mockResolvedValue({status:'authenticated',environment:'test',userId:1999})
  await expect(callArkme('team.app.open',{publicRef:'link'})).rejects.toMatchObject({body:{code:'team-account-changed'}})
  expect(provider).toHaveBeenCalledTimes(1)
  expect(refresh).toHaveBeenCalledTimes(1)
})
it('revalidates the shared Host account on page re-entry and releases listeners',()=>{
  const refresh=vi.spyOn(arkmeAuthStore,'refresh').mockResolvedValue({status:'authenticated',environment:'test',userId:1999})
  const stop=startArkmeAuthRevalidation()
  window.dispatchEvent(new Event('focus'))
  expect(refresh).toHaveBeenCalledTimes(1)
  stop();window.dispatchEvent(new Event('focus'))
  expect(refresh).toHaveBeenCalledTimes(1)
})
