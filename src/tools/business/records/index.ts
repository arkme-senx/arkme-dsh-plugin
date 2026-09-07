import type { ArkmeToolModule } from '../../contract/module.js'
import { createRecordToolModule } from './create.js'
import { listImagesToolModule } from './images.js'
import { recentRecordsToolModule } from './recent.js'
import { reeditRecordToolModule } from './reedit.js'
import { searchRecordsToolModule } from './search.js'

export const recordBusinessToolModules: readonly ArkmeToolModule[] = [
  recentRecordsToolModule,
  searchRecordsToolModule,
  listImagesToolModule,
  createRecordToolModule,
  reeditRecordToolModule,
]
