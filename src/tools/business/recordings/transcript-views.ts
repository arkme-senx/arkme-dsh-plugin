import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'
import type {
  TranscriptViewCommand,
  TranscriptViewReadItem,
} from '../../../transcript-view-contract.js'

const read = defineArkmeCoreToolModule({
  meta: {
    id: 'business.recordings.personal-transcript-read.v1',
    toolName: 'arkme_transcript_views',
    kind: 'business',
    phase: 'core',
    effect: 'read',
    profiles: ['business', 'hybrid'],
  },
  create: (ports) =>
    defineTool({
      name: 'arkme_transcript_views',
      description:
        'Read private recording/call transcript views. capabilities returns the current account_key; read needs that key, scope and items_json [{id,ref}] using owner-issued opaque references. saved returns historical private edits for one source, including resegmented targets; these are historical snapshots, never current ASR matches. receipt checks operation_id without resubmitting. Empty receipt does not prove a write failed. Does not change ASR, audio, speaker identity, summaries, word counts or another participant’s view.',
      parameters: {
        action: {
          type: 'string',
          required: true,
          enum: ['capabilities', 'read', 'saved', 'receipt'],
        },
        account_key: { type: 'string' },
        scope: { type: 'string' },
        items_json: { type: 'string' },
        ref: { type: 'string' },
        cursor: { type: 'string' },
        operation_id: { type: 'string' },
      },
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => true,
      execute: async (args, exec) => {
        if (args.action === 'capabilities')
          return taggedJSON(
            '个人转写能力',
            await ports.transcriptViewCapabilities(exec.signal),
          )
        if (!args.account_key) throw new TypeError('请先读取当前账号能力')
        if (args.action === 'receipt') {
          if (!args.operation_id) throw new TypeError('需要原操作编号')
          return taggedJSON(
            '更正回执',
            await ports.transcriptViewReceipt(
              args.account_key,
              args.operation_id,
              exec.signal,
            ),
          )
        }
        if (args.action === 'saved') {
          if (!args.ref) throw new TypeError('需要原片段引用')
          return taggedJSON(
            '历史个人更正',
            await ports.savedTranscriptViews(
              args.account_key,
              args.ref,
              args.cursor,
              exec.signal,
            ),
          )
        }
        if (
          args.action !== 'read' ||
          !args.scope ||
          !args.items_json ||
          args.items_json.length > 1000000
        )
          throw new TypeError('读取参数无效')
        return taggedJSON(
          '个人转写视图',
          await ports.readTranscriptViews(
            args.account_key,
            args.scope,
            JSON.parse(args.items_json) as TranscriptViewReadItem[],
            exec.signal,
          ),
        )
      },
    }),
})
const write = defineArkmeCoreToolModule({
  meta: {
    id: 'business.recordings.personal-transcript-write.v1',
    toolName: 'arkme_transcript_view_change',
    kind: 'business',
    phase: 'core',
    effect: 'write',
    grant: 'explicit-user-write',
    profiles: ['business', 'hybrid'],
  },
  create: (ports) =>
    defineTool({
      name: 'arkme_transcript_view_change',
      description:
        'Only on an explicit human request, change the current account’s private transcript view. Read the view first. command_json is the public TranscriptViewCommand: operation_id, expected_revision, original_version and exactly one action replace/restore/add_mark/remove_mark; retry_pending explicitly retries the stored frozen request after a restart without reconstructing it. A replacement/add uses an exact arkme-text-v1 SHA-256/UTF-16 anchor; never guess an occurrence. import-local explicitly uploads one existing local row with per-item acknowledgement and preserves it. Unknown outcomes retain the frozen request; inspect receipt and retry only with unchanged operation_id and payload. Never silently overwrite a conflict. Audio, original ASR, speakers, summaries and other people remain separate facts.',
      parameters: {
        action: {
          type: 'string',
          required: true,
          enum: ['change', 'import-local'],
        },
        account_key: { type: 'string', required: true },
        ref: { type: 'string', required: true },
        command_json: { type: 'string' },
        scope: { type: 'string' },
        id: { type: 'string' },
        operation_id: { type: 'string' },
      },
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => false,
      execute: async (args, exec) => {
        if (args.action === 'import-local') {
          if (!args.scope || !args.id || !args.operation_id)
            throw new TypeError('导入参数无效')
          return taggedJSON(
            '本机更正导入回执',
            await ports.importLocalTranscriptView(
              args.account_key,
              args.scope,
              { id: args.id, ref: args.ref },
              args.operation_id,
              exec.signal,
            ),
          )
        }
        if (
          args.action !== 'change' ||
          !args.command_json ||
          args.command_json.length > 4000000
        )
          throw new TypeError('更正参数无效')
        return taggedJSON(
          '个人转写更正',
          await ports.changeTranscriptView(
            args.account_key,
            args.ref,
            JSON.parse(args.command_json) as TranscriptViewCommand,
            exec.signal,
          ),
        )
      },
    }),
})
export const transcriptViewTools = [read, write] as const
