import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { boundedRecordLimit, optionalBeforeMillis } from '../../shared/limits.js'
import { formatRecordResult, TEXT_OUTPUT } from '../../shared/output.js'

export const recentRecordsToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.records.recent.v1',
    toolName: 'arkme_records_recent',
    kind: 'business',
    phase: 'core',
    effect: 'read',
    profiles: ['business', 'hybrid'],
  },
  create(ports) {
    return defineTool({
      name: 'arkme_records_recent',
      description: 'Read recent records from the signed-in user\'s Arkme default category. Uses the local cache; set refresh=true when current data matters.',
      parameters: {
        limit: { type: 'integer', description: 'Number of records to return, 1-30. Defaults to 10.' },
        before_millis: { type: 'integer', description: 'Return records older than this Unix timestamp in milliseconds.' },
        refresh: { type: 'boolean', description: 'Refresh the latest Arkme page before reading the local cache.' },
      },
      output: TEXT_OUTPUT,
      isConcurrencySafe: args => args.refresh !== true,
      async execute(args) {
        if (args.refresh === true) await ports.refreshLatest()
        const beforeMillis = optionalBeforeMillis(args.before_millis)
        const result = await ports.queryCached({
          limit: boundedRecordLimit(args.limit),
          ...(beforeMillis === undefined ? {} : { beforeMillis }),
        })
        return formatRecordResult('Arkme 默认分类最近快记', result)
      },
    })
  },
})
