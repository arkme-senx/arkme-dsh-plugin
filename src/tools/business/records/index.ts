import type { ArkmeToolModule } from '../../contract/module.js'
import { createRecordToolModule } from './create.js'
import { recentRecordsToolModule } from './recent.js'
import { searchRecordsToolModule } from './search.js'

export const recordBusinessToolModules: readonly ArkmeToolModule[] = [
  recentRecordsToolModule,
  searchRecordsToolModule,
  createRecordToolModule,
]
