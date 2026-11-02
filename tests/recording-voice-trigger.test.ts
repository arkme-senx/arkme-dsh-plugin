import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { ArkmeStateStore } from '../src/state-store.js'
import { ArkmeLocalDatabase } from '../src/local-database.js'
import { ArkmePluginError, type ServiceRuntime } from '../src/services/service.js'
import { RecordingVoiceTriggerService } from '../src/services/recording-voice-trigger-service.js'
import { defaultRecordingVoiceRule, prioritizeRecordingVoiceCandidates, recordingVoiceRules } from '../src/recording-voice-trigger-contract.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import type { ArkmeService } from '../src/arkme-service.js'

const rule = () => ({ ...defaultRecordingVoiceRule(), enabled: true })
function candidate(id = 'candidate-1', speaker = 'unknown') {
  return { id, revision: 1, phrase: '帮我记一下', text: '明天记得拿快递', start_at: 1000, end_at: 2000, speaker, speaker_label: speaker === 'unknown' ? '未识别说话人' : speaker,
    status: 'pending', boundary: 'complete', evidence: { kind: 'audio-kws', model: 'test-acoustic-v1', score: .87 } }
}
function fixture() {
  let userId = 7, refreshToken = 'one', available = true
  let local = { revision: 0, rules: [defaultRecordingVoiceRule()] }, cloudRules = [rule()]
  const post = vi.fn(async (path: string, body: any): Promise<any> => {
    if (path.endsWith('/capabilities')) {
      if (!available) throw new ArkmePluginError('http', 'not found', false, 404)
      return { user_id: userId, version: 1, detector: 'audio-kws', ready: true, sources: ['upload', 'long-recording', 'all-day'] }
    }
    if (path.endsWith('/rules/query')) return { user_id: userId, revision: 4, rules: cloudRules }
    if (path.endsWith('/rules/set')) { cloudRules = body.rules; return { user_id: userId, revision: 5, rules: cloudRules } }
    if (path.endsWith('/candidates/query')) return { user_id: userId, items: [candidate('unknown'), candidate('self', 'self'), candidate('other', 'other')], next_cursor: 'raw-owner-cursor' }
    if (path.endsWith('/candidates/detail')) return { user_id: userId, id: body.id, revision: 1, anchors: [{ at_millis: 1000, date_stamp: 0, transcript_source: 'system' }, { at_millis: 2500, date_stamp: 0, transcript_source: 'system' }] }
    if (path.endsWith('/candidates/decide')) return { user_id: userId, candidate: { ...candidate(body.id), status: body.decision === 'save' ? 'saved' : 'ignored', revision: 2 } }
    throw new Error(path)
  })
  const store = { uniqueCode: async () => 'private-test-secret', recordingVoiceDraft: vi.fn(async (_scope, change) => {
    if (change) { if (change.revision !== local.revision) throw new Error('conflict'); local = { revision: local.revision + 1, rules: change.rules } }
    return structuredClone(local)
  }) }
  const locate = vi.fn(async () => ({ items: [{ itemRef: 'sealed-audio-1', startAtMillis: 900, endAtMillis: 2100 }, { itemRef: 'sealed-audio-2', startAtMillis: 2400, endAtMillis: 3000 }] as any }))
  const runtime = { config: { environment: 'prod' }, stateStore: store, requireSession: async () => ({ userId, refreshToken }), authenticatedAudioPost: post } as unknown as ServiceRuntime
  return { service: new RecordingVoiceTriggerService(runtime, locate), post, store, locate, setUser: (value: number) => { userId = value }, setToken: () => { refreshToken = 'two' }, unavailable: () => { available = false } }
}
const account = { accountKey: 'prod:7' }
const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })

it('normalizes configured acoustic phrases and refuses duplicate, blank, excessive and executable actions', () => {
  expect(recordingVoiceRules([{ ...rule(), phrase: ' 帮我记一下 ' }])[0]!.phrase).toBe('帮我记一下')
  for (const rules of [[{ ...rule(), aliases: ['帮我记一下。'] }], [{ ...rule(), phrase: '!!!' }], [{ ...rule(), phrase: '' }], Array.from({ length: 21 }, rule), [{ ...rule(), action: 'send-to-team' }], [{ ...rule(), id: 7 }]]) expect(() => recordingVoiceRules(rules)).toThrow()
})
it('preserves every acoustic hit and prefers self without requiring a voiceprint match', async () => {
  const f = fixture(), page = await f.service.request('page', account) as any
  expect(page.items.map((item: any) => item.speaker)).toEqual(['unknown', 'self', 'other'])
  expect(prioritizeRecordingVoiceCandidates(page.items).map(item => item.speaker)).toEqual(['self', 'unknown', 'other'])
  expect(JSON.stringify(page)).not.toContain('raw-owner-cursor')
  expect(page.items[0].candidateRef).not.toBe('unknown')
  await f.service.request('page', { ...account, cursor: page.nextCursor })
  expect(f.post.mock.calls.at(-1)![1]).toMatchObject({ cursor: 'raw-owner-cursor', order: 'self-first' })
})
it('reads settings without starting work and keeps pending rules in stable local storage', async () => {
  const f = fixture(); f.unavailable()
  expect(await f.service.request('settings', account)).toMatchObject({ available: false, draft: { revision: 0 } })
  expect(await f.service.request('save', { ...account, localRevision: 0, rules: [rule()] })).toMatchObject({ available: false, draft: { revision: 1 }, rules: [{ enabled: true }] })
  expect(f.post.mock.calls.every(([path]) => path.endsWith('/capabilities'))).toBe(true)
  await expect(f.service.request('save', { ...account, localRevision: 0, rules: [rule()] })).rejects.toThrow('其他窗口')
  await expect(f.service.request('page', account)).rejects.toThrow('后端接口开发中')
})
it('persists account/environment-isolated drafts across Host restarts with CAS', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'voice-trigger-test-')); dirs.push(directory)
  const first = new ArkmeLocalDatabase(directory, new ArkmeStateStore(directory))
  await first.recordingVoiceDraft('prod:7', { revision: 0, rules: [rule()] })
  await first.close()
  const restarted = new ArkmeStateStore(directory)
  expect(await restarted.recordingVoiceDraft('prod:7')).toMatchObject({ revision: 1, rules: [{ enabled: true }] })
  expect(await restarted.recordingVoiceDraft('test:7')).toMatchObject({ revision: 0, rules: [{ enabled: false }] })
  expect(await restarted.recordingVoiceDraft('prod:8')).toMatchObject({ revision: 0 })
  await expect(restarted.recordingVoiceDraft('prod:7', { revision: 0, rules: [] })).rejects.toThrow('其他窗口')
  expect(JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')).recordingVoiceDrafts['prod:7'].revision).toBe(1)
})
it('requires the acoustic detector to cover every recording source and rejects text-only evidence', async () => {
  const f = fixture()
  f.post.mockResolvedValueOnce({ user_id: 7, version: 1, detector: 'audio-kws', ready: true, sources: ['upload'] })
  expect(await f.service.request('settings', account)).toMatchObject({ available: false })
  f.post.mockResolvedValueOnce({ user_id: 7, version: 1, detector: 'audio-kws', ready: true, sources: ['upload', 'long-recording', 'all-day'] })
  f.post.mockResolvedValueOnce({ user_id: 7, items: [{ ...candidate(), evidence: { kind: 'transcript-match', score: 1, model: 'text' } }] })
  await expect(f.service.request('page', account)).rejects.toThrow('数据无效')
})
it('does not hide auth/network/owner failures as pending or an empty page', async () => {
  for (const status of [401, 403, 500, 503]) {
    const f = fixture(); f.post.mockRejectedValueOnce(new ArkmePluginError('upstream', '网络或权限错误', true, status))
    await expect(f.service.request('settings', account)).rejects.toThrow('网络或权限错误')
  }
  const f = fixture(); f.post.mockResolvedValueOnce({ user_id: 8 })
  await expect(f.service.request('settings', account)).rejects.toThrow('数据无效')
})
it('rejects account changes, stale tokens, wrong-owner refs and cross-kind cursors before exposing sources', async () => {
  const f = fixture(), page = await f.service.request('page', account) as any, ref = page.items[0].candidateRef
  await expect(f.service.request('page', { accountKey: 'prod:8' })).rejects.toThrow('账号已切换')
  await expect(f.service.request('detail', { ...account, candidateRef: page.nextCursor })).rejects.toThrow('引用失效')
  f.setUser(8)
  await expect(f.service.request('detail', { accountKey: 'prod:8', candidateRef: ref })).rejects.toThrow('引用失效')
  expect(f.locate).not.toHaveBeenCalled()
  const g = fixture(); g.post.mockImplementationOnce(async () => { g.setToken(); return { user_id: 7 } })
  await expect(g.service.request('settings', account)).rejects.toThrow('账号已切换')
})
it('saves an unknown voice independently from marking and maps cross-chunk sources on demand', async () => {
  const f = fixture(), page = await f.service.request('page', account) as any, ref = page.items[0].candidateRef
  const result = await f.service.request('decide', { ...account, candidateRef: ref, decision: 'save' }) as any
  expect(result.status).toBe('saved'); expect(result.candidateKey).toBe(page.items[0].candidateKey)
  expect(f.locate).not.toHaveBeenCalled()
  expect(f.post.mock.calls.at(-1)![1]).toEqual({ id: 'unknown', expected_revision: 1, decision: 'save' })
  expect(await f.service.request('detail', { ...account, candidateRef: ref })).toMatchObject({ items: [{ itemRef: 'sealed-audio-1' }, { itemRef: 'sealed-audio-2' }] })
  expect(f.locate).toHaveBeenCalledTimes(1)
  expect(f.post.mock.calls.some(([path]) => path.includes('speaker'))).toBe(false)
})
it('separates Host reads from mutations', async () => {
  const recordingVoiceTriggers = vi.fn(async () => ({})), service = { recordingVoiceTriggers } as unknown as ArkmeService
  await expect(dispatchArkmeHostOperation(service, 'recordings.voice-triggers', { ...account, action: 'decide' })).rejects.toThrow('读取操作')
  expect(recordingVoiceTriggers).not.toHaveBeenCalled()
  await dispatchArkmeHostOperation(service, 'recordings.voice-triggers.rules.set', { ...account, rules: [] })
  expect(recordingVoiceTriggers).toHaveBeenCalledWith('save', { ...account, rules: [] }, undefined)
})

it('refuses ambiguous or stale source mappings instead of playing/marking a nearby voice', async () => {
  const f = fixture(), page = await f.service.request('page', account) as any
  f.locate.mockResolvedValueOnce({ items: [{ itemRef: 'a', startAtMillis: 900, endAtMillis: 2000 }, { itemRef: 'b', startAtMillis: 950, endAtMillis: 1800 }] as any })
  await expect(f.service.request('detail', { ...account, candidateRef: page.items[0].candidateRef })).rejects.toThrow('原音定位')
})
