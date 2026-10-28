import { defineTool } from '@deepseek-ai/dsh-tools'
import type { PublicRecordingImportJob } from '../../../recording-import-contract.js'
import { isRecordingInstantOnOrAfterUnixEpoch } from '../../../recording-time.js'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'

function importFacts(job: PublicRecordingImportJob) {
  const failureMessage = job.retryable ? '录音导入失败，可使用最新任务版本重试。' : '录音导入失败，请在录音导入页面查看原因。'
  return {
    import_ref: job.importRef, revision: job.revision, phase: job.phase,
    file_name: job.fileName, file_size: job.fileSize, ownership: job.ownership,
    start_at_millis: job.startAtMillis, end_at_millis: job.endAtMillis,
    duration_millis: job.durationMillis, progress: job.progress,
    ...(job.errorCode === undefined ? {} : { error_code: job.errorCode }),
    ...(job.errorMessage === undefined ? {} : { error_message: failureMessage }),
    retryable: job.retryable ?? false,
    workflow: job.batch ? { batch_id: job.batch.batchId, item_index: job.batch.itemIndex, item_count: job.batch.itemCount,
      time_zone: job.batch.timeZone, state: 'awaiting_processing' } : { state: 'untracked' },
  }
}
function importResult(job: PublicRecordingImportJob): string { return taggedJSON('Arkme 录音导入任务', importFacts(job)) }

export const recordingImportToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.recordings.import.v1', toolName: 'arkme_recording_import',
    kind: 'business', phase: 'core', effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'],
  },
  create: ports => defineTool({
    name: 'arkme_recording_import',
    description: 'Upload staged WAV, MP3 or M4A recordings, query upload status, or retry a failed upload. Upload and retry require a human request and confirmation. New submissions snapshot the account recording preference; change it using arkme_recording_strategy_preference before submitting, not per file. For multiple recordings from one user request, pass ALL of them in files in ONE upload call so they share a durable batch, rather than making separate uploads. Use file_ref from arkme_files_list, arkme_file_prepare or arkme_file_receive and actual recording start times; ask if unknown. Use arkme_recording_import_folder for a local directory. Query with import_ref; retry with that reference and its latest revision. phase=accepted means the upload was received, not that transcription is ready. Batch processing and automatic daily summaries/timelines are server-owned; inspect arkme_recording_notifications, do not launch duplicate generation. workflow=untracked means the upload has no automatic workflow (legacy or explicitly unsupported server). If no task reference was received, retry the SAME file references and recording times to recover saved membership; never invent a new batch.',
    parameters: {
      action: { type: 'string', enum: ['upload', 'status', 'retry'], required: true },
      file_ref: { type: 'string', description: 'Upload only: unchanged authorized local file reference.' },
      files: { type: 'array', description: 'Upload only: all files in one requested batch. Mutually exclusive with top-level file_ref/start_at_millis. Ownership applies to all.',
        items: { type: 'object', additionalProperties: false, properties: {
          file_ref: { type: 'string', required: true }, start_at_millis: { type: 'integer', required: true },
        } } },
      start_at_millis: { type: 'integer', description: 'Upload only: actual recording start instant in Unix milliseconds, not the upload time.' },
      ownership: { type: 'string', enum: ['self', 'other'], description: 'Upload only: self (default) or other (unbound recording ownership).' },
      import_ref: { type: 'string', description: 'Status/retry only: unchanged import_ref returned by this tool.' },
      revision: { type: 'integer', description: 'Retry only: latest revision from status, at least 1.' },
    },
    output: TEXT_OUTPUT,
    isConcurrencySafe: args => args.action === 'status',
    execute: async (args, exec) => {
      exec.signal?.throwIfAborted()
      if (args.action === 'upload') {
        if (args.files !== undefined) {
          if (!Array.isArray(args.files) || !args.files.length || args.files.length > 10_000
            || args.file_ref !== undefined || args.start_at_millis !== undefined || args.import_ref !== undefined || args.revision !== undefined
            || (args.ownership !== undefined && !['self', 'other'].includes(args.ownership))) throw new TypeError('批量上传参数无效，不能混用单文件或查询参数')
          const inputs = args.files.map(row => {
            if (typeof row.file_ref !== 'string' || !/^arkme-file-v1\.[0-9a-f-]{36}$/.test(row.file_ref)
              || !Number.isSafeInteger(row.start_at_millis) || !isRecordingInstantOnOrAfterUnixEpoch(row.start_at_millis)
              || row.start_at_millis > Date.now()) throw new TypeError('每个文件需要有效引用和真实录音开始时间')
            return { fileRef: row.file_ref, startAtMillis: row.start_at_millis, ownership: args.ownership ?? 'self' as const }
          })
          if (new Set(inputs.map(input => input.fileRef)).size !== inputs.length) throw new TypeError('同一批次不能重复包含文件引用')
          const result = await ports.importRecordingFiles(inputs, exec.signal)
          return taggedJSON('Arkme 批量录音导入任务', { workflow_supported: result.supported, batch_ids: result.batchIds,
            remaining: result.remaining, items: result.items.map(item => ({ file_ref: item.fileRef,
              ...(item.job ? importFacts(item.job) : item.outcome ? { outcome: item.outcome, workflow: { state: 'existing_upload' } } : { error_code: item.errorCode }) })) })
        }
        if (typeof args.file_ref !== 'string' || !/^arkme-file-v1\.[0-9a-f-]{36}$/.test(args.file_ref)
          || !Number.isSafeInteger(args.start_at_millis)
          || !isRecordingInstantOnOrAfterUnixEpoch(args.start_at_millis!) || args.start_at_millis! > Date.now()
          || (args.ownership !== undefined && args.ownership !== 'self' && args.ownership !== 'other')
          || args.import_ref !== undefined || args.revision !== undefined) {
          throw new TypeError('上传需要有效文件引用、真实录音开始时间和 self/other 归属；不能混用任务查询参数')
        }
        return importResult(await ports.importRecordingFile({
          fileRef: args.file_ref, startAtMillis: args.start_at_millis!, ownership: args.ownership ?? 'self',
        }, exec.signal))
      }
      if ((args.action !== 'status' && args.action !== 'retry')
        || typeof args.import_ref !== 'string' || args.import_ref.trim() === '' || args.import_ref.length > 4096
        || args.file_ref !== undefined || args.files !== undefined || args.start_at_millis !== undefined || args.ownership !== undefined
        || (args.action === 'status' && args.revision !== undefined)
        || (args.action === 'retry' && (!Number.isSafeInteger(args.revision) || args.revision! < 1))) {
        throw new TypeError('查询需要原任务引用；重试还需要最新任务版本，不能混用上传参数')
      }
      return importResult(args.action === 'status'
        ? await ports.recordingImportStatus(args.import_ref)
        : await ports.retryRecordingImport(args.import_ref, args.revision!, exec.signal))
    },
  }),
})
