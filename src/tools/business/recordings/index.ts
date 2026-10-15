import { recordingEntityToolModule, recordingEntityStartToolModule } from './entities.js'
import { speakerPresenceToolModule } from './speaker-presence.js'
import { recordingImportToolModule } from './import.js'
import { recordingImportFolderToolModule } from './import-folder.js'

// Local file acquisition stays in the plugin. Transcript/calendar reads belong to OpenAPI; speaker statistics share the directory Host owner.
export const recordingToolModules = [recordingEntityToolModule, recordingEntityStartToolModule, recordingImportToolModule, recordingImportFolderToolModule, speakerPresenceToolModule] as const
