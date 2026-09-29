import { expect, it } from 'vitest'
import { parseDshDirectoryDelta } from '../src/dsh-remote/account-session-directory.js'

const row = { runtime_ref: 'canonical', session_ref: 'session', workspace_ref: '', host_generation: 2, projection_at: 1,
  source_updated_at: 1, running: false, blank: false, archived: false }

it('accepts bounded canonical rows and rejects unknown, malformed or oversized deltas', () => {
  const value = { version: 1, sessions: [row] }
  expect(parseDshDirectoryDelta(value)).toBe(value)
  expect(parseDshDirectoryDelta({ version: 1, sessions: [] })).toEqual({ version: 1, sessions: [] })
  for (const invalid of [undefined, {}, { ...value, version: 2 }, { ...value, sessions: [row, row] },
    { ...value, sessions: [{ ...row, host_generation: 0 }] }, { ...value, sessions: [{ ...row, workspace_ref: '/local/path' }] },
    { ...value, sessions: [{ ...row, title: 'x'.repeat(40 * 1024) }] },
    { ...value, sessions: Array.from({ length: 101 }, (_, i) => ({ ...row, session_ref: String(i) })) }]) {
    expect(parseDshDirectoryDelta(invalid)).toBeUndefined()
  }
})
