import { expect, it, vi } from 'vitest'
import type { ArkmeSourceItem } from '../src/types.js'
import { retainedTopicSelection } from '../src/client/retained-topic-selection.js'
import { callArkme } from '../src/client/api.js'
vi.mock('../src/client/api.js', () => ({ callArkme: vi.fn() }))
const selected: ArkmeSourceItem = { kind: 'topic', sourceRef: 'signed', topicHierarchyKey: 'same-owner', displayName: 'Archive' }

it('retains an ordinary archive without requesting the hidden-system resolver', async () => {
  vi.mocked(callArkme).mockReset().mockResolvedValue([{ ownerAvailable: true, effectiveArchived: true }])
  expect(await retainedTopicSelection(selected, new AbortController().signal)).toBe(selected)
  expect(callArkme).toHaveBeenCalledTimes(1)
})

it.each(['valid', 'deleted', 'wrong-owner', 'wrong-kind'])('uses authoritative hidden identity when archive state is absent: %s', async scenario => {
  const hidden = scenario === 'deleted' ? null : { ...selected, topicKind: scenario === 'wrong-kind' ? 1 : 3,
    ...(scenario === 'wrong-owner' ? { topicHierarchyKey: 'other-owner' } : {}) }
  vi.mocked(callArkme).mockReset().mockResolvedValueOnce([{ ownerAvailable: false }]).mockResolvedValueOnce(hidden)
  const result = retainedTopicSelection(selected, new AbortController().signal)
  if (scenario.startsWith('wrong')) await expect(result).rejects.toThrow('身份返回不一致')
  else expect(await result).toEqual(hidden ?? undefined)
})

it('stops a cancelled selection before resolving a hidden owner', async () => {
  const controller = new AbortController()
  vi.mocked(callArkme).mockReset().mockImplementationOnce(async () => { controller.abort(); return [] })
  await expect(retainedTopicSelection(selected, controller.signal)).rejects.toBeDefined()
  expect(callArkme).toHaveBeenCalledTimes(1)
})
