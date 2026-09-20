import type { PreparedRecordingDirectory, RecordingDirectoryItem, RecordingDirectoryPreviewItem, RecordingDirectoryResult } from '../../src/recording-directory-import.js'

export function preparedDirectory(
  preview: RecordingDirectoryPreviewItem[] = [{ relativePath: 'meeting.wav', outcome: 'pending_upload' }],
): PreparedRecordingDirectory {
  return { expectedUserId: 42, preview, scan: { skipped: 0, files: preview.map(item => ({
    relativePath: item.relativePath, fileName: item.relativePath.split('/').at(-1)!,
    fileSize: 1024, sourceSnapshot: `fixture-source:${item.relativePath}`,
    startAtMillis: item.outcome === 'time_required' ? undefined : Date.UTC(2026, 0, 1),
  })) } }
}

export function directoryResult(
  items: RecordingDirectoryItem[] = [{ relativePath: 'meeting.wav', outcome: 'uploaded' }],
): RecordingDirectoryResult {
  const counts: RecordingDirectoryResult['counts'] = {
    uploaded: 0, matched_uploaded: 0, in_progress: 0, failed: 0, cancelled: 0,
    conflict: 0, time_required: 0, invalid: 0,
  }
  for (const item of items) counts[item.outcome] += 1
  return { total: items.length, skipped: 0, remaining: 0, items, counts }
}
