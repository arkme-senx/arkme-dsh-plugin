import {createArkmeSdk,type RecordingEvidenceQuery,type RecordingEvidenceResult,type ArkmeRecordingSpeakerCorrectionPreview} from '@senguoyun/dsh-arkme/sdk'
const controller=new AbortController()
const sdk=createArkmeSdk({fetchImpl:async(_url,init)=>{init?.signal?.throwIfAborted();const {operation}=JSON.parse(String(init?.body));return new Response(JSON.stringify({ok:true,value:operation==='recordings.speaker.correction.preview'?{affectedCount:1,intentToken:'signed',expiresAt:1,selectionVersion:'s',evidenceVersion:'e'}:{supported:true,schema_version:1,actions:['compare']}}))}})
const query:RecordingEvidenceQuery={action:'capabilities'}
const result:RecordingEvidenceResult=await sdk.recordingSpeakerEvidence(query,controller.signal)
if(!('supported' in result)||!result.supported)throw new Error('SDK capability lost')
const preview:ArkmeRecordingSpeakerCorrectionPreview=await sdk.previewRecordingSpeakerCorrection({itemRef:'opaque',itemRefs:['opaque'],detach:true,expectedVersion:'s',idempotencyKey:'external-consumer-001'})
if(preview.intentToken!=='signed')throw new Error('SDK preview contract lost')
controller.abort();let aborted=false;try{await sdk.recordingSpeakerEvidence(query,controller.signal)}catch{aborted=true};if(!aborted)throw new Error('cancellation lost')
console.log('external public evidence SDK consumer passed')
