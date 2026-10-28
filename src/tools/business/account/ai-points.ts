import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'

export const aiPointsAccountToolModule = defineArkmeCoreToolModule({
  meta: { id: 'business.account.ai-points.v1', toolName: 'arkme_ai_points', kind: 'business', phase: 'core', effect: 'read', profiles: ['business', 'hybrid'] },
  create: ports => defineTool({
    name: 'arkme_ai_points', description: 'Read the signed-in Arkme account AI points: available, member grants and purchased points. This read cannot recharge, grant points or call a model.',
    parameters: {}, output: TEXT_OUTPUT, isConcurrencySafe: () => true,
    execute: async (_args, exec) => {
      const { accountScope: _scope, ...account } = await ports.aiPointsAccount(undefined, exec.signal)
      return taggedJSON('AI 积分', account)
    },
  }),
})
export const aiPointsConsumptionToolModule = defineArkmeCoreToolModule({
  meta: { id: 'business.account.ai-points-consumption.v1', toolName: 'arkme_ai_points_consumption', kind: 'business', phase: 'core', effect: 'read', profiles: ['business', 'hybrid'] },
  create: ports => defineTool({
    name: 'arkme_ai_points_consumption', description: 'Read settled AI point consumption for a natural month (Asia/Shanghai). Non-charged background model usage is excluded. Follow nextBeforeId to read another page.',
    parameters: { month: { type: 'string', required: true, description: 'Month YYYY-MM' }, beforeId: { type: 'string', description: 'Opaque nextBeforeId returned by the previous page' } },
    output: TEXT_OUTPUT, isConcurrencySafe: () => true,
    execute: async (args, exec) => {
      const { accountScope: _scope, ...page } = await ports.aiPointsConsumption({ month: args.month, ...(args.beforeId ? { beforeId: args.beforeId } : {}) }, undefined, exec.signal)
      return taggedJSON('AI 积分消费', page)
    },
  }),
})
export const aiPointsToolModules = [aiPointsAccountToolModule, aiPointsConsumptionToolModule]
