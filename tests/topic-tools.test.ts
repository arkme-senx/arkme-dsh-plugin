import { describe, expect, it, vi } from 'vitest'
import { businessToolModules } from '../src/tools/business/index.js'
import type { ArkmeCoreToolPorts } from '../src/tools/ports/index.js'

describe('Arkme topic batch Tools', () => {
  it('separates root and child intent and derives a stable mutation id from each tool call', async () => {
    const rootModule = businessToolModules.find(item => item.meta.toolName === 'arkme_topics_create')
    const childModule = businessToolModules.find(item => item.meta.toolName === 'arkme_topic_children_create')
    expect(rootModule?.meta).toMatchObject({ effect: 'write', grant: 'explicit-user-write' })
    expect(childModule?.meta).toMatchObject({ effect: 'write', grant: 'explicit-user-write' })
    const createTopicsBatch = vi.fn(async (titles: readonly string[], _mutationId: string, parentSourceRef?: string) => ({
      ...(parentSourceRef === undefined ? {} : { parentSourceRef }),
      items: titles.map(title => ({ title, disposition: 'accepted' as const, succeeded: true })),
      succeededCount: titles.length,
      failedCount: 0,
    }))
    const ports = { createTopicsBatch } as unknown as ArkmeCoreToolPorts
    const signal = new AbortController().signal

    await rootModule!.create(ports).execute({ titles: ['原则', '复盘'] }, { callId: 'root-call', signal } as never)
    await rootModule!.create(ports).execute({ titles: ['原则', '复盘'] }, { callId: 'root-call', signal } as never)
    await childModule!.create(ports).execute(
      { parent_source_ref: 'arkme-source-v1.parent', titles: ['原则'] },
      { callId: 'child-call', signal } as never,
    )

    const rootMutationId = createTopicsBatch.mock.calls[0]?.[1]
    expect(rootMutationId).toMatch(/^[0-9a-f-]{36}$/)
    expect(createTopicsBatch.mock.calls[1]?.[1]).toBe(rootMutationId)
    expect(createTopicsBatch.mock.calls[0]?.[2]).toBeUndefined()
    expect(createTopicsBatch.mock.calls[2]?.[2]).toBe('arkme-source-v1.parent')
    expect(createTopicsBatch.mock.calls[2]?.[1]).not.toBe(rootMutationId)
  })
})
