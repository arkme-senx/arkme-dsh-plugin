import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { ArkmeStateStore } from '../src/state-store.js'
import { TranscriptViewService } from '../src/services/transcript-view-service.js'
import {
  ArkmeUpstreamResponseError,
  type ServiceRuntime,
} from '../src/services/service.js'
import type {
  TranscriptViewCommand,
  TranscriptViewSnapshot,
} from '../src/transcript-view-contract.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})
const target = {
    kind: 'recording' as const,
    source_uid: 'source',
    segment_uid: 'segment',
  },
  ref = JSON.stringify({ kind: 'recording', itemRef: 'opaque' })
const command: TranscriptViewCommand = {
  operation_id: 'restore-once',
  expected_revision: 0,
  original_version: 'v1',
  action: 'restore',
}
const snapshot: TranscriptViewSnapshot = {
  ...target,
  revision: 1,
  original_version: 'v1',
  original_digest: 'a'.repeat(64),
  original: '原文',
  text: '原文',
  marks: [],
  original_changed: false,
  complete: true,
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'private transcript '))
  roots.push(root)
  let userId = 7,
    store = new ArkmeStateStore(root)
  const post = vi.fn(async (path: string) =>
    path.endsWith('/read')
      ? { items: [snapshot] }
      : {
          ...snapshot,
          accepted: true,
          receipt: {
            operation_id: command.operation_id,
            accepted_revision: 1,
            target,
          },
        },
  )
  const runtime = {
    config: { environment: 'prod' },
    requireSession: async () => ({ userId }),
    get stateStore() {
      return store
    },
    authenticatedAudioPost: post,
    authenticatedWebrtcPost: post,
  } as unknown as ServiceRuntime
  const recording = {
      privateTranscriptTarget: vi.fn(async () => target),
      privateTranscriptSource: vi.fn(async () => target),
      validatePrivateTranscriptImport: vi.fn(async () => {}),
    },
    calls = {
      privateTranscriptTarget: vi.fn(async () => ({
        ...target,
        kind: 'call' as const,
      })),
      privateTranscriptSource: vi.fn(async () => ({ ...target, kind: 'call' as const })),
      validatePrivateTranscriptImport: vi.fn(async () => {}),
    }
  const service = () => new TranscriptViewService(runtime, recording, calls)
  return {
    root,
    post,
    service,
    restart: () => {
      store = new ArkmeStateStore(root)
    },
    switch: () => {
      userId = 8
    },
    store: () => store,
  }
}
it('persists a frozen attempt across response loss/restart; an immutable receipt settles without a second write', async () => {
  const f = await fixture()
  f.post.mockImplementationOnce(async () => {
    throw new Error('response lost')
  })
  await expect(f.service().change('prod:7', ref, command)).rejects.toThrow(
    'response lost',
  )
  expect(await readFile(join(f.root, 'state.json'), 'utf8')).toContain(
    'restore-once',
  )
  f.restart()
  f.post.mockImplementation(async (path: string) =>
    path.endsWith('/receipt')
      ? {
          receipt: {
            operation_id: command.operation_id,
            accepted_revision: 1,
            target,
          },
        }
      : { items: [snapshot] },
  )
  await expect(
    f
      .service()
      .change('prod:7', ref, { ...command, operation_id: 'new-button-id' }),
  ).resolves.toMatchObject({ revision: 1 })
  expect(
    f.post.mock.calls.filter(([path]) => path.endsWith('/change')),
  ).toHaveLength(1)
  expect(await readFile(join(f.root, 'state.json'), 'utf8')).not.toContain(
    'restore-once',
  )
})
it('replays the same frozen request only when retry intent matches; refuses an unrelated edit while outcome is unknown', async () => {
  const f = await fixture()
  f.post.mockImplementationOnce(async () => {
    throw new Error('offline')
  })
  await expect(f.service().change('prod:7', ref, command)).rejects.toThrow()
  f.post.mockImplementation(async () => ({ receipt: null }))
  await expect(
    f.service().change('prod:7', ref, { ...command, expected_revision: 1 }),
  ).rejects.toThrow('上次更正结果尚未确认')
  f.post.mockImplementation(async (path: string) =>
    path.endsWith('/receipt')
      ? { receipt: null }
      : {
          ...snapshot,
          accepted: true,
          receipt: {
            operation_id: command.operation_id,
            accepted_revision: 1,
            target,
          },
        },
  )
  await f
    .service()
    .change('prod:7', ref, { ...command, operation_id: 'different-ui-id' })
  expect(
    (
      f.post.mock.calls
        .filter(([path]) => path.endsWith('/change'))
        .at(-1) as unknown as [string, { command: TranscriptViewCommand }]
    )[1].command,
  ).toEqual(command)
})
it('clears only definite CAS rejection; refuses account switches and preserves corrupted recovery data', async () => {
  const f = await fixture()
  f.post.mockImplementationOnce(async () => {
    throw new ArkmeUpstreamResponseError(
      'arkme-code-1001',
      'changed',
      false,
      502,
      { error_code: 'revision_conflict' },
    )
  })
  await expect(f.service().change('prod:7', ref, command)).rejects.toThrow(
    '另一台设备已更新',
  )
  expect(await readFile(join(f.root, 'state.json'), 'utf8')).not.toContain(
    'restore-once',
  )
  f.switch()
  await expect(
    f.service().read('prod:7', 'recording:x', [{ id: 'one', ref }]),
  ).rejects.toThrow('账号已变化')
  const raw = JSON.parse(await readFile(join(f.root, 'state.json'), 'utf8'))
  raw.transcriptViewAttempts = 'corrupt'
  await writeFile(join(f.root, 'state.json'), JSON.stringify(raw))
  f.restart()
  await expect(
    f.store().transcriptViewAttempt('prod:7', 'a'.repeat(64)),
  ).rejects.toThrow('损坏')
  expect(await readFile(join(f.root, 'state.json'), 'utf8')).toContain(
    'corrupt',
  )
})

it('a restarted UI can inspect and explicitly retry the frozen request without reconstructing its lost draft', async () => {
  const f = await fixture()
  f.post.mockImplementationOnce(async () => {
    throw new Error('offline before acceptance')
  })
  await expect(f.service().change('prod:7', ref, command)).rejects.toThrow()
  f.restart()
  f.post.mockImplementation(async (path: string) =>
    path.endsWith('/read')
      ? { items: [snapshot], unchanged: [] }
      : path.endsWith('/receipt')
        ? { receipt: null }
        : {
            ...snapshot,
            accepted: true,
            receipt: {
              operation_id: command.operation_id,
              accepted_revision: 1,
              target,
            },
          },
  )
  const current = (
    await f
      .service()
      .read('prod:7', 'recording:day', [
        { id: 'one', ref, knownRevision: 1, knownOriginalVersion: 'v1' },
      ])
  ).one!
  expect(current.pendingCommand).toEqual(command)
  const readBody = f.post.mock.calls
    .filter(([path]) => path.endsWith('/read'))
    .at(-1)?.[1] as { known_revisions: unknown[] }
  expect(readBody.known_revisions).toEqual([])
  await f
    .service()
    .change('prod:7', ref, {
      operation_id: 'new-ui',
      expected_revision: current.revision,
      original_version: current.originalVersion,
      action: 'retry_pending',
    })
  expect(
    (
      f.post.mock.calls
        .filter(([path]) => path.endsWith('/change'))
        .at(-1)?.[1] as { command: TranscriptViewCommand }
    ).command,
  ).toEqual(command)
  expect(await readFile(join(f.root, 'state.json'), 'utf8')).not.toContain(
    'restore-once',
  )
})

it('a delayed ACK cannot erase a newer frozen request from another UI or SDK caller', async () => {
  const f = await fixture()
  let firstStarted!: () => void, secondStarted!: () => void
  let releaseFirst!: () => void, releaseSecond!: () => void
  const startedA = new Promise<void>(resolve => { firstStarted = resolve })
  const startedB = new Promise<void>(resolve => { secondStarted = resolve })
  const waitA = new Promise<void>(resolve => { releaseFirst = resolve })
  const waitB = new Promise<void>(resolve => { releaseSecond = resolve })
  const next = { ...command, operation_id: 'second-request', expected_revision: 1 }
  f.post.mockImplementation(async (path: string, body?: { command?: TranscriptViewCommand }) => {
    if (path.endsWith('/receipt')) return { receipt: { operation_id: command.operation_id, accepted_revision: 1, target } }
    if (path.endsWith('/read')) return { items: [snapshot], unchanged: [] }
    if (body?.command?.operation_id === command.operation_id) {
      firstStarted(); await waitA
      return { ...snapshot, accepted: true, receipt: { operation_id: command.operation_id, accepted_revision: 1, target } }
    }
    secondStarted(); await waitB
    throw new Error('second response lost')
  })
  const first = f.service().change('prod:7', ref, command)
  await startedA
  const second = f.service().change('prod:7', ref, next)
  const secondFailure = expect(second).rejects.toThrow('second response lost')
  await startedB
  releaseFirst(); await first
  const frozen = await readFile(join(f.root, 'state.json'), 'utf8')
  releaseSecond(); await secondFailure
  expect(frozen).toContain('second-request')
  f.restart()
  const current = await f.service().read('prod:7', 'recording:day', [{ id: 'one', ref }])
  expect(current.one?.pendingCommand?.operation_id).toBe('second-request')
})

it('revoked call history reports source access loss through the same private error contract', async () => {
  const f = await fixture()
  f.post.mockImplementation(async () => {
    throw new ArkmeUpstreamResponseError('arkme-code-1003', 'denied', false, 502, { error_code: 'source_unavailable' })
  })
  await expect(f.service().saved('prod:7', JSON.stringify({ kind: 'call', callRef: 'opaque-call' }))).rejects.toMatchObject({ code: 'transcript-source-unavailable', httpStatus: 403 })
})
