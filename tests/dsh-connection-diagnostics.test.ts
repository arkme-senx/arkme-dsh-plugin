import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it, vi } from 'vitest'
import { DshConnectionDiagnostics } from '../src/dsh-remote/connection-diagnostics.js'

it('aggregates one bounded failure and recovery without leaking payloads', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'dsh diagnostic ')), 'queue.json')
  const log = vi.fn()
  const diagnostics = new DshConnectionDiagnostics({ dsn: '', environment: 'test', release: 'test', path, log })
  for (let i = 0; i < 100; i++) diagnostics.record('connection_failed', { user_id: 11, error_code: 'REMOTE_TRANSPORT_FAILED', token: 'secret', payload: 'private text' })
  diagnostics.record('host_registered', { user_id: 11 })
  await vi.waitFor(async () => { expect(JSON.parse(await readFile(path, 'utf8'))).toHaveLength(2) })
  await diagnostics.close()
  const raw = await readFile(path, 'utf8')
  const events = JSON.parse(raw)
  expect(events).toHaveLength(2)
  expect(events[0].contexts.dsh_connection.transitions.length).toBeLessThanOrEqual(32)
  expect(raw).not.toMatch(/secret|private text/)
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/secret|private text/)
})

it('invalid diagnostic configuration does not prevent Host construction', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'diagnostic config ')), 'queue.json')
  const log = vi.fn()
  const diagnostics = new DshConnectionDiagnostics({ dsn: 'invalid', environment: 'test', release: 'test', path, log })
  expect(log).toHaveBeenCalledWith({ phase: 'diagnostics_unavailable', reason: 'invalid_configuration' })
  await diagnostics.close()
})

it('discards a delayed incident across account A to B to A transitions', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'diagnostic account ')), 'queue.json')
  const diagnostics = new DshConnectionDiagnostics({ dsn: '', environment: 'test', release: 'test', path, log: () => undefined })
  diagnostics.resetAccount('11')
  for (let i = 0; i < 3; i++) diagnostics.record('connection_failed', { user_id: 11 })
  diagnostics.resetAccount('12')
  diagnostics.resetAccount('11')
  await vi.waitFor(async () => { expect(JSON.parse(await readFile(path, 'utf8'))).toEqual([]) })
  await diagnostics.close()
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual([])
})


it('rebuilds cached events from allowed diagnostic fields before reuse', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'diagnostic cache ')), 'queue.json')
  await writeFile(path, JSON.stringify([{
    event_id: 'a'.repeat(32), timestamp: Date.now()/1000, message: 'secret message',
    user: { id: '11', email: 'private@example.invalid' }, tags: { phase: 'connection_failed' },
    contexts: { dsh_connection: { episode_id: 'episode', failures: 3, duration_ms: 1000,
      transitions: [{ phase: 'connection_failed', user_id: 11, token: 'secret token' }] } },
    extra: { payload: 'private payload' },
  }]))
  const diagnostics = new DshConnectionDiagnostics({ dsn: '', environment: 'test', release: 'test', path, log: () => undefined })
  diagnostics.resetAccount('11')
  await vi.waitFor(async () => { expect(await readFile(path, 'utf8')).not.toMatch(/secret|private|email|payload/) })
  const events = JSON.parse(await readFile(path, 'utf8'))
  expect(events[0].message).toBe('DSH Host connection_failed')
  await diagnostics.close()
})

it('logs bounded delivery measurements without evicting connection incident context', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'diagnostic timing ')), 'queue.json')
  const log = vi.fn()
  const diagnostics = new DshConnectionDiagnostics({ dsn: '', environment: 'test', release: 'test', path, log })
  diagnostics.record('connection_failed', { user_id: 11, reason: 'first_failure' })
  for (let i = 0; i < 40; i++) diagnostics.record('live_delivery_window', {
    user_id: 11, batch_count: 20, incomplete_batches: 1, queue_ms_max: 200, capture_ms_max: 4,
    channel_queue_ms_max: 2, publish_ack_ms_max: 80, payload: 'private text',
  })
  expect(log.mock.calls.at(-1)?.[0]).toMatchObject({ batch_count: 20, incomplete_batches: 1, queue_ms_max: 200, publish_ack_ms_max: 80 })
  diagnostics.record('connection_failed', { user_id: 11 })
  diagnostics.record('connection_failed', { user_id: 11 })
  await vi.waitFor(async () => { expect(JSON.parse(await readFile(path, 'utf8'))).toHaveLength(1) })
  await diagnostics.close()
  const transitions = JSON.parse(await readFile(path, 'utf8'))[0].contexts.dsh_connection.transitions
  expect(transitions).toHaveLength(3)
  expect(transitions[0]).toMatchObject({ reason: 'first_failure' })
  expect(JSON.stringify(log.mock.calls)).not.toContain('private text')
})
