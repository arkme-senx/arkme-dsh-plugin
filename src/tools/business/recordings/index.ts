import { recordingImportToolModule } from './import.js'
import { recordingImportFolderToolModule } from './import-folder.js'

// Local file acquisition stays in the plugin. Recording reads belong to OpenAPI.
export const recordingToolModules = [recordingImportToolModule, recordingImportFolderToolModule] as const
