import assert from 'node:assert/strict'
import { createArkmeSdk, type RecordingAnalysisInput, type ModelBinding } from '@senguoyun/dsh-arkme/sdk'
const origin=new URL(process.argv[2]!)
assert.equal(origin.hostname,'127.0.0.1')
const sdk=createArkmeSdk({fetchImpl:(path,init)=>fetch(new URL(String(path),origin),{...init,headers:{...init?.headers,Origin:origin.origin}})})
const config=await sdk.recordingAnalysis({action:'models',kind:'timeline'},AbortSignal.timeout(5000))
assert('config' in config)
const binding:ModelBinding=config.config.options[0]!.binding!
assert.equal(binding.catalogReleaseId,'11')
const command:RecordingAnalysisInput={action:'continue',kind:'summary',accountScope:'test:11',versionId:'a'.repeat(24),dateStamp:0}
const result=await sdk.recordingAnalysis(command,AbortSignal.timeout(5000))
assert('section' in result);assert.equal(result.section.state,'processing')
sdk.dispose()
let writes=0
const old=createArkmeSdk({fetchImpl:async()=>{writes++;return new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{}}}))}})
await assert.rejects(()=>old.recordingAnalysis(command),error=>(error as {body?:{code?:string}}).body?.code==='CAPABILITY_UNSUPPORTED')
assert.equal(writes,1);old.dispose()
console.log('SDK_CONSUMER_PASSED')
