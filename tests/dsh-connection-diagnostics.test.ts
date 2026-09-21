import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it, vi } from 'vitest'
import { DshConnectionDiagnostics } from '../src/dsh-remote/connection-diagnostics.js'

it('retains bounded successful traces without bodies, isolates accounts, and flushes on close', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'diagnostic delivery trace ')), 'queue.json')
  const diagnostics = new DshConnectionDiagnostics({ dsn: '', environment: 'test', release: 'test', path, log: () => { throw new Error('muted') } })
  diagnostics.resetAccount('11')
  for (let i = 0; i < 520; i++) diagnostics.record('host_request_received', {
    user_id: '11', request_ref: `r-${i}`, operation: 'session.create', transport_seq: i,
    payload: 'private-message', access_token: 'private-token',
  })
  diagnostics.tick()
  await vi.waitFor(async () => {
    const rows = JSON.parse(await readFile(`${path}.trace.json`, 'utf8'))
    expect(rows).toHaveLength(512)
    expect(rows[0].request_ref).toBe('r-8')
    expect(JSON.stringify(rows)).not.toMatch(/private-message|private-token/)
  })
  diagnostics.resetAccount('12')
  diagnostics.record('host_request_received', { user_id: '11', request_ref: 'old-account' })
  diagnostics.record('wire_subscribe_finished', { user_id: '12', after_seq: 5861, server_seq: 1, duplicate: false })
  await diagnostics.close()
  expect(JSON.parse(await readFile(`${path}.trace.json`, 'utf8'))).toEqual([
    expect.objectContaining({ phase: 'wire_subscribe_finished', after_seq: 5861, server_seq: 1, duplicate: false }),
  ])
})

it('reports the first stalled snapshot once, tracks the latest progress, and reports recovery', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'diagnostic stalled sync ')), 'queue.json')
  let now = Date.now()
  const diagnostics = new DshConnectionDiagnostics({ dsn: '', environment: 'test', release: 'test', path, log: () => undefined, now: () => now })
  diagnostics.resetAccount('11')
  diagnostics.record('projection_sync_started', { user_id: '11', snapshot_ref: 'snapshot-1', stage: 'read_inventory' })
  now += 50_000
  diagnostics.record('projection_sync_progress', { user_id: '11', snapshot_ref: 'snapshot-1', stage: 'upload_sessions', session_items_acked: 100, payload: 'secret' })
  now += 50_000
  diagnostics.tick()
  await vi.waitFor(async () => { expect(JSON.parse(await readFile(path, 'utf8'))).toEqual([]) })
  now += 10_001
  for (let i = 0; i < 10; i++) diagnostics.tick()
  await vi.waitFor(async () => { expect(JSON.parse(await readFile(path, 'utf8'))).toHaveLength(1) })
  const failure = JSON.parse(await readFile(path, 'utf8'))[0]
  expect(failure.contexts.dsh_connection.transitions.at(-1)).toMatchObject({ phase: 'projection_sync_stalled', stage: 'upload_sessions', reason: 'no_progress', duration_ms: 60_001, session_items_acked: 100 })
  diagnostics.record('projection_sync_completed', { user_id: '11', snapshot_ref: 'snapshot-1', server_completed: true })
  await vi.waitFor(async () => { expect(JSON.parse(await readFile(path, 'utf8'))).toHaveLength(2) })
  await diagnostics.close()
  const raw = await readFile(path, 'utf8')
  expect(JSON.parse(raw).map((event: any) => event.tags.phase)).toEqual(['projection_sync_failed', 'projection_sync_recovered'])
  expect(raw).not.toContain('secret')
})

it.each(['projection_sync_completed', 'projection_sync_cancelled', 'account_change', 'close'])('clears stalled-sync tracking on %s', async phase => {
  const path = join(await mkdtemp(join(tmpdir(), 'diagnostic sync cleanup ')), 'queue.json')
  let now = Date.now()
  const diagnostics = new DshConnectionDiagnostics({ dsn: '', environment: 'test', release: 'test', path, log: () => undefined, now: () => now })
  diagnostics.resetAccount('11')
  diagnostics.record('projection_sync_started', { user_id: '11', snapshot_ref: 'snapshot-1' })
  await vi.waitFor(async () => { expect(JSON.parse(await readFile(path, 'utf8'))).toEqual([]) })
  if (phase === 'account_change') diagnostics.resetAccount('12')
  else if (phase === 'close') await diagnostics.close()
  else diagnostics.record(phase, { user_id: '11', snapshot_ref: 'snapshot-1' })
  now += 120_000
  diagnostics.tick()
  await diagnostics.close()
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual([])
})

it('does not let an older snapshot completion cancel the current watchdog', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'diagnostic stale snapshot ')), 'queue.json')
  let now = Date.now()
  const diagnostics = new DshConnectionDiagnostics({ dsn: '', environment: 'test', release: 'test', path, log: () => undefined, now: () => now })
  diagnostics.resetAccount('11')
  diagnostics.record('projection_sync_started', { user_id: '11', snapshot_ref: 'current' })
  diagnostics.record('projection_sync_completed', { user_id: '11', snapshot_ref: 'old' })
  now += 60_001
  diagnostics.tick()
  await vi.waitFor(async () => { expect(JSON.parse(await readFile(path, 'utf8'))).toHaveLength(1) })
  await diagnostics.close()
  expect(JSON.parse(await readFile(path, 'utf8'))[0].contexts.dsh_connection.transitions.at(-1).snapshot_ref).toBe('current')
})

it('persists request failures with correlation, deduplicates repeats, and excludes successful requests', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'diagnostic request failure ')), 'queue.json')
  let now = Date.now()
  const diagnostics = new DshConnectionDiagnostics({ dsn: '', environment: 'test', release: 'test', path, log: () => { throw new Error('logger unavailable') }, now: () => now })
  diagnostics.resetAccount('11')
  const fields = { user_id: '11', runtime_ref: 'runtime-1', operation: 'host.snapshot', error_code: 'REMOTE_TRANSPORT_FAILED', payload: 'secret' }
  for (let i = 0; i < 100; i++) diagnostics.record('host_request_failed', { ...fields, request_ref: `request-${i}` })
  diagnostics.record('host_request_processed', { ...fields, request_ref: 'request-rejected', status: 'rejected' })
  diagnostics.record('host_response_publish_failed', { ...fields, request_ref: 'request-response' })
  diagnostics.record('host_request_received', fields)
  diagnostics.record('host_request_processed', { ...fields, status: 'completed' })
  diagnostics.record('host_response_publish_finished', { ...fields, completed: true })
  await vi.waitFor(async () => { expect(JSON.parse(await readFile(path, 'utf8'))).toHaveLength(3) })
  now += 60_001
  diagnostics.record('host_request_failed', { ...fields, request_ref: 'request-next-window' })
  await vi.waitFor(async () => { expect(JSON.parse(await readFile(path, 'utf8'))).toHaveLength(4) })
  await diagnostics.close()
  const raw = await readFile(path, 'utf8')
  expect(raw).not.toContain('secret')
  expect(JSON.parse(raw)[0]).toMatchObject({ user: { id: '11' }, tags: { phase: 'remote_request_failed' }, contexts: { dsh_connection: { transitions: [expect.objectContaining({ request_ref: 'request-0', error_code: 'REMOTE_TRANSPORT_FAILED' })] } } })
  const reopened = new DshConnectionDiagnostics({ dsn: '', environment: 'test', release: 'test', path, log: () => undefined, now: () => now })
  reopened.resetAccount('11')
  await (reopened as unknown as { loaded: Promise<void> }).loaded
  await reopened.close()
  expect(JSON.parse(await readFile(path, 'utf8'))).toHaveLength(4)
})

it('caps distinct request failure groups and resets them on account changes', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'diagnostic request capacity ')), 'queue.json')
  const diagnostics = new DshConnectionDiagnostics({ dsn: '', environment: 'test', release: 'test', path, log: () => undefined })
  diagnostics.resetAccount('11')
  for (let i = 0; i < 100; i++) diagnostics.record('host_request_failed', { user_id: '11', error_code: `ERROR_${i}` })
  await vi.waitFor(async () => { expect(JSON.parse(await readFile(path, 'utf8'))).toHaveLength(32) })
  diagnostics.resetAccount('12')
  diagnostics.record('host_request_failed', { user_id: '11', error_code: 'ERROR_0' })
  diagnostics.record('host_request_failed', { user_id: '12', error_code: 'ERROR_0' })
  await vi.waitFor(async () => { expect(JSON.parse(await readFile(path, 'utf8'))).toHaveLength(1) })
  await diagnostics.close()
  expect(JSON.parse(await readFile(path, 'utf8'))[0].user.id).toBe('12')
})

it('reports one projection incident after repeated failures and persists recovery independently of connectivity', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'diagnostic projection ')), 'queue.json')
  const diagnostics = new DshConnectionDiagnostics({ dsn: '', environment: 'test', release: 'test', path, log: () => undefined })
  diagnostics.resetAccount('11')
  for (let i = 0; i < 10; i++) diagnostics.record('projection_sync_failed', {
    user_id: '11', runtime_ref: 'runtime-1', snapshot_ref: 'snapshot-1', stage: 'upload_sessions',
    session_count: 101, session_items_acked: 100, error_code: 'REMOTE_TRANSPORT_FAILED', retryable: true,
    payload: 'private conversation', token: 'secret token',
  })
  diagnostics.record('host_registered', { user_id: '11' })
  diagnostics.record('projection_sync_completed', { user_id: '11', server_completed: true })
  await vi.waitFor(async () => { expect(JSON.parse(await readFile(path, 'utf8'))).toHaveLength(2) })
  await diagnostics.close()
  const events = JSON.parse(await readFile(path, 'utf8'))
  expect(events.map((event: any) => event.tags.phase)).toEqual(['projection_sync_failed', 'projection_sync_recovered'])
  expect(events[0].contexts.dsh_connection.transitions.at(-1)).toMatchObject({ stage: 'upload_sessions', session_count: 101, session_items_acked: 100 })
  expect(JSON.stringify(events)).not.toMatch(/private conversation|secret token/)
  const reopened = new DshConnectionDiagnostics({ dsn: '', environment: 'test', release: 'test', path, log: () => undefined })
  reopened.resetAccount('11')
  await vi.waitFor(async () => { expect(JSON.parse(await readFile(path, 'utf8'))).toHaveLength(2) })
  // Wait for load/reset persistence rather than merely observing the old file.
  await (reopened as unknown as { loaded: Promise<void> }).loaded
  await reopened.close()
  expect(JSON.parse(await readFile(path, 'utf8')).map((event: any) => event.tags.phase)).toEqual(['projection_sync_failed', 'projection_sync_recovered'])
})

it('reports an unrecovered sync failure after 60 seconds using the existing tick and isolates account changes', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'diagnostic slow sync ')), 'queue.json')
  let now = Date.now()
  const diagnostics = new DshConnectionDiagnostics({ dsn: '', environment: 'test', release: 'test', path, log: () => undefined, now: () => now })
  diagnostics.resetAccount('11')
  diagnostics.record('projection_sync_failed', { user_id: '11', retryable: true })
  now += 60_001
  diagnostics.tick()
  await vi.waitFor(async () => { expect(JSON.parse(await readFile(path, 'utf8'))).toHaveLength(1) })
  diagnostics.resetAccount('12')
  diagnostics.record('projection_sync_failed', { user_id: '11', retryable: false })
  diagnostics.record('projection_sync_completed', { user_id: '12' })
  await vi.waitFor(async () => { expect(JSON.parse(await readFile(path, 'utf8'))).toEqual([]) })
  await diagnostics.close()
})

it('reports non-retryable sync errors immediately but does not report cancellation', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'diagnostic rejected sync ')), 'queue.json')
  const diagnostics = new DshConnectionDiagnostics({ dsn: '', environment: 'test', release: 'test', path, log: () => undefined })
  diagnostics.resetAccount('11')
  diagnostics.record('projection_sync_cancelled', { user_id: '11', retryable: false })
  diagnostics.record('projection_sync_failed', { user_id: '11', retryable: false, stage: 'complete_snapshot' })
  await vi.waitFor(async () => { expect(JSON.parse(await readFile(path, 'utf8'))).toHaveLength(1) })
  await diagnostics.close()
  expect(JSON.parse(await readFile(path, 'utf8'))[0].contexts.dsh_connection.failures).toBe(1)
})

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
