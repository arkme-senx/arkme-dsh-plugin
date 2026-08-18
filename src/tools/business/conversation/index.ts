import type { ArkmeToolModule } from '../../contract/module.js'
import { listSourcesToolModule } from './list-sources.js'
import { readSourceToolModule } from './read-source.js'
import { sendDirectTextToolModule } from './send-direct-text.js'
import { sendTextToolModule } from './send-text.js'
import { startCallToolModule } from './start-call.js'

export const conversationBusinessToolModules: readonly ArkmeToolModule[] = [
  listSourcesToolModule,
  readSourceToolModule,
  sendTextToolModule,
  sendDirectTextToolModule,
  startCallToolModule,
]
