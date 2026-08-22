import { describe, expect, it, vi } from 'vitest'
import { businessToolModules } from '../src/tools/business/index.js'
import type { ArkmeCoreToolPorts } from '../src/tools/ports/index.js'

describe('Arkme group-create Tool', () => {
  it('uses an explicitly granted write and a stable UUID for one tool call', async () => {
    const module = businessToolModules.find(item => item.meta.toolName === 'arkme_group_create')
    expect(module?.meta).toMatchObject({ effect: 'write', grant: 'explicit-user-write' })
    const ports = {
      createGroup: vi.fn(async () => ({
        sourceRef: 'source-group', kind: 'group_chat' as const, displayName: '项目群',
        activeAtMillis: 0, unreadCount: 0,
      })),
    } as unknown as ArkmeCoreToolPorts
    const tool = module!.create(ports)
    const exec = { callId: 'group-create-call', signal: new AbortController().signal } as never

    await tool.execute({ title: '项目群' }, exec)
    await tool.execute({ title: '项目群' }, exec)

    const firstId = vi.mocked(ports.createGroup).mock.calls[0]?.[1]
    const secondId = vi.mocked(ports.createGroup).mock.calls[1]?.[1]
    expect(firstId).toMatch(/^[0-9a-f-]{36}$/)
    expect(secondId).toBe(firstId)
  })
})
