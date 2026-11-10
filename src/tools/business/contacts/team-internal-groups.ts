import {defineTool} from '@deepseek-ai/dsh-tools'
import {defineArkmeCoreToolModule} from '../../contract/module.js'
import {stableUidForToolCall} from '../../shared/stable-id.js'
import {taggedJSON, TEXT_OUTPUT} from '../../shared/output.js'

export const teamInternalGroupTools = [
  defineArkmeCoreToolModule({meta:{id:'business.team.internal-group-preview.v1', toolName:'arkme_team_internal_group_preview', kind:'business', phase:'core', effect:'read', profiles:['business','hybrid']}, create:ports=>defineTool({
    name:'arkme_team_internal_group_preview', description:'Preview creating a Team internal group or linking an existing personal group. Use the current account team profileRef and a selected group sourceRef. This does not accept any mutation. Show the exact added/removed people, role/owner changes, retained history, bots and public closure to the human before confirming. If an earlier request is unresolved, recover it; never create a replacement request.',
    parameters:{team_ref:{type:'string',required:true}, mode:{type:'string',enum:['create','link','original'],required:true}, name:{type:'string'}, source_ref:{type:'string'}}, output:TEXT_OUTPUT,
    execute:async(a,e)=>taggedJSON('内部群变更预览',await ports.teamInternalGroup(a.mode==='original' ? {teamRef:a.team_ref,action:'prepare-original'} : a.mode==='create'
      ? {teamRef:a.team_ref,action:'prepare',mode:'create',name:a.name??'',requestUid:stableUidForToolCall('team-internal-group',String(e.callId))}
      : {teamRef:a.team_ref,action:'prepare',mode:'link',sourceRef:a.source_ref??'',requestUid:stableUidForToolCall('team-internal-group',String(e.callId))},e.signal)),
  })}),
  defineArkmeCoreToolModule({meta:{id:'business.team.internal-group-status.v1', toolName:'arkme_team_internal_group_status', kind:'business', phase:'core', effect:'read', profiles:['business','hybrid']}, create:ports=>defineTool({
    name:'arkme_team_internal_group_status',description:'Recover the original pending internal-group command for this account and team. Activating means accepted and still synchronizing, not ready. Unresolved is not failure and must keep the same request UID when obtaining a renewed preview.',
    parameters:{team_ref:{type:'string',required:true}},output:TEXT_OUTPUT,isConcurrencySafe:()=>true,
    execute:async(a,e)=>taggedJSON('内部群原请求状态',await ports.teamInternalGroup({teamRef:a.team_ref,action:'recover'},e.signal)),
  })}),
  defineArkmeCoreToolModule({meta:{id:'business.team.internal-group-confirm.v1', toolName:'arkme_team_internal_group_confirm', kind:'business', phase:'core', effect:'write', grant:'explicit-user-write', profiles:['business','hybrid']}, create:ports=>defineTool({
    name:'arkme_team_internal_group_confirm',description:'Confirm only the exact previewRef whose full consequences the human explicitly accepted. Backend rechecks stale previews and never uses personal group CRUD to emulate a roster binding. On lost replies recover the original command. Acknowledge only a ready or archived final result after reporting it to the human.',
    parameters:{team_ref:{type:'string',required:true},action:{type:'string',enum:['confirm','ack'],required:true},preview_ref:{type:'string'},request_uid:{type:'string'}},output:TEXT_OUTPUT,
    execute:async(a,e)=>taggedJSON('内部群确认结果',await ports.teamInternalGroup(a.action==='ack'
      ? {teamRef:a.team_ref,action:'ack',requestUid:a.request_uid??''} : {teamRef:a.team_ref,action:'confirm',previewRef:a.preview_ref??''},e.signal)),
  })}),
] as const
