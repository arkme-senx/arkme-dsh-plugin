// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ReactionRequest } from '../src/reaction-contract.js'
const { call, log } = vi.hoisted(() => ({ call: vi.fn(), log: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: call }))
vi.mock('../src/reaction-diagnostics.js', () => ({ logReactionTiming: log, reactionTraceId: () => 'synthetic-trace' }))
import { callReaction } from '../src/client/reaction-transport.js'

beforeEach(() => { call.mockReset().mockResolvedValue({}); log.mockReset(); sessionStorage.removeItem('arkme.reaction.diagnostics') })
afterEach(() => { sessionStorage.removeItem('arkme.reaction.diagnostics') })

it.each([false, true])('uses the same bounded background hint for passive reads with diagnostics=%s', async diagnostics => {
  if (diagnostics) sessionStorage.setItem('arkme.reaction.diagnostics', '1')
  const signal = new AbortController().signal
  const reads: ReactionRequest[] = [
    { accountKey: 'test:4', action: 'query', targets: [] },
    { accountKey: 'test:4', action: 'query', targets: [], actorPresentation: 'deferred' },
    { accountKey: 'test:4', action: 'notifications', limit: 50 },
  ]
  for (const input of reads) await callReaction(input, signal)
  expect(call.mock.calls).toEqual(reads.map(input => ['reactions', diagnostics ? { ...input, traceId: 'synthetic-trace' } : input, signal, { priority: 'background' }]))
  expect(log).toHaveBeenCalledTimes(diagnostics ? reads.length : 0)
})

it.each([false, true])('keeps interactive queries, actors, libraries and writes on their existing direct path with diagnostics=%s', async diagnostics => {
  if (diagnostics) sessionStorage.setItem('arkme.reaction.diagnostics', '1')
  const signal = new AbortController().signal
  const inputs = [
    { accountKey: 'test:4', action: 'query', targets: [], readPriority: 'interactive' },
    ...['actors', 'groups', 'history', 'received', 'library-query', 'history-policy-query', 'set', 'library-set', 'history-policy-set', 'notifications-read', 'unknown'].map(action => ({ accountKey: 'test:4', action })),
  ] as ReactionRequest[]
  for (const input of inputs) await callReaction(input, signal)
  expect(call.mock.calls).toEqual(inputs.map(input => ['reactions', diagnostics ? { ...input, traceId: 'synthetic-trace' } : input, signal]))
})
