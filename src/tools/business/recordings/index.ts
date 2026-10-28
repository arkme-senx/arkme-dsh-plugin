import { recordingCorrectionContextToolModule, recordingCorrectionWriteToolModule } from './speaker-correction.js'
import { offlineContextTools } from './offline-context.js'
import { recordingEntityToolModule, recordingEntityStartToolModule } from './entities.js'
import { recordingWorkflowTools } from './workflow.js'
import { speakerPresenceToolModule } from './speaker-presence.js'
import { recordingImportToolModule } from './import.js'
import { recordingImportFolderToolModule } from './import-folder.js'

// Local file acquisition stays in the plugin. Transcript/calendar reads belong to OpenAPI; speaker statistics share the directory Host owner.
export const recordingToolModules = [...offlineContextTools, recordingCorrectionContextToolModule, recordingCorrectionWriteToolModule, recordingEntityToolModule, recordingEntityStartToolModule, ...recordingWorkflowTools, recordingImportToolModule, recordingImportFolderToolModule, speakerPresenceToolModule] as const
