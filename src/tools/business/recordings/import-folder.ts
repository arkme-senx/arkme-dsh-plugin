import { defineTool } from '@deepseek-ai/dsh-tools'
import type { PreparedRecordingDirectory, RecordingDirectoryInput, RecordingDirectoryResult } from '../../../recording-directory-import.js'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { withArkmeConfirmationContext } from '../../shared/conversational-confirmation.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'

function directoryInput(value: unknown): RecordingDirectoryInput {
  const args = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
  if (args.action !== 'prepare' && args.action !== 'upload') {
    throw new TypeError('请指定 action：prepare 只读预检，upload 上传已确认的录音')
  }
  if (typeof args.directory_path !== 'string' || args.directory_path.trim() === ''
    || (args.recursive !== undefined && typeof args.recursive !== 'boolean')
    || (args.ownership !== undefined && args.ownership !== 'self' && args.ownership !== 'other')
    || (args.start_times !== undefined && !Array.isArray(args.start_times))) {
    throw new TypeError('请提供录音目录、是否包含子目录以及 self/other 归属')
  }
  const paths = new Set<string>()
  const startTimes = (args.start_times as unknown[] | undefined)?.map(value => {
    const row = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
    if (typeof row.relative_path !== 'string' || row.relative_path.trim() === '' || paths.has(row.relative_path)
      || typeof row.start_at_millis !== 'number' || !Number.isSafeInteger(row.start_at_millis)
      || row.start_at_millis < 0 || row.start_at_millis > Date.now()) {
      throw new TypeError('逐文件录音时间需要唯一相对路径和有效的真实录音开始时间')
    }
    paths.add(row.relative_path)
    return { relativePath: row.relative_path, startAtMillis: row.start_at_millis }
  })
  startTimes?.sort((left, right) => left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0)
  return {
    directoryPath: args.directory_path, recursive: args.recursive ?? true, ownership: args.ownership ?? 'self',
    ...(startTimes === undefined || startTimes.length === 0 ? {} : { startTimes }),
  }
}

function directoryConfirmationRequest(value: unknown): { arguments: RecordingDirectoryInput; forcePrepare: boolean } {
  const input = directoryInput(value)
  return { arguments: input, forcePrepare: (value as Record<string, unknown>).action === 'prepare' }
}

function directoryPreviewResult(prepared: PreparedRecordingDirectory): string {
  return taggedJSON('Arkme 目录录音预检结果', {
    total: prepared.scan.files.length, skipped: prepared.scan.skipped,
    items: prepared.preview.map(item => ({ relative_path: item.relativePath, outcome: item.outcome })),
  })
}

function directoryResult(result: RecordingDirectoryResult): string {
  return taggedJSON('Arkme 目录录音导入结果', {
    total: result.total, skipped: result.skipped, remaining: result.remaining,
    counts: {
      uploaded: result.counts.uploaded, matched_uploaded: result.counts.matched_uploaded,
      in_progress: result.counts.in_progress, failed: result.counts.failed, cancelled: result.counts.cancelled, conflict: result.counts.conflict,
      time_required: result.counts.time_required, invalid: result.counts.invalid,
    },
    items: result.items.map(item => ({
      relative_path: item.relativePath, outcome: item.outcome,
      ...(item.importRef === undefined ? {} : { import_ref: item.importRef }),
      ...(item.revision === undefined ? {} : { revision: item.revision }),
      ...(item.errorCode === undefined ? {} : {
        error_code: /^[a-zA-Z][a-zA-Z0-9_-]{0,127}$/.test(item.errorCode)
          ? item.errorCode : 'recording-directory-file-failed',
      }),
      ...(item.message === undefined || item.outcome === 'uploaded' || item.outcome === 'matched_uploaded' ? {} : {
        error_message: item.outcome === 'time_required' ? '请提供该文件的真实录音开始时间。'
          : item.outcome === 'conflict' ? '同名录音信息不一致，请核对后重试。'
            : '该文件未完成导入，请检查文件或原任务后重试。',
      }),
    })),
    ...(result.stopped === undefined ? {} : { stopped: result.stopped }),
  })
}

function directoryConfirmation(input: RecordingDirectoryInput, prepared: PreparedRecordingDirectory): string | undefined {
  const count = (outcome: string) => prepared.preview.filter(item => item.outcome === outcome).length
  const upload = count('pending_upload')
  const resume = count('pending_resume')
  if (upload + resume === 0) return undefined
  const directory = input.directoryPath.replace(/[\u0000-\u001F\u007F]/g, ' ').slice(0, 512)
  const issues = prepared.preview.filter(item => ['time_required', 'conflict', 'invalid'].includes(item.outcome))
    .map(item => ({ relative_path: item.relativePath, outcome: item.outcome }))
  const details = issues.length === 0 ? '' : `\n需处理文件：${JSON.stringify(issues)}\n`
  const timeHint = count('time_required') === 0 ? '' : '可先补充时间待补文件的真实开始时间。'
  return `目录“${directory}”${input.recursive ? '及其子目录' : '本层'}已核对：待上传 ${upload} 个，待核对恢复 ${resume} 个，已匹配上传 ${count('matched_uploaded')} 个，同名冲突 ${count('conflict')} 个，时间待补 ${count('time_required')} 个，无效文件 ${count('invalid')} 个。${details}${timeHint}是否确认上传本次待处理录音，归属为“${input.ownership === 'other' ? '其他' : '自己'}”？`
}

export const recordingImportFolderToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.recordings.import-folder.v1', toolName: 'arkme_recording_import_folder',
    kind: 'business', phase: 'core', effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'],
  },
  create: ports => withArkmeConfirmationContext<PreparedRecordingDirectory>(defineTool({
    name: 'arkme_recording_import_folder',
    description: 'Import WAV, MP3 and M4A recordings from a human-selected local absolute or ~/ directory. Use action=prepare to check or refresh cloud matches without uploading, directly once the directory is known. The preflight returns one final confirmation with upload counts, exceptional file paths and ownership, which defaults to self. Only after a later human confirmation use action=upload with the same directory, scope, ownership and recording times; missing, expired or changed confirmation scope requires a fresh confirmation. Includes subdirectories by default and does not follow symlinks. Filename YYYYMMDD-HHMMSS uses the host local timezone; use start_times for unknown recording times. matched_uploaded means metadata match and upload finalization, not content hash verification. Returns after Audio receives the uploads; transcription is separate.',
    parameters: {
      action: { type: 'string', enum: ['prepare', 'upload'], required: true, description: 'Use prepare for read-only preflight or refresh; use upload after the human confirms the returned scope.' },
      directory_path: { type: 'string', required: true, description: 'Exact local absolute or ~/ recording directory selected by the human.' },
      recursive: { type: 'boolean', description: 'Include subdirectories; defaults to true.' },
      ownership: { type: 'string', enum: ['self', 'other'], description: 'Recording ownership; defaults to self.' },
      start_times: {
        type: 'array', description: 'Actual per-file recording starts when filename time is unknown or needs correction.',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            relative_path: { type: 'string', required: true, description: 'Exact path relative to directory_path.' },
            start_at_millis: { type: 'integer', required: true, description: 'Actual recording start in Unix milliseconds.' },
          },
        },
      },
    },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    execute: async (args, exec) => {
      exec.signal?.throwIfAborted()
      const input = directoryInput(args)
      const prepared = await ports.prepareRecordingDirectory(input, exec.signal)
      if (args.action === 'prepare') return directoryPreviewResult(prepared)
      return directoryResult(await ports.importRecordingDirectory(input, prepared, exec.signal))
    },
  }), {
    confirmationRequest: directoryConfirmationRequest,
    question: (args, prepared) => directoryConfirmation(directoryInput(args), prepared),
    prepare: async (args, exec): Promise<PreparedRecordingDirectory> => {
      exec.signal?.throwIfAborted()
      return await ports.prepareRecordingDirectory(directoryInput(args), exec.signal)
    },
    execute: async (args, exec, prepared) => {
      exec.signal?.throwIfAborted()
      const request = directoryConfirmationRequest(args)
      if (request.forcePrepare) return directoryPreviewResult(prepared)
      return directoryResult(await ports.importRecordingDirectory(request.arguments, prepared, exec.signal))
    },
  }),
})
