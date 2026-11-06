import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'
import { withArkmeConfirmationContext } from '../../shared/conversational-confirmation.js'
import { parseSpeechQuery, speechText } from '../../../recording-speech-statistics.js'

export const speechReadTool = defineArkmeCoreToolModule({
  meta: { id: 'business.recordings.self-speech-read.v2', toolName: 'arkme_self_speech', kind: 'business', phase: 'core', effect: 'read', profiles: ['business', 'hybrid'] },
  create: ports => defineTool({
    name: 'arkme_self_speech',
    description: 'Read the current account’s original-audio self-speech statistics for an IANA natural day, or immutable occurrence pages (50). Does not generate analysis. Verified frequency and contextual habit usage are different; pending words never count as verified. Report coverage and stale/unsupported states, not false zero. Source returns an opaque playback reference and optional actual transcript target; original ASR can omit the spoken word.',
    parameters: { action: { type: 'string', required: true, enum: ['capabilities', 'state', 'occurrences', 'source'] }, date: { type: 'string' }, timezone: { type: 'string' }, result_id: { type: 'string' }, term_key: { type: 'string' }, mode: { type: 'string', enum: ['habit', 'all'] }, cursor: { type: 'string' }, source_ref: { type: 'string' }, source_action: { type: 'string', enum: ['play', 'locate'] } },
    output: TEXT_OUTPUT, isConcurrencySafe: () => true,
    execute: async (args, exec) => {
      const capability = await ports.recordingSpeechCapabilities(exec.signal)
      if (args.action === 'capabilities' || !capability.supported) return taggedJSON('本人原音统计能力', capability)
      const query = parseSpeechQuery({ accountScope: capability.accountScope, date: args.date, timezone: args.timezone })
      if (args.action === 'state') return taggedJSON('本人原音统计', await ports.recordingSpeechState(query, exec.signal))
      const resultId = speechText(args.result_id)
      if (args.action === 'occurrences') {
        if (args.mode !== 'habit' && args.mode !== 'all') throw new Error('请选择 habit 或 all')
        return taggedJSON('原音出现页', await ports.recordingSpeechOccurrences({ ...query, resultId, termKey: speechText(args.term_key), mode: args.mode, ...(args.cursor ? { cursor: speechText(args.cursor, 4096) } : {}) }, exec.signal))
      }
      if (args.action === 'source' && (args.source_action === 'play' || args.source_action === 'locate')) return taggedJSON('原音来源', await ports.recordingSpeechSource({ ...query, resultId, sourceRef: speechText(args.source_ref, 4096), action: args.source_action }, exec.signal))
      throw new Error('原音统计读取操作无效')
    },
  }),
})
export const speechGenerateTool = defineArkmeCoreToolModule({
  meta: { id: 'business.recordings.self-speech-generate.v2', toolName: 'arkme_self_speech_generate', kind: 'business', phase: 'core', effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'] },
  create: ports => {
    const prepare = async (args: { date?: unknown; timezone?: unknown; request_id?: unknown }, signal?: AbortSignal) => {
      const capability = await ports.recordingSpeechCapabilities(signal)
      if (!capability.supported) throw new Error('原音统计尚未就绪')
      const query = parseSpeechQuery({ accountScope: capability.accountScope, date: args.date, timezone: args.timezone })
      const requestId = speechText(args.request_id, 100)
      if (!/^[a-zA-Z0-9-]{16,100}$/.test(requestId)) throw new Error('request_id 需要稳定的 16 至 100 位标识；重试必须沿用')
      return { ...query, requestId }
    }
    const execute = async (input: Awaited<ReturnType<typeof prepare>>, signal?: AbortSignal) => taggedJSON('本人原音统计受理状态', await ports.recordingSpeechCreate(input, signal))
    return withArkmeConfirmationContext<Awaited<ReturnType<typeof prepare>>>(defineTool({
      name: 'arkme_self_speech_generate', description: 'Only after an explicit current human request, generate the current account’s original-audio self-speech statistics for one date and IANA timezone. This may incur contextual classification charges. Requires the session’s write grant and existing human confirmation. Reuse the same request_id for all retries, including after ready; acceptance is not completion. Never enable continuous processing or train a speaker.',
      parameters: { date: { type: 'string', required: true }, timezone: { type: 'string', required: true }, request_id: { type: 'string', required: true } }, output: TEXT_OUTPUT,
      execute: async (args, exec) => execute(await prepare(args, exec.signal), exec.signal),
    }), { question: (_args, input) => `是否确认分析 ${input.date}（${input.timezone}）当天已确认属于你的原音？表达用法分类可能使用 AI 点数。`, prepare: (args, exec) => prepare(args as Parameters<typeof prepare>[0], exec.signal), execute: (_args, exec, prepared) => execute(prepared, exec.signal) })
  },
})
