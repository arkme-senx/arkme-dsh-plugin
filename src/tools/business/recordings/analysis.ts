import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'

const models = defineArkmeCoreToolModule({
  meta: { id: 'business.recordings.analysis-models.v1', toolName: 'arkme_recording_analysis_models', kind: 'business', phase: 'core', effect: 'read', profiles: ['business', 'hybrid'] },
  create: ports => defineTool({
    name: 'arkme_recording_analysis_models',
    description: 'Read current-account models for one recording scene, summary or timeline. The returned accountScope is required for subsequent commands. Querying does not start analysis or spend AI points.',
    parameters: { kind: { type: 'string', enum: ['summary', 'timeline'], required: true } },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    execute: async (args, exec) => taggedJSON('录音分析模型', await ports.recordingAnalysis({ action: 'models', kind: args.kind }, exec.signal)),
  }),
})
const command = defineArkmeCoreToolModule({
  meta: { id: 'business.recordings.analysis-command.v1', toolName: 'arkme_recording_analysis', kind: 'business', phase: 'core', effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'] },
  create: ports => defineTool({
    name: 'arkme_recording_analysis',
    description: 'Only on explicit user instruction: select a future recording model, generate a NEW paid version, or CONTINUE the exact failed version with its frozen input/model and paid results. Uses existing AI points. Never regenerate just to poll or retry a network read. Model changes require generate. Never infer accountScope or versionId.',
    parameters: {
      action: { type: 'string', enum: ['select', 'generate', 'continue'], required: true },
      kind: { type: 'string', enum: ['summary', 'timeline'], required: true },
      account_scope: { type: 'string', required: true },
      route_key: { type: 'string', description: 'Exact route from models, required for select/generate.' },
      model_binding: { type: 'object', additionalProperties: false, description: 'Generate only: unchanged binding of the selected option returned by models. Never infer its identifiers.', properties: {
        catalogReleaseId: { type: 'string', required: true },
        offeringRevisionId: { type: 'string', required: true },
        publicModelCode: { type: 'string', required: true },
      } },
      date_stamp: { type: 'number', description: 'Generate: local day start in milliseconds. Continue: exact original task date stamp from its owner, without timezone conversion. Required for both.' },
      version_id: { type: 'string', description: 'Exact failed version ID, required only for continue.' },
    },
    output: TEXT_OUTPUT,
    execute: async (args, exec) => {
      const base = { kind: args.kind, accountScope: args.account_scope }
      if (args.action === 'select') {
        if (!args.route_key) throw new Error('select requires route_key')
        return taggedJSON('录音模型偏好', await ports.recordingAnalysis({ ...base, action: 'select', routeKey: args.route_key }, exec.signal))
      }
      if (args.date_stamp === undefined) throw new Error('generate/continue requires date_stamp')
      if (args.action === 'generate') {
        if (!args.route_key) throw new Error('generate requires route_key')
        if (!args.model_binding) throw new Error('generate requires model_binding from models')
        return taggedJSON('录音新版本', await ports.recordingAnalysis({ ...base, action: 'generate', routeKey: args.route_key, dateStamp: args.date_stamp, binding: args.model_binding }, exec.signal))
      }
      if (!args.version_id) throw new Error('continue requires version_id')
      return taggedJSON('录音原任务继续', await ports.recordingAnalysis({ ...base, action: 'continue', versionId: args.version_id, dateStamp: args.date_stamp }, exec.signal))
    },
  }),
})
export const recordingAnalysisTools = [models, command] as const
