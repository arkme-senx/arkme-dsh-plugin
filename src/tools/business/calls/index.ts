import { callDetailToolModule } from './detail.js'
import { callHistoryToolModule } from './history.js'
import { callSummaryRetryToolModule } from './retry-summary.js'

export const callHistoryToolModules = [
  callHistoryToolModule,
  callDetailToolModule,
  callSummaryRetryToolModule,
] as const
