import assert from 'node:assert/strict'
import {createArkmeSdk,type AccountModelPreferences,type ModelUsageQuery} from '@senguoyun/dsh-arkme/sdk'
const origin=new URL(process.argv[2]!);assert.equal(origin.hostname,'127.0.0.1')
const sdk=createArkmeSdk({fetchImpl:(path,init)=>fetch(new URL(String(path),origin),{...init,headers:{...init?.headers,Origin:origin.origin}})})
const scope='test:42',dates={fromDate:'2026-11-04',untilDate:'2026-11-05',timezone:'Asia/Shanghai' as const}
const settings=await sdk.accountModels(scope);assert.equal(settings.accountScope,scope)
const preferences:AccountModelPreferences={default_route:'system-default',scenes:{},points_fallback:false}
const saved=await sdk.accountModelPreferences(scope,settings.revision,preferences);assert.equal(saved.revision,settings.revision+1)
assert.equal(saved.accountScope,scope)
const bound=await sdk.saveAccountModel(scope,{uid:'',expected_revision:saved.revision,name:'SDK 安全绑定验收',execution:'cloud',protocol:'openai-chat',base_url:'https://example.com/v1',model_key:'sdk-fixture',connector_id:'',host_provider:'',api_key:'isolated-sdk-fixture-key',capabilities:settings.models[0]!.capabilities})
const fixture=bound.models.find(model=>model.name==='SDK 安全绑定验收')!
assert(fixture?.key_configured);assert.equal(bound.accountScope,scope);assert(!JSON.stringify(bound).includes('isolated-sdk-fixture-key'))
const disabled=await sdk.disableAccountModel(scope,bound.revision,fixture.uid,true)
assert.equal(disabled.accountScope,scope);assert.equal(disabled.revision,bound.revision+1);assert.equal(disabled.models.find(model=>model.uid===fixture.uid)?.disabled,true)
const usage:ModelUsageQuery={start:'2026-11-04',end:'2026-11-07',mode:'statistics'}
assert.equal((await sdk.accountModelUsage(scope,usage)).totals.unknown_calls,1)
const summary=await sdk.aiPointsStatistics(scope,{...dates,grain:'day'});assert.equal(summary.chargedPoints,'0.1234567')
assert.equal((await sdk.aiPointsConsumptionRange(scope,{...dates,settledBefore:summary.observedAt})).observedAt,summary.observedAt)
sdk.dispose();await assert.rejects(()=>sdk.accountModels(scope))
let calls=0;const old=createArkmeSdk({fetchImpl:async()=>{calls++;return new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{}}}))}})
await assert.rejects(()=>old.accountModels(scope),e=>(e as {body:{code:string}}).body.code==='CAPABILITY_UNSUPPORTED');assert.equal(calls,1);old.dispose()
console.log('ACCOUNT_MODEL_CONSUMER_PASSED')
