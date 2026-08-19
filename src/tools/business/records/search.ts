import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ArkmeRecordSearchResult } from '../../../types.js'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { boundedRecordLimit, optionalBeforeMillis } from '../../shared/limits.js'
import { formatRecordResult, taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'

function toolSafeRecordSearch(result: ArkmeRecordSearchResult): Record<string, unknown> {
  return {
    ...result,
    items: result.items.map(({ media, files, voice, ...item }) => ({
      ...item,
      mediaCount: media?.length ?? 0,
      fileCount: files?.length ?? 0,
      hasVoice: voice !== undefined,
    })),
  }
}

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
      description: 'Search the signed-in user\'s visible Arkme quick notes. Topic and chat information may be included only as source metadata. Legacy cache search remains available with sync_all or before_millis.',
      parameters: {
        query: { type: 'string', description: 'Literal quick-note text to search for.' },
        cursor: { type: 'string', description: 'Opaque next cursor returned by a previous quick-note search.' },
        limit: { type: 'integer', description: 'Maximum matches to return, 1-30. Defaults to 10.' },
        before_millis: { type: 'integer', description: 'Return matches older than this Unix timestamp in milliseconds.' },
        sync_all: { type: 'boolean', description: 'Synchronize up to 20 remote history pages before searching.' },
      },
      output: TEXT_OUTPUT,
      isConcurrencySafe: args => args.sync_all !== true,
      async execute(args, exec) {
        const query = args.query?.trim() ?? ''
        const limit = boundedRecordLimit(args.limit)
        const cursor = args.cursor?.trim() ?? ''
        if (query === '') throw new Error('query 不能为空')
        // Preserve the old local-cache contract for callers that explicitly use its legacy controls.
        if (args.sync_all === true || args.before_millis !== undefined) {
          if (args.sync_all === true) await ports.syncHistory(20, exec.signal)
          const beforeMillis = optionalBeforeMillis(args.before_millis)
          const result = await ports.queryCached({
            query,
            limit,
            ...(beforeMillis === undefined ? {} : { beforeMillis }),
          })
          return formatRecordResult(`Arkme 默认分类搜索 query=${JSON.stringify(query)}`, result)
        }
        const result = await ports.searchRemote({
          query,
          limit,
          ...(cursor === '' ? {} : { cursor }),
          signal: exec.signal,
        })
        return taggedJSON(`Arkme 快记搜索 query=${JSON.stringify(query)}`, {
          kind: 'records', ...toolSafeRecordSearch(result),
        })
      },
    })
  },
})
