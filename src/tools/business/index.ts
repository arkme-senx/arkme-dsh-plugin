import type { ArkmeToolModule } from '../contract/module.js'
import { accountBusinessToolModules } from './account/index.js'
import { listSourcesToolModule } from './conversation/list-sources.js'
import { readSourceToolModule } from './conversation/read-source.js'
import { sendDirectTextToolModule } from './conversation/send-direct-text.js'
import { sendTextToolModule } from './conversation/send-text.js'
import { aiVideoToolModule } from './media/ai-video.js'
import { readImageToolModule } from './media/read-image.js'
import { createRecordToolModule } from './records/create.js'
import { recentRecordsToolModule } from './records/recent.js'
import { searchRecordsToolModule } from './records/search.js'
import { worldPublishTextToolModule, worldRecentToolModule } from './world/index.js'
import { wechatToolModules } from './wechat/index.js'

/** Stable model-facing order retained from the pre-catalog registration path. */
export const businessToolModules: readonly ArkmeToolModule[] = [
  recentRecordsToolModule,
  ...accountBusinessToolModules,
  searchRecordsToolModule,
  createRecordToolModule,
  worldRecentToolModule,
  worldPublishTextToolModule,
  ...wechatToolModules,
  listSourcesToolModule,
  readSourceToolModule,
  sendTextToolModule,
  sendDirectTextToolModule,
  aiVideoToolModule,
  readImageToolModule,
]
