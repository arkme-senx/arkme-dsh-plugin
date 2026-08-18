import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { boundedRecordLimit, optionalBeforeMillis } from '../../shared/limits.js'
import { formatRecordResult, TEXT_OUTPUT } from '../../shared/output.js'

export const searchRecordsToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.records.search.v1',
    toolName: 'arkme_records_search',
    kind: 'business',
    phase: 'core',
    effect: 'read',
    profiles: ['business', 'hybrid'],
  },
  create(ports) {
    return defineTool({
      name: 'arkme_records_search',
      description: 'Search text and titles in the signed-in user\'s Arkme default-category cache. Set sync_all=true before a comprehensive search.',
      parameters: {
        query: { type: 'string', required: true, description: 'Non-empty literal text to search for.' },
        limit: { type: 'integer', description: 'Maximum matches to return, 1-30. Defaults to 10.' },
        before_millis: { type: 'integer', description: 'Return matches older than this Unix timestamp in milliseconds.' },
        sync_all: { type: 'boolean', description: 'Synchronize up to 20 remote history pages before searching.' },
      },
      output: TEXT_OUTPUT,
      isConcurrencySafe: args => args.sync_all !== true,
      async execute(args, exec) {
        const query = args.query.trim()
        if (query === '') throw new Error('query 不能为空')
        if (args.sync_all === true) await ports.syncHistory(20, exec.signal)
        const beforeMillis = optionalBeforeMillis(args.before_millis)
        const result = await ports.queryCached({
          query,
          limit: boundedRecordLimit(args.limit),
          ...(beforeMillis === undefined ? {} : { beforeMillis }),
        })
        return formatRecordResult(`Arkme 默认分类搜索 query=${JSON.stringify(query)}`, result)
      },
    })
  },
})
