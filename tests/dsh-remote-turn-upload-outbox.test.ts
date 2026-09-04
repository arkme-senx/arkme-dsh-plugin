import { gunzipSync } from 'node:zlib'
import { existsSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import { DshRemoteTurnUploadOutbox } from '../src/dsh-remote/turn-upload-outbox.js'
import type { DshRemoteHistoryEntry } from '../src/dsh-remote/dsh-event-contract.js'
import { DshRemoteError } from '../src/dsh-remote/errors.js'
import type { DshRemoteControlPlane, DshRemoteRuntimeProjection } from '../src/dsh-remote/types.js'

const runtime: DshRemoteRuntimeProjection = {
  runtimeRef: 'runtime-01', profileRef: 'web', accountId: 'account-01',
  hostGeneration: 7, capabilities: ['session.events'], updatedAtMillis: 1,
}

function entry(type: string, seq: number, data: Record<string, unknown> = {}): DshRemoteHistoryEntry {
  return { event: { type, seq, time: seq, data } }
}

function backend(input: {
  prepare?: (value: Record<string, unknown>) => Promise<Record<string, unknown>>
  commit?: (value: Record<string, unknown>) => Promise<Record<string, unknown>>
  complete?: (value: Record<string, unknown>) => Promise<Record<string, unknown>>
} = {}): DshRemoteControlPlane {
  return {
    prepareSessionTurnUpload: input.prepare ?? (async () => ({
      upload_id: 'upload-01', upload_url: 'https://oss.example.test/exact-object',
      upload_headers: { 'x-oss-meta-content-sha256': 'signed' }, expires_at: 9_999_999_999_999,
    })),
    commitSessionTurnUpload: input.commit ?? (async () => ({})),
    completeSessionTurnObjectHistory: input.complete ?? (async () => ({})),
  } as unknown as DshRemoteControlPlane
}

function uploadCollector(target: Buffer[], fail = false): typeof fetch {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    if (fail) throw new TypeError('network unavailable')
    target.push(Buffer.from(await new Response(init?.body).arrayBuffer()))
    return new Response('', { status: 200 })
  }) as unknown as typeof fetch
}

describe('DSH remote Turn OSS outbox', () => {
  it('removes the pre-finalization revision table so local history is proven again', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-turn-finalization-cutover-'))
    const database = new DatabaseSync(join(directory, 'turn-upload.sqlite3'))
    database.exec(`
      CREATE TABLE dsh_history_backfill_v1 (
        session_ref TEXT PRIMARY KEY,
        source_revision TEXT NOT NULL,
        queued_at_millis INTEGER NOT NULL
      );
      INSERT INTO dsh_history_backfill_v1 VALUES ('session-01', 'revision-1', 1);
      CREATE TABLE dsh_history_finalization_v1 (
        session_ref TEXT PRIMARY KEY,
        source_revision TEXT NOT NULL,
        through_seq INTEGER NOT NULL,
        state TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        next_attempt_at_millis INTEGER NOT NULL,
        created_at_millis INTEGER NOT NULL,
        updated_at_millis INTEGER NOT NULL
      );
      INSERT INTO dsh_history_finalization_v1
        VALUES ('session-01', 'revision-1', 5, 'FINALIZED', 0, 0, 1, 1);
    `)
    database.close()

    const outbox = new DshRemoteTurnUploadOutbox({
      directory, profileRef: 'web', key: Buffer.alloc(32, 1), controlPlane: backend(),
    })
    expect(outbox.needsHistoryRevision('session-01', 'revision-1')).toBe(true)
    await outbox.close()
  })

  it('isolates interleaved sessions and commits complete Turns through exact-object PUT', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-turn-outbox-'))
    const uploads: Buffer[] = []
    const prepare = vi.fn(async (value: Record<string, unknown>) => ({
      upload_id: `upload-${String(value.session_ref)}`,
      upload_url: `https://oss.example.test/${String(value.session_ref)}`,
      upload_headers: {}, expires_at: 9_999_999_999_999,
    }))
    const commit = vi.fn(async () => ({}))
    const outbox = new DshRemoteTurnUploadOutbox({
      directory, profileRef: 'web', key: Buffer.alloc(32, 1), controlPlane: backend({ prepare, commit }), fetch: uploadCollector(uploads),
    })
    await outbox.activate(runtime)

    await outbox.capture('session-a', [entry('turn/start', 1), entry('assistant/chunk', 2, { chunk: { type: 'text-delta', index: 0, text: 'A' } })])
    await outbox.capture('session-b', [entry('turn/start', 10), entry('assistant/chunk', 11, { chunk: { type: 'text-delta', index: 0, text: 'B' } })])
    await outbox.capture('session-a', [entry('turn/end', 3)])
    await outbox.capture('session-b', [entry('turn/end', 12, { reason: { kind: 'error' } })])
    await outbox.capture('session-c', [
      entry('turn/start', 20), entry('turn/cancelled', 21),
      entry('turn/end', 22, { reason: { kind: 'interrupted' } }),
    ])
    await outbox.drain()

    expect(outbox.stats()).toMatchObject({ COMMITTED: 3, OPEN: 0 })
    expect(prepare).toHaveBeenCalledTimes(3)
    expect(prepare.mock.calls.map(call => call[0])).toEqual(expect.arrayContaining([
      expect.objectContaining({
        session_ref: 'session-a', turn_ref: 'turn:1:3', status: 'completed',
        content_md5: expect.stringMatching(/^[A-Za-z0-9+/]{22}==$/),
      }),
      expect.objectContaining({ session_ref: 'session-b', turn_ref: 'turn:10:12', status: 'error' }),
      expect.objectContaining({ session_ref: 'session-c', turn_ref: 'turn:20:22', status: 'interrupted' }),
    ]))
    expect(commit).toHaveBeenCalledTimes(3)
    const payloads = uploads.map(value => JSON.parse(gunzipSync(value).toString('utf8')) as Record<string, unknown>)
    expect(payloads.map(value => (value.turn as Record<string, unknown>).turn_ref).sort())
      .toEqual(['turn:10:12', 'turn:1:3', 'turn:20:22'].sort())
    expect(payloads.every(value => Array.isArray(value.events))).toBe(true)
    await outbox.close()
  })

  it('finalizes one stable history cut only after every Turn object is committed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-turn-finalization-'))
    const complete = vi.fn(async () => ({}))
    const onFinalized = vi.fn()
    const outbox = new DshRemoteTurnUploadOutbox({
      directory, profileRef: 'web', key: Buffer.alloc(32, 1),
      controlPlane: backend({ complete }), fetch: uploadCollector([]), onFinalized,
    })
    await outbox.activate(runtime)
    await outbox.capture('session-01', [
      entry('turn/start', 1), entry('assistant/message', 2), entry('turn/end', 3),
    ])
    outbox.queueHistoryFinalization('session-01', 'revision-1', 5)
    await outbox.drain()

    expect(complete).toHaveBeenCalledWith({
      runtime_ref: 'runtime-01', host_generation: 7, session_ref: 'session-01', through_seq: 5,
      committed_turn_count: 1, last_committed_turn_ref: 'turn:1:3', last_committed_end_seq: 3,
    }, expect.any(AbortSignal))
    expect(outbox.needsHistoryRevision('session-01', 'revision-1')).toBe(false)
    expect(onFinalized).toHaveBeenCalledWith('session-01')
    await outbox.drain()
    expect(complete).toHaveBeenCalledOnce()
    await outbox.close()
  })

  it('advances live completion immediately only after a full-history checkpoint exists', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-turn-live-completion-'))
    const complete = vi.fn(async () => ({}))
    const outbox = new DshRemoteTurnUploadOutbox({
      directory, profileRef: 'web', key: Buffer.alloc(32, 1),
      controlPlane: backend({ complete }), fetch: uploadCollector([]),
    })
    await outbox.activate(runtime)
    await outbox.capture('session-01', [entry('turn/start', 1), entry('turn/end', 2)])
    outbox.queueHistoryFinalization('session-01', 'revision-1', 2)
    await outbox.drain()
    complete.mockClear()

    await outbox.capture('session-01', [entry('turn/start', 3), entry('turn/end', 4)])
    await outbox.drain()

    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      session_ref: 'session-01', through_seq: 4,
      committed_turn_count: 2, last_committed_end_seq: 4,
    }), expect.any(AbortSignal))
    expect(outbox.needsHistoryRevision('session-01', 'revision-1')).toBe(false)
    await outbox.close()
  })

  it('requires a current-start history proof before advancing live completion after restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-turn-live-restart-proof-'))
    const first = new DshRemoteTurnUploadOutbox({
      directory, profileRef: 'web', key: Buffer.alloc(32, 1),
      controlPlane: backend(), fetch: uploadCollector([]),
    })
    await first.activate(runtime)
    await first.capture('session-01', [entry('turn/start', 1), entry('turn/end', 2)])
    first.queueHistoryFinalization('session-01', 'revision-1', 2)
    await first.drain()
    await first.close()

    const complete = vi.fn(async () => ({}))
    const second = new DshRemoteTurnUploadOutbox({
      directory, profileRef: 'web', key: Buffer.alloc(32, 1),
      controlPlane: backend({ complete }), fetch: uploadCollector([]),
    })
    await second.activate(runtime)
    await second.capture('session-01', [entry('turn/start', 3), entry('turn/end', 4)])
    await second.drain()
    expect(complete).not.toHaveBeenCalled()

    second.queueHistoryFinalization('session-01', 'revision-2', 4)
    await second.drain()
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      session_ref: 'session-01', through_seq: 4, committed_turn_count: 2,
    }), expect.any(AbortSignal))
    await second.close()
  })

  it('recovers a pending history finalization after restart without recapturing Turn payloads', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-turn-finalization-recovery-'))
    let now = 1_000
    const firstComplete = vi.fn(async () => {
      throw new DshRemoteError('REMOTE_PROJECTION_CONFLICT', 'complete rejected', false)
    })
    const first = new DshRemoteTurnUploadOutbox({
      directory, profileRef: 'web', key: Buffer.alloc(32, 1), now: () => now,
      retryBaseMillis: 100, controlPlane: backend({ complete: firstComplete }), fetch: uploadCollector([]),
    })
    await first.activate(runtime)
    await first.capture('session-01', [entry('turn/start', 1), entry('turn/end', 2)])
    first.queueHistoryFinalization('session-01', 'revision-1', 2)
    await first.drain()
    expect(firstComplete).toHaveBeenCalledOnce()
    expect(first.stats().COMMITTED).toBe(1)
    await first.close()

    now = 2_000
    const recoveredComplete = vi.fn(async () => ({}))
    const second = new DshRemoteTurnUploadOutbox({
      directory, profileRef: 'web', key: Buffer.alloc(32, 1), now: () => now,
      retryBaseMillis: 100, controlPlane: backend({ complete: recoveredComplete }), fetch: uploadCollector([]),
    })
    await second.activate(runtime)
    await second.drain()
    expect(recoveredComplete).toHaveBeenCalledWith(expect.objectContaining({
      session_ref: 'session-01', through_seq: 2, committed_turn_count: 1,
      last_committed_turn_ref: 'turn:1:2', last_committed_end_seq: 2,
    }), expect.any(AbortSignal))
    expect(second.stats().COMMITTED).toBe(1)
    await second.close()
  })

  it('keeps error and cancel lifecycle events inside the Turn until the canonical turn/end', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-turn-terminal-boundary-'))
    const prepare = vi.fn(async () => ({
      upload_id: 'upload-error', upload_url: 'https://oss.example.test/error',
      upload_headers: {}, expires_at: 9_999_999_999_999,
    }))
    const outbox = new DshRemoteTurnUploadOutbox({
      directory, profileRef: 'web', key: Buffer.alloc(32, 1),
      controlPlane: backend({ prepare }), fetch: uploadCollector([]),
    })
    await outbox.activate(runtime)
    await outbox.capture('session-01', [
      entry('turn/start', 1), entry('turn/error', 2), entry('turn/cancelled', 3),
    ])
    await outbox.drain()
    expect(outbox.stats()).toMatchObject({ OPEN: 1, COMMITTED: 0 })
    expect(prepare).not.toHaveBeenCalled()

    await outbox.capture('session-01', [entry('turn/end', 4, { reason: { kind: 'error' } })])
    await outbox.drain()
    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({
      turn_ref: 'turn:1:4', end_seq: 4, event_count: 4, status: 'error',
    }), expect.any(AbortSignal))
    expect(outbox.stats().COMMITTED).toBe(1)
    await outbox.close()
  })

  it('recovers PREPARED unknown outcomes after restart without regenerating the Turn identity', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-turn-recovery-'))
    let now = 1_000
    const prepare = vi.fn(async () => ({
      upload_id: 'upload-stable', upload_url: 'https://oss.example.test/stable',
      upload_headers: {}, expires_at: 100_000,
    }))
    const first = new DshRemoteTurnUploadOutbox({
      directory, profileRef: 'web', key: Buffer.alloc(32, 1), controlPlane: backend({ prepare }), fetch: uploadCollector([], true),
      now: () => now, retryBaseMillis: 100,
    })
    await first.activate(runtime)
    await first.capture('session-01', [entry('turn/start', 1), entry('turn/end', 2)])
    await first.drain()
    expect(first.stats().PREPARED).toBe(1)
    await first.close()

    now = 2_000
    const uploads: Buffer[] = []
    const commit = vi.fn(async () => ({}))
    const second = new DshRemoteTurnUploadOutbox({
      directory, profileRef: 'web', key: Buffer.alloc(32, 1), controlPlane: backend({ prepare, commit }), fetch: uploadCollector(uploads),
      now: () => now, retryBaseMillis: 100,
    })
    await second.activate(runtime)
    await second.drain()

    expect(prepare).toHaveBeenCalledOnce()
    expect(commit).toHaveBeenCalledWith({ upload_id: 'upload-stable', content_sha256: expect.any(String) }, expect.any(AbortSignal))
    expect(second.stats().COMMITTED).toBe(1)
    expect(uploads).toHaveLength(1)
    await second.close()
  })

  it('recovers an UPLOADED commit outcome without repeating prepare or PUT', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-turn-commit-recovery-'))
    let now = 1_000
    const prepare = vi.fn(async () => ({
      upload_id: 'upload-stable', upload_url: 'https://oss.example.test/stable',
      upload_headers: {}, expires_at: 100_000,
    }))
    const firstUpload = uploadCollector([])
    const first = new DshRemoteTurnUploadOutbox({
      directory, profileRef: 'web', key: Buffer.alloc(32, 4), now: () => now,
      controlPlane: backend({ prepare, commit: async () => { throw new TypeError('unknown commit outcome') } }),
      fetch: firstUpload, retryBaseMillis: 100,
    })
    await first.activate(runtime)
    await first.capture('session-01', [entry('turn/start', 1), entry('turn/end', 2)])
    await first.drain()
    expect(first.stats().UPLOADED).toBe(1)
    await first.close()

    now = 2_000
    const secondUpload = uploadCollector([])
    const commit = vi.fn(async () => ({}))
    const second = new DshRemoteTurnUploadOutbox({
      directory, profileRef: 'web', key: Buffer.alloc(32, 4), now: () => now,
      controlPlane: backend({ prepare, commit }), fetch: secondUpload, retryBaseMillis: 100,
    })
    await second.activate(runtime)
    await second.drain()

    expect(prepare).toHaveBeenCalledOnce()
    expect(firstUpload).toHaveBeenCalledOnce()
    expect(secondUpload).not.toHaveBeenCalled()
    expect(commit).toHaveBeenCalledOnce()
    expect(second.stats().COMMITTED).toBe(1)
    await second.close()
  })

  it.each(['PREPARED', 'UPLOADED'] as const)(
    'keeps the immutable idempotency key when %s recovery refreshes Host authority',
    async failureState => {
      const directory = await mkdtemp(join(tmpdir(), `dsh-turn-generation-${failureState.toLowerCase()}-`))
      let now = 1_000
      const prepare = vi.fn(async () => ({
        upload_id: `upload-${String(prepare.mock.calls.length)}`,
        upload_url: `https://oss.example.test/${String(prepare.mock.calls.length)}`,
        upload_headers: {}, expires_at: 100_000,
      }))
      let uploadCalls = 0
      const upload = vi.fn(async () => {
        uploadCalls += 1
        if (failureState === 'PREPARED' && uploadCalls === 1) throw new TypeError('upload outcome unknown')
        return new Response('', { status: 200 })
      }) as unknown as typeof fetch
      let commitCalls = 0
      const commit = vi.fn(async () => {
        commitCalls += 1
        if (failureState === 'UPLOADED' && commitCalls === 1) throw new TypeError('commit outcome unknown')
        return {}
      })
      const outbox = new DshRemoteTurnUploadOutbox({
        directory, profileRef: 'web', key: Buffer.alloc(32, 6), now: () => now,
        controlPlane: backend({ prepare, commit }), fetch: upload, retryBaseMillis: 100,
      })
      await outbox.activate(runtime)
      await outbox.capture('session-01', [entry('turn/start', 1), entry('turn/end', 2)])
      await outbox.drain()
      expect(outbox.stats()[failureState]).toBe(1)

      now = 2_000
      await outbox.activate({ ...runtime, hostGeneration: 8 })
      await outbox.drain()

      expect(prepare).toHaveBeenCalledTimes(2)
      expect(prepare.mock.calls[0]![0].idempotency_key)
        .toBe(prepare.mock.calls[1]![0].idempotency_key)
      expect(outbox.stats().COMMITTED).toBe(1)
      await outbox.close()
    },
  )

  it('re-prepares expired credentials and keeps exact-object PUT concurrency at one', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-turn-concurrency-'))
    let now = 10_000
    let prepares = 0
    let active = 0
    let maximum = 0
    const prepare = vi.fn(async (value: Record<string, unknown>) => {
      prepares += 1
      return {
        upload_id: `upload-${String(value.turn_ref)}-${String(prepares)}`,
        upload_url: `https://oss.example.test/${String(prepares)}`,
        upload_headers: {}, expires_at: prepares === 1
          ? Math.trunc(now / 1_000) + 1
          : Math.trunc((now + 60_000) / 1_000),
      }
    })
    const upload = vi.fn(async () => {
      active += 1
      maximum = Math.max(maximum, active)
      await new Promise(resolve => setTimeout(resolve, 5))
      active -= 1
      return new Response('', { status: 200 })
    }) as unknown as typeof fetch
    const outbox = new DshRemoteTurnUploadOutbox({
      directory, profileRef: 'web', key: Buffer.alloc(32, 5), now: () => now,
      controlPlane: backend({ prepare }), fetch: upload, retryBaseMillis: 100,
    })
    await outbox.activate(runtime)
    await outbox.capture('session-a', [entry('turn/start', 1), entry('turn/end', 2)])
    await outbox.capture('session-b', [entry('turn/start', 10), entry('turn/end', 11)])
    await outbox.drain()
    expect(outbox.stats().SEALED).toBe(2)

    now += 1_000
    await outbox.drain()
    expect(outbox.stats().COMMITTED).toBe(2)
    expect(prepares).toBe(3)
    expect(maximum).toBe(1)
    await outbox.close()
  })

  it('skips PUT when Backend reports that the immutable Turn already exists', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-turn-committed-'))
    const upload = vi.fn(async () => new Response('', { status: 200 })) as unknown as typeof fetch
    const commit = vi.fn(async () => ({}))
    const outbox = new DshRemoteTurnUploadOutbox({
      directory, profileRef: 'web', key: Buffer.alloc(32, 2), fetch: upload,
      controlPlane: backend({
        prepare: async () => ({
          already_committed: true,
        }),
        commit,
      }),
    })
    await outbox.activate(runtime)
    await outbox.capture('session-01', [entry('turn/start', 41), entry('turn/end', 42)])
    await outbox.drain()

    expect(upload).not.toHaveBeenCalled()
    expect(commit).not.toHaveBeenCalled()
    expect(outbox.stats().COMMITTED).toBe(1)
    await outbox.close()
  })

  it('refuses an oversized single object with a stable non-retryable error', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-turn-limit-'))
    const errors: unknown[] = []
    const prepare = vi.fn(async () => ({}))
    const outbox = new DshRemoteTurnUploadOutbox({
      directory, profileRef: 'web', key: Buffer.alloc(32, 3), controlPlane: backend({ prepare }),
      fetch: uploadCollector([]), maxObjectBytes: 1, onError: error => { errors.push(error) },
    })
    await outbox.activate(runtime)
    await outbox.capture('session-01', [entry('turn/start', 1), entry('turn/end', 2)])
    await outbox.drain()

    expect(prepare).not.toHaveBeenCalled()
    expect(errors).toEqual([expect.objectContaining({ code: 'CAPABILITY_UNSUPPORTED', retryable: false })])
    expect(outbox.stats().SEALED).toBe(1)
    await outbox.close()
  })

  it('bounds pending local spool growth without blocking later realtime delivery', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-turn-spool-limit-'))
    const outbox = new DshRemoteTurnUploadOutbox({
      directory, profileRef: 'web', key: Buffer.alloc(32, 3), controlPlane: backend(),
      maxPendingSpoolBytes: 64,
    })
    await outbox.activate(runtime)
    await expect(outbox.capture('session-01', [
      entry('turn/start', 1),
      entry('assistant/chunk', 2, { chunk: { type: 'text-delta', index: 0, text: 'x'.repeat(256) } }),
    ])).rejects.toMatchObject({ code: 'REMOTE_STORAGE_FAILED', retryable: false })
    expect(outbox.stats().COMMITTED).toBe(0)
    await outbox.close()
  })

  it('pauses a non-retryable poison row and continues draining later Turns', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-turn-poison-'))
    const prepare = vi.fn(async (value: Record<string, unknown>) => {
      if (value.session_ref === 'session-poison') {
        throw new DshRemoteError('REMOTE_PROJECTION_CONFLICT', 'hash mismatch')
      }
      return {
        upload_id: 'upload-good', upload_url: 'https://oss.example.test/good',
        upload_headers: {}, expires_at: 9_999_999_999_999,
      }
    })
    const outbox = new DshRemoteTurnUploadOutbox({
      directory, profileRef: 'web', key: Buffer.alloc(32, 7),
      controlPlane: backend({ prepare }), fetch: uploadCollector([]),
    })
    await outbox.activate(runtime)
    await outbox.capture('session-poison', [entry('turn/start', 1), entry('turn/end', 2)])
    await outbox.capture('session-good', [entry('turn/start', 10), entry('turn/end', 11)])
    await outbox.drain()

    expect(outbox.stats()).toMatchObject({ SEALED: 1, COMMITTED: 1 })
    expect(prepare.mock.calls.map(call => call[0].session_ref)).toEqual(['session-poison', 'session-good'])
    await outbox.close()
  })

  it('retries a paused SEALED Turn once after restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-turn-paused-restart-'))
    const first = new DshRemoteTurnUploadOutbox({
      directory, profileRef: 'web', key: Buffer.alloc(32, 7),
      controlPlane: backend({
        prepare: async () => { throw new DshRemoteError('REMOTE_PROJECTION_CONFLICT', 'old backend rejection') },
      }),
    })
    await first.activate(runtime)
    await first.capture('session-01', [entry('turn/start', 1), entry('turn/end', 2)])
    await first.drain()
    expect(first.stats().SEALED).toBe(1)
    await first.close()

    const prepare = vi.fn(async () => ({
      upload_id: 'upload-recovered', upload_url: 'https://oss.example.test/recovered',
      upload_headers: {}, expires_at: 9_999_999_999_999,
    }))
    const second = new DshRemoteTurnUploadOutbox({
      directory, profileRef: 'web', key: Buffer.alloc(32, 7),
      controlPlane: backend({ prepare }), fetch: uploadCollector([]),
    })
    await second.activate(runtime)
    await second.drain()

    expect(prepare).toHaveBeenCalledOnce()
    expect(second.stats()).toMatchObject({ SEALED: 0, COMMITTED: 1 })
    await second.close()
  })

  it('keeps an OPEN Turn resumable across restart instead of inventing an interrupted terminal state', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-turn-open-recovery-'))
    const first = new DshRemoteTurnUploadOutbox({
      directory, profileRef: 'web', key: Buffer.alloc(32, 8), controlPlane: backend(),
    })
    await first.activate(runtime)
    await first.capture('session-01', [
      entry('turn/start', 1),
      entry('assistant/chunk', 2, { chunk: { type: 'text-delta', index: 0, text: 'prefix' } }),
    ])
    expect(first.stats().OPEN).toBe(1)
    await first.close()
    const database = new DatabaseSync(join(directory, 'turn-upload.sqlite3'))
    database.exec(`
      UPDATE dsh_turn_upload_v2
      SET state = 'OPEN', event_count = 0, end_seq = 0, spool_bytes = 0
    `)
    database.close()

    const prepare = vi.fn(async () => ({
      upload_id: 'upload-interrupted', upload_url: 'https://oss.example.test/interrupted',
      upload_headers: {}, expires_at: 9_999_999_999_999,
    }))
    const second = new DshRemoteTurnUploadOutbox({
      directory, profileRef: 'web', key: Buffer.alloc(32, 8), controlPlane: backend({ prepare }),
      fetch: uploadCollector([]),
    })
    await second.activate(runtime)
    // The account-scoped durable OPEN row proves continuity; recovery repairs
    // stale SQLite counters from the spool before appending the suffix.
    await second.capture('session-01', [entry('turn/end', 3)])
    await second.drain()

    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({
      turn_ref: 'turn:1:3', end_seq: 3, status: 'completed', event_count: 3,
    }), expect.any(AbortSignal))
    expect(second.stats().COMMITTED).toBe(1)
    await second.close()
  })

  it('discards a corrupt OPEN spool and its revision checkpoint so cold history can rebuild it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-turn-corrupt-open-'))
    const first = new DshRemoteTurnUploadOutbox({
      directory, profileRef: 'web', key: Buffer.alloc(32, 8), controlPlane: backend(),
    })
    await first.activate(runtime)
    await first.capture('session-01', [entry('turn/start', 1), entry('assistant/chunk', 2)])
    first.queueHistoryFinalization('session-01', 'revision-corrupt', 2)
    await first.close()
    const database = new DatabaseSync(join(directory, 'turn-upload.sqlite3'))
    const row = database.prepare(`
      SELECT spool_name FROM dsh_turn_upload_v2 WHERE state = 'OPEN'
    `).get() as unknown as { spool_name: string }
    database.close()
    await writeFile(join(directory, 'spool', row.spool_name), '{not-json}\n')

    const second = new DshRemoteTurnUploadOutbox({
      directory, profileRef: 'web', key: Buffer.alloc(32, 8), controlPlane: backend(),
    })
    await second.activate(runtime)
    expect(second.stats()).toEqual({ OPEN: 0, SEALED: 0, PREPARED: 0, UPLOADED: 0, COMMITTED: 0 })
    expect(second.needsHistoryRevision('session-01', 'revision-corrupt')).toBe(true)
    await second.close()
  })

  it('re-prepares when an UPLOADED commit finds an expired UploadIntent', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-turn-intent-expired-'))
    let now = 1_000
    const prepare = vi.fn(async () => ({
      upload_id: `upload-${String(prepare.mock.calls.length)}`,
      upload_url: `https://oss.example.test/${String(prepare.mock.calls.length)}`,
      upload_headers: {}, expires_at: 100_000,
    }))
    let commitCalls = 0
    const commit = vi.fn(async () => {
      commitCalls += 1
      if (commitCalls === 1) throw new DshRemoteError('REMOTE_NOT_FOUND', 'intent expired')
      return {}
    })
    const outbox = new DshRemoteTurnUploadOutbox({
      directory, profileRef: 'web', key: Buffer.alloc(32, 9), now: () => now,
      controlPlane: backend({ prepare, commit }), fetch: uploadCollector([]), retryBaseMillis: 100,
    })
    await outbox.activate(runtime)
    await outbox.capture('session-01', [entry('turn/start', 1), entry('turn/end', 2)])
    await outbox.drain()
    expect(outbox.stats().SEALED).toBe(1)

    now = 2_000
    await outbox.drain()
    expect(prepare).toHaveBeenCalledTimes(2)
    expect(commit).toHaveBeenCalledTimes(2)
    expect(outbox.stats().COMMITTED).toBe(1)
    await outbox.close()
  })

  it('removes payload files left after a COMMITTED metadata crash window', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-turn-committed-cleanup-'))
    const first = new DshRemoteTurnUploadOutbox({
      directory, profileRef: 'web', key: Buffer.alloc(32, 10),
      controlPlane: backend(), fetch: uploadCollector([]),
    })
    await first.activate(runtime)
    await first.capture('session-01', [entry('turn/start', 1), entry('turn/end', 2)])
    await first.drain()
    const database = new DatabaseSync(join(directory, 'turn-upload.sqlite3'))
    const row = database.prepare(`
      SELECT spool_name, object_name FROM dsh_turn_upload_v2 WHERE state = 'COMMITTED'
    `).get() as unknown as { spool_name: string; object_name: string }
    database.close()
    await first.close()

    const spoolPath = join(directory, 'spool', row.spool_name)
    const objectPath = join(directory, 'spool', row.object_name)
    await writeFile(spoolPath, 'orphan')
    await writeFile(objectPath, 'orphan')
    const second = new DshRemoteTurnUploadOutbox({
      directory, profileRef: 'web', key: Buffer.alloc(32, 10), controlPlane: backend(),
    })
    await second.activate(runtime)
    expect(existsSync(spoolPath)).toBe(false)
    expect(existsSync(objectPath)).toBe(false)
    await second.close()
  })

  it('streams a large raw event set without adding cold-generation or ordinal fields', async () => {
    const yieldSpy = vi.spyOn(globalThis, 'setImmediate')
    const directory = await mkdtemp(join(tmpdir(), 'dsh-turn-large-'))
    const prepare = vi.fn(async () => ({
      upload_id: `upload-${String(prepare.mock.calls.length)}`,
      upload_url: `https://oss.example.test/${String(prepare.mock.calls.length)}`,
      upload_headers: {}, expires_at: 9_999_999_999_999,
    }))
    const uploads: Buffer[] = []
    const outbox = new DshRemoteTurnUploadOutbox({
      directory, profileRef: 'web', key: Buffer.alloc(32, 1), controlPlane: backend({ prepare }), fetch: uploadCollector(uploads),
    })
    await outbox.activate(runtime)
    const large = [entry('turn/start', 1)]
    for (let seq = 2; seq < 100_002; seq += 1) {
      large.push(entry('assistant/chunk', seq, { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'x'.repeat(64) } }))
    }
    large.push(entry('turn/end', 100_002))
    await outbox.capture('session-large', large)
    await outbox.capture('session-live', [entry('turn/start', 20_000), entry('turn/end', 20_001)])
    await outbox.drain()

    const largePrepare = prepare.mock.calls.find(call => call[0].session_ref === 'session-large')?.[0]
    const live = prepare.mock.calls.find(call => call[0].session_ref === 'session-live')?.[0]
    expect(largePrepare).toMatchObject({ event_count: 100_002 })
    expect(largePrepare).not.toHaveProperty('history_generation')
    expect(largePrepare).not.toHaveProperty('ordinal')
    expect(largePrepare).not.toHaveProperty('part_count')
    expect(live).not.toHaveProperty('history_generation')
    expect(live).not.toHaveProperty('ordinal')
    const raw = uploads
      .map(value => JSON.parse(gunzipSync(value).toString('utf8')) as {
        turn: { turn_ref: string }
        presentation: { truncated?: boolean }
        events: unknown[]
      })
      .find(value => value.turn.turn_ref === 'turn:1:100002')!
    expect(raw.events).toHaveLength(100_002)
    expect(raw.presentation.truncated).toBe(true)
    expect(yieldSpy).toHaveBeenCalled()
    yieldSpy.mockRestore()
    await outbox.close()
  }, 30_000)
})
