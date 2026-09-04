import { defineTool } from '@deepseek-ai/dsh-tools'
import type { PublicRecordingImportJob } from '../../../recording-import-contract.js'
import { isRecordingInstantOnOrAfterUnixEpoch } from '../../../recording-time.js'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'

function importResult(job: PublicRecordingImportJob): string {
  const failureMessage = job.retryable ? '录音导入失败，可使用最新任务版本重试。' : '录音导入失败，请在录音导入页面查看原因。'
  return taggedJSON('Arkme 录音导入任务', {
    import_ref: job.importRef, revision: job.revision, phase: job.phase,
    file_name: job.fileName, file_size: job.fileSize, ownership: job.ownership,
    start_at_millis: job.startAtMillis, end_at_millis: job.endAtMillis,
    duration_millis: job.durationMillis, progress: job.progress,
    ...(job.errorCode === undefined ? {} : { error_code: job.errorCode }),
    ...(job.errorMessage === undefined ? {} : { error_message: failureMessage }),
    retryable: job.retryable ?? false,
  })
}

export const recordingImportToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.recordings.import.v1', toolName: 'arkme_recording_import',
    kind: 'business', phase: 'core', effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'],
  },
  create: ports => defineTool({
    name: 'arkme_recording_import',
    description: 'Upload a staged WAV, MP3 or M4A recording, query its upload status, or retry a failed upload. Upload and retry require a human request and confirmation. Use file_ref from arkme_files_list, arkme_file_prepare or arkme_file_receive and the actual recording start time; ask for the time if unknown. Use arkme_recording_import_folder for recordings in a local directory. Query with import_ref; retry with that reference and its latest revision. phase=accepted means the upload was received. Read transcription and generated content with arkme_recording_read. If no task reference was received, check the recording import page before submitting again.',
    parameters: {
      action: { type: 'string', enum: ['upload', 'status', 'retry'], required: true },
      file_ref: { type: 'string', description: 'Upload only: unchanged authorized local file reference.' },
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
        || args.file_ref !== undefined || args.start_at_millis !== undefined || args.ownership !== undefined
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
