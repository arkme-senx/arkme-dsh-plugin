import { addGroupBotToolModule } from './add-group.js'
import { createBotToolModule } from './create.js'
import { connectOpenClawBotToolModule } from './connect-openclaw.js'
import { listBotsToolModule } from './list.js'
import { listGroupBotsToolModule } from './list-group.js'
import { removeGroupBotToolModule } from './remove-group.js'

export const botToolModules = [
  listBotsToolModule,
  createBotToolModule,
  connectOpenClawBotToolModule,
  listGroupBotsToolModule,
  addGroupBotToolModule,
  removeGroupBotToolModule,
] as const
