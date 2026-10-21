function check(value: unknown): asserts value { if (!value) throw new Error('Consumer assertion failed') }
const assert = {
 equal: (a:unknown,b:unknown) => check(a===b),
 deepEqual: (a:unknown,b:unknown) => check(JSON.stringify(a)===JSON.stringify(b)),
 rejects: async (promise:Promise<unknown>, pattern?:RegExp) => {
  try { await promise } catch(error) { if(pattern) check(pattern.test(String(error))); return }
  throw new Error('Expected rejection')
 }
}
import { createArkmeSdk, type ArkmeCapabilitySettings, type ArkmeCapabilityUpdate } from '@senguoyun/dsh-arkme/sdk'
const state: ArkmeCapabilitySettings = { accountScope: 'prod:7', settings: [{key:'record_thought',title:'快记建议',enabled:false,version:0,enabledAt:0}] }
const calls: Array<{operation:string;params:Record<string,unknown>}> = []
const sdk = createArkmeSdk({ fetchImpl: async (_, init) => {
  if(init?.signal?.aborted) throw new DOMException('Aborted','AbortError')
  const request = JSON.parse(String(init?.body)); calls.push(request)
  return new Response(JSON.stringify({ok:true,value:request.operation==='provider.capabilities'?{contractVersion:1,features:{automaticCapabilitiesV1:true}}:state}))
} })
assert.equal((await sdk.automaticCapabilities('prod:7')).settings[0]?.enabled,false)
const update: ArkmeCapabilityUpdate = {key:'record_thought',enabled:true,expectedVersion:0,billingConsent:true}
await sdk.updateAutomaticCapability('prod:7',update)
assert.deepEqual(calls.at(-1),{operation:'account.capabilities.update',params:{expectedAccountScope:'prod:7',...update}})
let unsupportedWrites = 0
const unsupported = createArkmeSdk({ fetchImpl: async (_,init) => {
  if(JSON.parse(String(init?.body)).operation !== 'provider.capabilities') unsupportedWrites++
  return new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{}}}))
} })
await assert.rejects(unsupported.updateAutomaticCapability('prod:7',update),/不支持自动 AI 设置/)
assert.equal(unsupportedWrites,0)
const controller=new AbortController(); controller.abort()
await assert.rejects(sdk.automaticCapabilities('prod:7',controller.signal))
console.log('External packed public SDK capability consumer: passed (types, consent/CAS/scope, unsupported, abort)')
