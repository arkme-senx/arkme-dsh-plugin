import type { ArkmeToolModule } from '../../contract/module.js'
import { listSourcesToolModule } from './list-sources.js'
import { sourceMemberRecordsToolModule, sourceMembersToolModule } from './member-records.js'
import { groupAiPolishToolModule } from './group-ai-polish.js'
import { readSourceToolModule } from './read-source.js'
import { relatedRecordingsToolModule } from './related-recordings.js'
import { reportMessageToolModule } from './report-message.js'
import { sendDirectTextToolModule } from './send-direct-text.js'
import { sendTextToolModule } from './send-text.js'
import { startCallToolModule } from './start-call.js'

export const conversationBusinessToolModules: readonly ArkmeToolModule[] = [
  listSourcesToolModule,
  readSourceToolModule,
  sourceMembersToolModule,
  sourceMemberRecordsToolModule,
  reportMessageToolModule,
  relatedRecordingsToolModule,
  groupAiPolishToolModule,
  sendTextToolModule,
  sendDirectTextToolModule,
  startCallToolModule,
]
