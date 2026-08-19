import { arkoToolModules } from './arko/index.js'
import type { ArkmeToolModule } from '../contract/module.js'
import { accountBusinessToolModules } from './account/index.js'
import { listSourcesToolModule } from './conversation/list-sources.js'
import { groupAiPolishToolModule } from './conversation/group-ai-polish.js'
import { readSourceToolModule } from './conversation/read-source.js'
import { relatedRecordingsToolModule } from './conversation/related-recordings.js'
import { sendDirectTextToolModule } from './conversation/send-direct-text.js'
import { sendTextToolModule } from './conversation/send-text.js'
import { startCallToolModule } from './conversation/start-call.js'
import { aiVideoToolModule } from './media/ai-video.js'
import { textAiVideoToolModule } from './media/text-ai-video.js'
import { readImageToolModule } from './media/read-image.js'
import { recordingToolModules } from './recordings/index.js'
import { createRecordToolModule } from './records/create.js'
import { recentRecordsToolModule } from './records/recent.js'
import { searchRecordsToolModule } from './records/search.js'
import { worldPublishTextToolModule, worldRecentToolModule } from './world/index.js'
import { wechatToolModules } from './wechat/index.js'

/** Stable model-facing order retained from the pre-catalog registration path. */
export const businessToolModules: readonly ArkmeToolModule[] = [
  recentRecordsToolModule,
  ...accountBusinessToolModules,
  ...arkoToolModules,
  searchRecordsToolModule,
  createRecordToolModule,
  worldRecentToolModule,
  worldPublishTextToolModule,
  ...recordingToolModules,
  ...wechatToolModules,
  listSourcesToolModule,
  readSourceToolModule,
  relatedRecordingsToolModule,
  groupAiPolishToolModule,
  sendTextToolModule,
  sendDirectTextToolModule,
  startCallToolModule,
  aiVideoToolModule,
  textAiVideoToolModule,
  readImageToolModule,
]
