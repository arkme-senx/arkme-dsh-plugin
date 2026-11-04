import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'
import { withArkmeConfirmationContext } from '../../shared/conversational-confirmation.js'
import { recordingVoiceRules } from '../../../recording-voice-trigger-contract.js'

export const recordingVoiceReadTool = defineArkmeCoreToolModule({
 meta: { id: 'business.recordings.voice-triggers.v2', toolName: 'arkme_recording_voice_triggers', kind: 'business', phase: 'core', effect: 'read', profiles: ['business', 'hybrid'] },
 create: ports => defineTool({
  name: 'arkme_recording_voice_triggers', description: 'Read recording voice-trigger settings or candidate pages, or resolve one candidate to existing opaque playback/speaker references. Detection uses formal transcript candidates and paid semantic interpretation. Does not start analysis, save notes, train speakers or enable ongoing AI charges.',
  parameters: { action: {type:'string',required:true,enum:['settings','page','detail']}, cursor:{type:'string'},candidate_ref:{type:'string'} }, output: TEXT_OUTPUT, isConcurrencySafe:()=>true,
  execute: async(args,exec)=>{
   if (!['settings','page','detail'].includes(args.action)) throw new Error('不支持的语音触发读取操作')
   const current=await ports.recordingVoiceTriggers('settings',{},exec.signal) as import('../../../recording-voice-trigger-contract.js').RecordingVoiceSettings
   const scope=current.accountKey
   if(args.action==='settings')return taggedJSON('录音语音触发',current)
   return taggedJSON('录音语音触发',await ports.recordingVoiceTriggers(args.action as 'settings'|'page'|'detail',{accountKey:scope,cursor:args.cursor,candidateRef:args.candidate_ref},exec.signal))
  },
 }),
})
export const recordingVoiceWriteTool = defineArkmeCoreToolModule({
 meta: { id: 'business.recordings.voice-trigger-command.v2', toolName: 'arkme_recording_voice_trigger_command', kind: 'business', phase: 'core', effect: 'write', grant:'explicit-user-write', profiles: ['business','hybrid'] },
 create:ports=>{
  const prepare=async(args:{action?:unknown;rules_json?:unknown;candidate_ref?:unknown;decision?:unknown;confirmed_range?:unknown},signal?:AbortSignal)=>{
   const current=await ports.recordingVoiceTriggers('settings',{},signal) as import('../../../recording-voice-trigger-contract.js').RecordingVoiceSettings
   const scope=current.accountKey
   if(args.action==='rules-set'){
    if(typeof args.rules_json!=='string'||args.rules_json.length>30000)throw new Error('请提供完整规则')
    const rules=recordingVoiceRules(JSON.parse(args.rules_json))
    return {action:'save' as const,input:{accountKey:scope,rules,revision:current.revision,localRevision:current.draft.revision}}
   }
   if(args.action!=='decide'||typeof args.candidate_ref!=='string'||!['save','ignore'].includes(String(args.decision)))throw new Error('请明确候选与保存或忽略动作')
   return {action:'decide' as const,input:{accountKey:scope,candidateRef:args.candidate_ref,decision:args.decision,confirmedRange:args.confirmed_range===true}}
  }
  const execute=async(prepared:Awaited<ReturnType<typeof prepare>>,signal?:AbortSignal)=>taggedJSON('录音语音触发',await ports.recordingVoiceTriggers(prepared.action,prepared.input,signal))
  return withArkmeConfirmationContext(defineTool({
   name:'arkme_recording_voice_trigger_command',description:'Only on an explicit current human request: replace voice-trigger rules, save one confirmed candidate, or ignore it. Rules never enable automatic AI allowance usage. For an uncertain boundary, saving requires explicit confirmation of the displayed current text (confirmed_range). Saving does not label or train a speaker. A pending save is accepted, not a completed Record receipt.',
   parameters:{action:{type:'string',required:true,enum:['rules-set','decide']},rules_json:{type:'string'},candidate_ref:{type:'string'},decision:{type:'string',enum:['save','ignore']},confirmed_range:{type:'boolean'}},output:TEXT_OUTPUT,
   execute:async(args,exec)=>execute(await prepare(args,exec.signal),exec.signal),
  }),{prepare:(args,exec)=>prepare(args as Parameters<typeof prepare>[0],exec.signal),execute:(_args,exec,prepared)=>execute(prepared,exec.signal)})
 },
})
