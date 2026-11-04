import { expect, it, vi } from 'vitest'
import { LocalSessionIdentity } from '../src/local-session-identity.js'

it('joins only server-proven aliases, shares reads, and accepts directory updates without per-row I/O', async () => {
  const post = vi.fn(async () => ({ canonical_identity: true, runtime_ref: 'canonical', session_ref: 'session', deduplicated_runtime_refs: ['old'] }))
  const owner = new LocalSessionIdentity({ post })
  const values = await Promise.all(Array.from({ length: 8 }, () => owner.resolve('old', 'session', new AbortController().signal)))
  expect(post).toHaveBeenCalledOnce(); expect(values.every(value => value.runtimeRef === 'canonical')).toBe(true)
  owner.observe({ canonical_identity: true, runtime_ref: 'latest', session_ref: 'session', deduplicated_runtime_refs: ['old', 'canonical'] })
  expect((await owner.resolve('old', 'session', new AbortController().signal)).runtimeRef).toBe('latest')
  expect(owner.known('unrelated', 'session')).toBeUndefined(); expect(post).toHaveBeenCalledOnce()
  owner.close(); expect(owner.known('old', 'session')).toBeUndefined()
})
it.each([
  { canonical_identity: true, runtime_ref: 'other', session_ref: 'session', deduplicated_runtime_refs: [] },
  { canonical_identity: true, runtime_ref: 'old', session_ref: 'different' },
  { canonical_identity: true, runtime_ref: 'old', session_ref: 'session', deduplicated_runtime_refs: ['../escape'] },
])('rejects unrelated or invalid canonical metadata', async row => {
  const owner = new LocalSessionIdentity({ post: async () => row })
  await expect(owner.resolve('old', 'session', new AbortController().signal)).rejects.toThrow()
  expect(owner.known('old', 'session')).toBeUndefined(); owner.close()
})
