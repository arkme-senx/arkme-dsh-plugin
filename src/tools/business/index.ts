import type { ArkmeToolModule } from '../contract/module.js'
import { userProfileToolModule } from './account/profile.js'
import { listSourcesToolModule } from './conversation/list-sources.js'
import { readSourceToolModule } from './conversation/read-source.js'
import { sendTextToolModule } from './conversation/send-text.js'
import { readImageToolModule } from './media/read-image.js'
import { createRecordToolModule } from './records/create.js'
import { recentRecordsToolModule } from './records/recent.js'
import { searchRecordsToolModule } from './records/search.js'

/** Stable model-facing order retained from the pre-catalog registration path. */
export const businessToolModules: readonly ArkmeToolModule[] = [
  recentRecordsToolModule,
  userProfileToolModule,
  searchRecordsToolModule,
  createRecordToolModule,
  listSourcesToolModule,
  readSourceToolModule,
  sendTextToolModule,
  readImageToolModule,
]
