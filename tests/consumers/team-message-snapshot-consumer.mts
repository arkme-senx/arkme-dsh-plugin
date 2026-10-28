const assert = {
  equal(actual: unknown, expected: unknown) { if (actual !== expected) throw new Error('consumer result mismatch') },
  deepEqual(actual: unknown, expected: unknown) { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('consumer command drift') },
  async rejects(pending: Promise<unknown>, pattern?: RegExp) {
    try { await pending } catch (error) { if (!pattern || pattern.test(String(error))) return; throw error }
    throw new Error('unsupported or cancelled operation was accepted')
  },
}
import { ArkmeSdk, type TeamRecordMetadata, type TeamEditCommand, type TeamMessageSnapshot } from '@senguoyun/dsh-arkme/sdk'

const calls: {operation:string;params:Record<string,unknown>}[]=[]
let supported=true
const sdk=new ArkmeSdk({fetchImpl:async(_url,init)=>{
  init?.signal?.throwIfAborted()
  const request=JSON.parse(String(init?.body));calls.push(request)
  const value=request.operation==='provider.capabilities'?{contractVersion:1,features:{teamMessageSnapshot:supported?1:undefined}}
    :request.operation==='team.messages.snapshot-capabilities'?{schemaVersion:1}
      :request.operation==='team.messages.metadata-freeze'?{metadataRef:'opaque-account-bound-capture'}
        :request.operation==='team.messages.snapshot'?{schemaVersion:1,recorded:true,version:2,snapshotVersion:1,captureStates:{device:'unavailable',location:'permission_denied'},detail:{itemUid:'opaque',textContent:'',backgroundSound:'unknown',durationState:'complete',recordDurationMillis:0,editDurationMillis:0}}
          :request.operation==='team.messages.edit'?{version:2}:{revisionUid:'stable-edit',accepted:true,acceptedVersion:2}
  return new Response(JSON.stringify({ok:true,value}))
}})
const lifecycle=new AbortController()
const metadata:TeamRecordMetadata={record_started_at:1000,send_at:1000,capture_context:{schema_version:1,captured_at:1000,device_state:'unavailable',location_state:'permission_denied'}}
const frozen=await sdk.freezeTeamMetadata('opaque-conversation','stable-operation',metadata,lifecycle.signal)
assert.equal(frozen.metadataRef,'opaque-account-bound-capture')
const snapshot:TeamMessageSnapshot=await sdk.readTeamMessageSnapshot('opaque-conversation','opaque-message',lifecycle.signal)
assert.equal(snapshot.detail.recordDurationMillis,0)
const command:TeamEditCommand={conversationRef:'opaque-conversation',messageRef:'opaque-message',revisionUid:'stable-edit',version:1,content:{template_kind:1,text_content:'new'}}
await sdk.editTeamMessage(command,lifecycle.signal)
assert.equal((await sdk.readTeamEditReceipt(command.conversationRef,command.messageRef,command.revisionUid,lifecycle.signal)).accepted,true)
assert.deepEqual(calls.find(c=>c.operation==='team.messages.edit')?.params.command,command)
supported=false
await assert.rejects(sdk.readTeamMessageSnapshot('opaque-conversation','opaque-message'),/Provider/)
lifecycle.abort()
await assert.rejects(sdk.readTeamMessageSnapshot('opaque-conversation','opaque-message',lifecycle.signal))
console.log('external Team snapshot SDK consumer: passed')
