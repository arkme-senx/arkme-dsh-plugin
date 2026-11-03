import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'
import { recordingStorageSessionRefs } from '../../../recording-file-storage.js'

export const recordingFileStorageTool = defineArkmeCoreToolModule({
  meta: { id: 'business.recordings.file-storage.v1', toolName: 'arkme_recording_file_storage', kind: 'business', phase: 'core', effect: 'read', profiles: ['business', 'hybrid'] },
  create: ports => defineTool({
    name: 'arkme_recording_file_storage',
    description: 'Read observed server storage bytes for up to 20 owned recording files. Obtain opaque session_ref values using arkme_recording_strategies action=recordings. Includes formal playback and enhancement audio, including retained historical audio; excludes uploaded originals, temporary processing data and independent strategy comparisons. Successful reads always contain numeric bytes from accepted media. Current values may grow as more media is accepted. Read-only: no processing, billing, cleanup or repair is triggered.',
    parameters: { session_refs: { type: 'array', items: { type: 'string' }, required: true, description: 'One to twenty distinct opaque session_ref values.' } },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    execute: async (args, exec) => taggedJSON('录音文件云端存储', await ports.recordingFileStorage({ sessionRefs: recordingStorageSessionRefs(args.session_refs) }, exec.signal)),
  }),
})
