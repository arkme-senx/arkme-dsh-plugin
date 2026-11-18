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

const periodParameters={fromDate:{type:'string' as const,required:true as const,description:'Inclusive Beijing date YYYY-MM-DD'},untilDate:{type:'string' as const,required:true as const,description:'Exclusive Beijing date YYYY-MM-DD'}}
export const aiPointsStatisticsToolModule=defineArkmeCoreToolModule({
 meta:{id:'business.account.ai-points-statistics.v1',toolName:'arkme_ai_points_statistics',kind:'business',phase:'core',effect:'read',profiles:['business','hybrid']},
 create:ports=>defineTool({name:'arkme_ai_points_statistics',description:'Read exact settled AI points grouped by day, Monday week or month. Keep observedAt as settledBefore when drilling into details. Excludes non-billed telemetry.',parameters:{...periodParameters,grain:{type:'string',enum:['day','week','month'],required:true}},output:TEXT_OUTPUT,isConcurrencySafe:()=>true,execute:async(args,exec)=>{const {accountScope:_scope,...result}=await ports.aiPointsStatistics({...args,timezone:'Asia/Shanghai'},undefined,exec.signal);return taggedJSON('积分统计',result)}}),
})
export const aiPointsRangeToolModule=defineArkmeCoreToolModule({
 meta:{id:'business.account.ai-points-range.v1',toolName:'arkme_ai_points_consumption_range',kind:'business',phase:'core',effect:'read',profiles:['business','hybrid']},
 create:ports=>defineTool({name:'arkme_ai_points_consumption_range',description:'Read whole-operation settled points for the summary period at the same observedAt cutoff. Preserve filters and settledBefore across beforeId pages; refresh if totals change.',parameters:{...periodParameters,settledBefore:{type:'number',required:true,description:'observedAt from statistics'},beforeId:{type:'string'},businessCode:{type:'string'}},output:TEXT_OUTPUT,isConcurrencySafe:()=>true,execute:async(args,exec)=>{const {accountScope:_scope,...result}=await ports.aiPointsConsumptionRange({fromDate:args.fromDate,untilDate:args.untilDate,timezone:'Asia/Shanghai',settledBefore:args.settledBefore,...(args.beforeId?{beforeId:args.beforeId}:{}),...(args.businessCode?{businessCodes:[args.businessCode]}:{})},undefined,exec.signal);return taggedJSON('积分时段明细',result)}}),
})

export const aiPointsToolModules=[aiPointsAccountToolModule,aiPointsConsumptionToolModule,aiPointsStatisticsToolModule,aiPointsRangeToolModule]
