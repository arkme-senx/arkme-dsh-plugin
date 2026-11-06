import assert from 'node:assert/strict'
import {createArkmeSdk,type AccountModelPreferences,type ModelUsageQuery} from '@senguoyun/dsh-arkme/sdk'
const origin=new URL(process.argv[2]!);assert.equal(origin.hostname,'127.0.0.1')
const sdk=createArkmeSdk({fetchImpl:(path,init)=>fetch(new URL(String(path),origin),{...init,headers:{...init?.headers,Origin:origin.origin}})})
const scope='test:42',dates={fromDate:'2026-11-04',untilDate:'2026-11-05',timezone:'Asia/Shanghai' as const}
const settings=await sdk.accountModels(scope);assert.equal(settings.accountScope,scope)
const preferences:AccountModelPreferences={default_route:'system-default',scenes:{},points_fallback:false}
const saved=await sdk.accountModelPreferences(scope,settings.revision,preferences);assert.equal(saved.revision,settings.revision+1)
const usage:ModelUsageQuery={start:'2026-11-04',end:'2026-11-05',mode:'calls'}
assert.equal((await sdk.accountModelUsage(scope,usage)).totals.unknown_calls,1)
const summary=await sdk.aiPointsStatistics(scope,{...dates,grain:'day'});assert.equal(summary.chargedPoints,'0.1234567')
assert.equal((await sdk.aiPointsConsumptionRange(scope,{...dates,settledBefore:summary.observedAt})).observedAt,summary.observedAt)
sdk.dispose();await assert.rejects(()=>sdk.accountModels(scope))
let calls=0;const old=createArkmeSdk({fetchImpl:async()=>{calls++;return new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{}}}))}})
await assert.rejects(()=>old.accountModels(scope),e=>(e as {body:{code:string}}).body.code==='CAPABILITY_UNSUPPORTED');assert.equal(calls,1);old.dispose()
console.log('ACCOUNT_MODEL_CONSUMER_PASSED')
