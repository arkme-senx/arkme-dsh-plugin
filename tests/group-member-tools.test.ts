import { describe, expect, it, vi } from 'vitest'
import { groupMemberToolModules } from '../src/tools/business/groups/index.js'

describe('group member tools', () => {
  it('discovers candidates and adds selected opaque references through the narrow port', async () => {
    const listGroupMemberCandidates = vi.fn(async () => ({ source: { sourceRef: 'group-ref' }, items: [], total: 0, hasMore: false, mode: 'direct_add' as const }))
    const addGroupMembers = vi.fn(async () => ({ sourceRef: 'group-ref', mode: 'direct_add' as const, items: [], addedCount: 0, invitedCount: 0, failedCount: 0 }))
    const ports = { listGroupMemberCandidates, addGroupMembers }
    const definitions = groupMemberToolModules.map(module => module.create(ports as never))

    await definitions[0]!.execute({ group_source_ref: 'group-ref', query: '林', limit: 5 }, { signal: new AbortController().signal } as never)
    await definitions[1]!.execute({ group_source_ref: 'group-ref', candidate_refs: ['candidate-ref'] }, { signal: new AbortController().signal } as never)

    expect(listGroupMemberCandidates).toHaveBeenCalledWith('group-ref', { query: '林', limit: 5, signal: expect.any(AbortSignal) })
    expect(addGroupMembers).toHaveBeenCalledWith('group-ref', ['candidate-ref'], expect.any(AbortSignal))
    expect(definitions.map(tool => tool.name)).toEqual(['arkme_group_member_candidates', 'arkme_group_member_add'])
  })
})
