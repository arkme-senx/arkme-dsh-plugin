import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { LocalSessionOwnership } from '../src/local-session-ownership.js'
import { LocalSessionCloud } from '../src/local-session-cloud.js'
import { DshRemoteError } from '../src/dsh-remote/errors.js'

it.each(['accepted', 'legacy', 'foreign'] as const)('returns only canonical sync readbacks (%s)', async mode => {
  const root = mkdtempSync(join(tmpdir(), 'arkme-cloud-readback-'))
  const ownership = new LocalSessionOwnership(root, { accountId: '42', environment: 'test' })
  const accepted = { runtime_ref: mode === 'foreign' ? 'different-origin' : 'origin', session_ref: 'session', workspace_ref: 'canonical-workspace',
    host_generation: 2, projection_at: 7, title: 'Actual stored title', source_updated_at: 1, running: false, blank: false, archived: false }
  const post = vi.fn(async (path: string) => path.endsWith('/runtimes/register')
    ? { runtime_ref: 'executor', host_generation: 3 }
    : path.endsWith('/claim-execution') ? { host_generation: 2 }
      : mode === 'legacy' ? {} : { sessions: [accepted] })
  try {
    const cloud = new LocalSessionCloud({ ownership, instance: 'A', accountId: '42', request: { post } })
    await cloud.post('/api/v1/dsh-remote/runtimes/register', {})
    ownership.bindAddress('session', 'origin'); ownership.register('session', 'A')
    const input = { runtime_ref: 'executor', snapshot_ref: '', items: [{ session_ref: 'session', title: 'Attempted title' }] }
    expect(await cloud.post('/api/v1/dsh-remote/sessions/sync', input)).toEqual(mode === 'accepted' ? { sessions: [accepted] } : {})
    const count = post.mock.calls.length
    expect(await cloud.post('/api/v1/dsh-remote/sessions/sync', input)).toEqual({ sessions: [] })
    expect(post).toHaveBeenCalledTimes(count)
  } finally { ownership.close(); rmSync(root, { recursive: true }) }
})

it('keeps an unclaimed session page batched and excludes tombstones from completion', async () => {
  const root = mkdtempSync(join(tmpdir(), 'arkme-cloud-page-'))
  const ownership = new LocalSessionOwnership(root, { accountId: '42', environment: 'test' })
  const post = vi.fn(async (path: string) => path.endsWith('/runtimes/register') ? { runtime_ref: 'runtime-A', host_generation: 3 } : {})
  const cloud = new LocalSessionCloud({ ownership, instance: 'A', accountId: '42', request: { post } })
  const items = Array.from({ length: 20 }, (_, n) => ({ session_ref: `s${n}`, deleted: n === 19 }))
  try {
    await cloud.post('/api/v1/dsh-remote/runtimes/register', {})
    await cloud.claimUnownedAndListOwned({ accountId: '42', sessionRefs: items.map(item => item.session_ref), origin: 'existing-at-login' })
    await cloud.post('/api/v1/dsh-remote/sessions/sync', { runtime_ref: 'runtime-A', host_generation: 3, snapshot_ref: 'snap', items })
    expect(post.mock.calls.filter(([path]) => path.endsWith('/sessions/sync'))).toHaveLength(1)
    expect(post).toHaveBeenLastCalledWith('/api/v1/dsh-remote/sessions/sync', { runtime_ref: 'runtime-A', host_generation: 3, snapshot_ref: 'snap', items: items.slice(0, 19) }, undefined)
    await cloud.post('/api/v1/dsh-remote/projections/complete', { snapshot_ref: 'snap', session_count: 20 })
    expect(post).toHaveBeenLastCalledWith('/api/v1/dsh-remote/projections/complete', { snapshot_ref: 'snap', session_count: 19 }, undefined)
  } finally { ownership.close(); rmSync(root, { recursive: true }) }
})

it('publishes one canonical address across handoff and fences the old publisher', async () => {
  const root = mkdtempSync(join(tmpdir(), 'arkme-cloud-owner-'))
  const ownership = new LocalSessionOwnership(root, { accountId: '42', environment: 'test' })
  let exists = false
  const post = vi.fn(async (path: string, body: Record<string, unknown>) => {
    if (path.endsWith('/runtimes/register')) return { runtime_ref: body.ref, host_generation: 1 }
    if (path.endsWith('/sessions/sync')) { exists = true; return {} }
    if (path.endsWith('/claim-execution')) {
      if (!exists) throw new DshRemoteError('REMOTE_NOT_FOUND', 'not published')
      return { host_generation: 2 }
    }
    return {}
  })
  const a = new LocalSessionCloud({ ownership, instance: 'A', accountId: '42', request: { post } })
  const b = new LocalSessionCloud({ ownership, instance: 'B', accountId: '42', request: { post } })
  const base = '/api/v1/dsh-remote'
  try {
    await b.post(`${base}/desktops/d/runtimes/register`, { ref: 'runtime-B' })
    await a.post(`${base}/desktops/d/runtimes/register`, { ref: 'runtime-A' })
    const first = ownership.register('session', 'B')
    expect(await a.claimUnownedAndListOwned({ accountId: '42', sessionRefs: ['session'], origin: 'observed-while-active' })).toEqual(new Set())
    expect(ownership.address('session')).toBeUndefined()
    await b.claimUnownedAndListOwned({ accountId: '42', sessionRefs: ['session'], origin: 'observed-while-active' })
    await b.post(`${base}/sessions/sync`, { runtime_ref: 'runtime-B', host_generation: 1, snapshot_ref: 'snap', items: [{ session_ref: 'session', title: 'original' }] })
    await b.post(`${base}/projections/complete`, { snapshot_ref: 'snap', session_count: 1 })
    expect(post).toHaveBeenLastCalledWith(`${base}/projections/complete`, { snapshot_ref: 'snap', session_count: 0 }, undefined)
    ownership.acquired(ownership.released(ownership.prepare(first, 'A')), 'A')
    expect(await b.listOwned('42', ['session'])).toEqual(new Set())
    await expect(b.post(`${base}/session-events/append`, { session_ref: 'session', entries: [] })).rejects.toMatchObject({ code: 'SESSION_STATE_CHANGED' })
    await a.publishExecution('session', new AbortController().signal)
    expect(post).toHaveBeenLastCalledWith(`${base}/sessions/claim-execution`, expect.objectContaining({
      runtime_ref: 'runtime-B', session_ref: 'session',
      execution: { runtime_ref: 'runtime-A', host_generation: 1, owner_epoch: 2 },
    }), expect.any(AbortSignal))
    const claims = post.mock.calls.filter(([path]) => path.endsWith('/claim-execution')).length
    await a.post(`${base}/session-events/append`, { runtime_ref: 'runtime-A', host_generation: 1, session_ref: 'session', entries: [] })
    expect(post.mock.calls.filter(([path]) => path.endsWith('/claim-execution'))).toHaveLength(claims)
    expect(post).toHaveBeenLastCalledWith(`${base}/session-events/append`, expect.objectContaining({
      runtime_ref: 'runtime-B', session_ref: 'session', host_generation: 2,
      execution: { runtime_ref: 'runtime-A', host_generation: 1, owner_epoch: 2 },
    }), undefined)
    expect(ownership.bindAddress('session', 'runtime-A')).toBe('runtime-B')
  } finally { ownership.close(); rmSync(root, { recursive: true }) }
})

it('bootstraps the original address when the first publisher handed off while offline', async () => {
  const root = mkdtempSync(join(tmpdir(), 'arkme-cloud-offline-'))
  const ownership = new LocalSessionOwnership(root, { accountId: '42', environment: 'test' })
  let exists = false
  const post = vi.fn(async (path: string) => {
    if (path.endsWith('/runtimes/register')) return { runtime_ref: 'runtime-A', host_generation: 3 }
    if (path.endsWith('/claim-execution')) {
      if (!exists) throw new DshRemoteError('REMOTE_NOT_FOUND', 'not published')
      return { host_generation: 4 }
    }
    if (path.endsWith('/sessions/sync')) exists = true
    return {}
  })
  try {
    const cloud = new LocalSessionCloud({ ownership, instance: 'A', accountId: '42', request: { post } })
    await cloud.post('/api/v1/dsh-remote/runtimes/register', {})
    ownership.bindAddress('session', 'runtime-B')
    const first = ownership.register('session', 'B')
    ownership.acquired(ownership.released(ownership.prepare(first, 'A')), 'A')
    await cloud.post('/api/v1/dsh-remote/sessions/sync', { runtime_ref: 'runtime-A', items: [{ session_ref: 'session' }] })
    expect(post).toHaveBeenCalledWith('/api/v1/dsh-remote/sessions/sync', expect.objectContaining({
      runtime_ref: 'runtime-B', snapshot_ref: '',
      execution: { runtime_ref: 'runtime-A', host_generation: 3, owner_epoch: 2 },
    }), undefined)
    expect(post.mock.calls.slice(1).map(([path]) => path.split('/').at(-1))).toEqual(['claim-execution', 'sync'])
    // The successful bootstrap already published this writer and metadata.
    // Resolve the canonical generation only when another write actually needs it.
    await cloud.post('/api/v1/dsh-remote/session-events/append', { session_ref: 'session', entries: [] })
    expect(post).toHaveBeenLastCalledWith('/api/v1/dsh-remote/session-events/append', expect.objectContaining({
      runtime_ref: 'runtime-B', host_generation: 4,
      execution: { runtime_ref: 'runtime-A', host_generation: 3, owner_epoch: 2 },
    }), undefined)
    const requests = post.mock.calls.length
    await cloud.post('/api/v1/dsh-remote/sessions/sync', { runtime_ref: 'runtime-A', items: [{ session_ref: 'session' }] })
    expect(post).toHaveBeenCalledTimes(requests)
    await cloud.post('/api/v1/dsh-remote/sessions/sync', { runtime_ref: 'runtime-A', items: [{ session_ref: 'session', title: 'renamed' }] })
    expect(post.mock.calls.slice(requests)).toEqual([['/api/v1/dsh-remote/sessions/sync', expect.objectContaining({
      runtime_ref: 'runtime-B', host_generation: 4, items: [{ session_ref: 'session', title: 'renamed' }],
    }), undefined]])
    expect(ownership.address('session')).toBe('runtime-B')
  } finally { ownership.close(); rmSync(root, { recursive: true }) }
})

it('does not turn full-observation absence into an explicit managed deletion', async () => {
  const root = mkdtempSync(join(tmpdir(), 'arkme-cloud-observation-'))
  const ownership = new LocalSessionOwnership(root, { accountId: '42', environment: 'test' })
  const post = vi.fn(async (path: string) => path.endsWith('/runtimes/register')
    ? { runtime_ref: 'runtime-A', host_generation: 3 }
    : path.endsWith('/claim-execution') ? { host_generation: 4 } : {})
  const cloud = new LocalSessionCloud({ ownership, instance: 'A', accountId: '42', request: { post } })
  try {
    await cloud.post('/api/v1/dsh-remote/runtimes/register', {})
    ownership.register('old', 'A')
    ownership.register('new', 'A')
    await cloud.post('/api/v1/dsh-remote/sessions/sync', { runtime_ref: 'runtime-A', snapshot_ref: 'observation', items: [
      { session_ref: 'old', deleted: true }, { session_ref: 'new', deleted: false, title: 'new conversation' },
    ] })
    expect(post.mock.calls.filter(([path]) => path.endsWith('/sessions/sync'))).toEqual([
      ['/api/v1/dsh-remote/sessions/sync', expect.objectContaining({ snapshot_ref: '', items: [{ session_ref: 'new', deleted: false, title: 'new conversation' }] }), undefined],
    ])
    // An explicit mutation still preserves its original contract.
    await cloud.post('/api/v1/dsh-remote/sessions/sync', { runtime_ref: 'runtime-A', snapshot_ref: '', items: [{ session_ref: 'old', deleted: true }] })
    expect(post).toHaveBeenLastCalledWith('/api/v1/dsh-remote/sessions/sync', expect.objectContaining({ snapshot_ref: '', items: [{ session_ref: 'old', deleted: true }] }), undefined)
  } finally { ownership.close(); rmSync(root, { recursive: true }) }
})

it('does not remember a failed bootstrap or finish it after losing the local writer', async () => {
  const root = mkdtempSync(join(tmpdir(), 'arkme-cloud-bootstrap-failure-'))
  const ownership = new LocalSessionOwnership(root, { accountId: '42', environment: 'test' })
  let fail = true, handoff = false
  const post = vi.fn(async (path: string) => {
    if (path.endsWith('/runtimes/register')) return { runtime_ref: 'runtime-A', host_generation: 3 }
    if (path.endsWith('/claim-execution')) throw new DshRemoteError('REMOTE_NOT_FOUND', 'not published')
    if (path.endsWith('/sessions/sync')) {
      if (fail) throw new DshRemoteError('REMOTE_TRANSPORT_FAILED', 'temporary write failure', true)
      if (handoff) ownership.acquired(ownership.released(ownership.prepare(ownership.read('session')!, 'B')), 'B')
    }
    return {}
  })
  const cloud = new LocalSessionCloud({ ownership, instance: 'A', accountId: '42', request: { post } })
  const body = { runtime_ref: 'runtime-A', items: [{ session_ref: 'session' }] }
  try {
    await cloud.post('/api/v1/dsh-remote/runtimes/register', {})
    ownership.register('session', 'A')
    await expect(cloud.post('/api/v1/dsh-remote/sessions/sync', body)).rejects.toMatchObject({ code: 'REMOTE_TRANSPORT_FAILED' })
    fail = false; handoff = true
    await expect(cloud.post('/api/v1/dsh-remote/sessions/sync', body)).rejects.toMatchObject({ code: 'SESSION_STATE_CHANGED' })
    expect(post.mock.calls.slice(1).map(([path]) => path.split('/').at(-1))).toEqual(['claim-execution', 'sync', 'claim-execution', 'sync'])
    expect(ownership.read('session')?.owner).toBe('B')
  } finally { ownership.close(); rmSync(root, { recursive: true }) }
})

it('republishes recoverable canonical metadata with the real newer writer proof', async () => {
  const root = mkdtempSync(join(tmpdir(), 'arkme-cloud-restoration-'))
  const ownership = new LocalSessionOwnership(root, { accountId: '42', environment: 'test' })
  let deleted = true
  const post = vi.fn(async (path: string, body: Record<string, unknown>) => {
    if (path.endsWith('/runtimes/register')) return { runtime_ref: 'runtime-A', host_generation: 49 }
    if (path.endsWith('/claim-execution')) {
      if (deleted) throw new DshRemoteError('REMOTE_NOT_FOUND', 'canonical row hidden')
      return { host_generation: 43 }
    }
    if (path.endsWith('/sessions/sync')) {
      expect(body).toMatchObject({ runtime_ref: 'runtime-B', snapshot_ref: '',
        execution: { runtime_ref: 'runtime-A', host_generation: 49, owner_epoch: 2 },
        items: [{ session_ref: 'session', deleted: false, title: 'retained history' }],
      })
      deleted = false
    }
    return {}
  })
  try {
    const cloud = new LocalSessionCloud({ ownership, instance: 'A', accountId: '42', request: { post } })
    await cloud.post('/api/v1/dsh-remote/runtimes/register', {})
    ownership.bindAddress('session', 'runtime-B')
    const first = ownership.register('session', 'B')
    ownership.acquired(ownership.released(ownership.prepare(first, 'A')), 'A')
    const body = { runtime_ref: 'runtime-A', snapshot_ref: 'current-observation', items: [{ session_ref: 'session', deleted: false, title: 'retained history' }] }
    await cloud.post('/api/v1/dsh-remote/sessions/sync', body)
    expect(deleted).toBe(false)
    const writes = post.mock.calls.length
    await cloud.post('/api/v1/dsh-remote/sessions/sync', body)
    expect(post).toHaveBeenCalledTimes(writes)
    expect(ownership.read('session')?.epoch).toBe(2)
    expect(ownership.address('session')).toBe('runtime-B')
  } finally { ownership.close(); rmSync(root, { recursive: true }) }
})
