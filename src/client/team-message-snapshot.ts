import type { TeamCaptureContext, TeamEditMetadata, TeamRecordMetadata } from '../team-snapshot-contract.js'
import { callArkme } from './api.js'
import { arkmeRecordInputBrowserName, arkmeRecordInputComputerName } from './record-input-capture.js'
import { captureArkmeRecordLocation, ArkmeLocationCaptureError } from './record-capture-location.js'

export interface PreparedTeamCapture { protocolVersion: 0 | 1; metadataRef?: string; notice?: string }
export async function prepareTeamCapture(input: { accountKey: string; conversationRef: string; operationUid: string; completeAt: number; startedAt?: number; messageRef?: string }, signal: AbortSignal): Promise<PreparedTeamCapture> {
  let protocolVersion: 0 | 1 = 0
  try {
    const capability = await callArkme<{schemaVersion:0|1}>('team.app.snapshot.capabilities', {expectedAccountKey:input.accountKey}, signal)
    signal.throwIfAborted()
    if (capability?.schemaVersion !== 1) return {protocolVersion,notice:'本次消息未保存记忆快照，服务暂不支持。'}
    protocolVersion = 1
    const source = typeof navigator === 'undefined' ? undefined : {userAgent:navigator.userAgent}
    const computer = arkmeRecordInputComputerName(source)
    const capture: TeamCaptureContext = {schema_version:1,captured_at:Date.now(),device_state:computer === '未知电脑' ? 'unavailable' : 'recorded',location_state:'not_recorded',
      ...(computer === '未知电脑' ? {} : {client_name:`${computer}（${arkmeRecordInputBrowserName(source)}）`})}
    const controller = new AbortController(), abort = () => controller.abort(signal.reason)
    signal.addEventListener('abort',abort,{once:true})
    const timeout = globalThis.setTimeout(()=>controller.abort(new Error('location deadline')),2500)
    try {
      const location = await Promise.race([
        captureArkmeRecordLocation('automatic-send',undefined,controller.signal),
        new Promise<never>((_,reject)=>controller.signal.addEventListener('abort',()=>reject(controller.signal.reason),{once:true})),
      ])
      capture.location_state='recorded'
      capture.automatic_location={lat:location.latitude,lon:location.longitude,captured_at:location.capturedAtMillis,...(location.accuracyMeters===undefined?{}:{accuracy_meters:location.accuracyMeters})}
    } catch(error) {
      signal.throwIfAborted()
      capture.location_state=error instanceof ArkmeLocationCaptureError
        ? ['denied','restricted','prompt'].includes(error.failure) ? 'permission_denied' : error.failure==='services-disabled' ? 'disabled' : ['unavailable','position-unavailable'].includes(error.failure) ? 'unavailable' : 'failed'
        : 'failed'
    } finally {globalThis.clearTimeout(timeout);signal.removeEventListener('abort',abort)}
    signal.throwIfAborted()
    const start = typeof input.startedAt==='number' && Number.isSafeInteger(input.startedAt) && input.startedAt>0 && input.startedAt<=input.completeAt ? input.startedAt : undefined
    const metadata: TeamRecordMetadata | TeamEditMetadata = input.messageRef
      ? {revision_uid:input.operationUid,revision_edit_at:input.completeAt,...(start===undefined?{}:{edit_duration_millis:input.completeAt-start}),edit_capture_context:capture}
      : {...(start===undefined?{}:{record_started_at:start}),send_at:input.completeAt,capture_context:capture}
    const sealed = await callArkme<{metadataRef:string}>('team.app.snapshot.seal',{expectedAccountKey:input.accountKey,conversationRef:input.conversationRef,operationUid:input.operationUid,kind:input.messageRef?'edit':'send',...(input.messageRef?{messageRef:input.messageRef}:{}),metadata},signal)
    if (!sealed?.metadataRef) throw new Error('capture seal unavailable')
    return {protocolVersion,metadataRef:sealed.metadataRef}
  } catch(error) {
    signal.throwIfAborted()
    return {protocolVersion,notice:'本次消息未保存记忆快照，采集或本机保存暂不可用。'}
  }
}
