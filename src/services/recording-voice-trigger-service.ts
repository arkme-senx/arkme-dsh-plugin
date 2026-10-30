import { TimelineTokenCodec } from './timeline-token.js'
import { createHmac } from 'node:crypto'
import { ArkmePluginError, objectValue, type ServiceRuntime } from './service.js'
import { defaultRecordingVoiceRule, recordingVoiceRules, type RecordingVoiceCandidate, type RecordingVoiceSettings } from '../recording-voice-trigger-contract.js'
import type { ArkmeRecordingWorkbenchItem } from '../types.js'

const ROOT = '/api/v1/audio/voice-triggers/'
function invalid(): never { throw new ArkmePluginError('voice-trigger-contract-invalid', '语音触发数据无效，请刷新后重试', false, 502) }
function text(value: unknown, max = 128): string { if (typeof value !== 'string' || !value || value.length > max) invalid(); return value }
function number(value: unknown): number { if (!Number.isSafeInteger(value) || (value as number) < 0) invalid(); return value as number }
function array(value: unknown, max = 50): unknown[] { if (!Array.isArray(value) || value.length > max) invalid(); return value }
type Locate = (query: { dateStamp: number; atMillis: number; transcriptSource: 'system' | 'doubao' }, signal?: AbortSignal) => Promise<{ items: ArkmeRecordingWorkbenchItem[] }>

/** Proposed Audio owner adapter. No text fallback, model in the browser, polling or automatic writes. */
export class RecordingVoiceTriggerService {
  constructor(private readonly runtime: ServiceRuntime, private readonly locate: Locate) {}
  async request(action: 'settings' | 'save' | 'page' | 'detail' | 'decide', input: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const session = await this.runtime.requireSession(), accountKey = `${this.runtime.config.environment}:${session.userId}`
    if (input.accountKey !== accountKey) throw new ArkmePluginError('voice-trigger-account-changed', '账号已切换，请重新打开语音触发', false, 409)
    const assertCurrent = async () => {
      signal?.throwIfAborted()
      const current = await this.runtime.requireSession()
      if (current.userId !== session.userId || current.refreshToken !== session.refreshToken) throw new ArkmePluginError('voice-trigger-account-changed', '账号已切换，请重新打开语音触发', false, 409)
    }
    const post = async (path: string, body: Record<string, unknown>) => {
      const raw = objectValue(await this.runtime.authenticatedAudioPost<unknown>(ROOT + path, body, session, signal, { bypassCache: true }))
      await assertCurrent()
      if (raw.user_id !== session.userId) invalid()
      return raw
    }
    const secret = await this.runtime.stateStore.uniqueCode()
    const envelope = new TimelineTokenCodec(secret, accountKey)
    const seal = (kind: string, payload: Record<string, unknown>) => envelope.seal(JSON.stringify(payload), `voice-trigger-${kind}`)
    const open = (kind: string, ref: unknown) => {
      try { return objectValue(JSON.parse(envelope.open(text(ref, 8192), `voice-trigger-${kind}`))) }
      catch { throw new ArkmePluginError('voice-trigger-ref-invalid', '识别记录引用失效，请刷新后重试', false, 403) }
    }
    const draftStore = this.runtime.stateStore.recordingVoiceDraft
    const draft = async () => draftStore ? draftStore.call(this.runtime.stateStore, accountKey) : { revision: 0, rules: [defaultRecordingVoiceRule()] }
    const capabilities = async () => {
      try {
        const raw = await post('capabilities', {})
        return raw.version === 1 && raw.detector === 'audio-kws' && raw.ready === true
          && ['upload', 'long-recording', 'all-day'].every(kind => Array.isArray(raw.sources) && raw.sources.includes(kind))
      } catch (error) {
        // Network/auth/server failures must remain retryable errors, never a fake empty list.
        if (error instanceof ArkmePluginError && [404, 501].includes(error.upstreamStatus ?? error.httpStatus)) return false
        throw error
      }
    }
    if (action === 'settings') {
      const available = await capabilities(), local = await draft()
      await assertCurrent()
      const cloud = available ? await post('rules/query', {}) : undefined
      return { accountKey, available, revision: cloud ? number(cloud.revision) : 0,
        rules: cloud ? recordingVoiceRules(cloud.rules) : local.rules, draft: local } satisfies RecordingVoiceSettings
    }
    if (action === 'save') {
      const rules = recordingVoiceRules(input.rules), expected = number(input.localRevision)
      const local = await draft()
      if (local.revision !== expected) throw new ArkmePluginError('voice-trigger-rules-conflict', '规则已在其他窗口修改，请重新读取后保存', false, 409)
      const available = await capabilities()
      if (!available) {
        if (!draftStore) throw new ArkmePluginError('voice-trigger-storage-unavailable', '本机配置保存暂不可用，请重试', true, 503)
        await assertCurrent()
        const saved = await draftStore.call(this.runtime.stateStore, accountKey, { revision: expected, rules })
        await assertCurrent()
        return { accountKey, available: false, revision: 0, rules: saved.rules, draft: saved } satisfies RecordingVoiceSettings
      }
      const cloud = await post('rules/set', { expected_revision: number(input.revision), rules })
      return { accountKey, available: true, revision: number(cloud.revision), rules: recordingVoiceRules(cloud.rules), draft: local } satisfies RecordingVoiceSettings
    }
    // Every mutation rechecks advertised support; read-only operations cannot dispatch writes.
    if (!await capabilities()) throw new ArkmePluginError('voice-trigger-backend-pending', '后端接口开发中，开发完成后此功能完整可用。', false, 501)
    const project = (value: unknown): RecordingVoiceCandidate => {
      const raw = objectValue(value), evidence = objectValue(raw.evidence)
      if (!['self', 'unknown', 'other'].includes(String(raw.speaker)) || !['pending', 'saved', 'ignored'].includes(String(raw.status))
        || !['complete', 'open', 'uncertain'].includes(String(raw.boundary)) || evidence.kind !== 'audio-kws'
        || typeof evidence.score !== 'number' || !Number.isFinite(evidence.score) || evidence.score < 0 || evidence.score > 1) invalid()
      const id = text(raw.id), revision = number(raw.revision), start = number(raw.start_at), end = number(raw.end_at)
      if (end <= start || typeof raw.text !== 'string' || raw.text.length > 30_000) invalid()
      return { candidateKey: createHmac('sha256', secret).update(JSON.stringify([accountKey, id])).digest('hex'), candidateRef: seal('candidate', { id, revision }), revision, phrase: text(raw.phrase), text: raw.text,
        startAtMillis: start, endAtMillis: end, speaker: raw.speaker as RecordingVoiceCandidate['speaker'], speakerLabel: text(raw.speaker_label),
        status: raw.status as RecordingVoiceCandidate['status'], boundary: raw.boundary as RecordingVoiceCandidate['boundary'],
        evidence: { kind: 'audio-kws', model: text(evidence.model), score: evidence.score } }
    }
    if (action === 'page') {
      const cursor = input.cursor ? text(open('cursor', input.cursor).cursor, 2048) : undefined
      const page = await post('candidates/query', { limit: 30, order: 'self-first', ...(cursor ? { cursor } : {}) })
      return { items: array(page.items, 30).map(project), ...(page.next_cursor ? { nextCursor: seal('cursor', { cursor: text(page.next_cursor, 2048) }) } : {}) }
    }
    const candidate = open('candidate', input.candidateRef), id = text(candidate.id), revision = number(candidate.revision)
    if (action === 'decide') {
      if (!['save', 'ignore'].includes(String(input.decision))) invalid()
      const result = await post('candidates/decide', { id, expected_revision: revision, decision: input.decision })
      const projected = project(result.candidate)
      if (objectValue(result.candidate).id !== id || projected.status !== (input.decision === 'save' ? 'saved' : 'ignored')) invalid()
      return projected
    }
    const raw = await post('candidates/detail', { id })
    if (raw.id !== id || number(raw.revision) !== revision) throw new ArkmePluginError('voice-trigger-candidate-changed', '这条识别记录已更新，请刷新后再操作', false, 409)
    const items: ArkmeRecordingWorkbenchItem[] = []
    const nearby = new Map<string, ArkmeRecordingWorkbenchItem[]>()
    for (const value of array(raw.anchors, 100)) {
      const anchor = objectValue(value), atMillis = number(anchor.at_millis), dateStamp = number(anchor.date_stamp)
      if (anchor.transcript_source !== 'system' && anchor.transcript_source !== 'doubao') invalid()
      const cacheKey = `${dateStamp}:${anchor.transcript_source}`
      let candidates = nearby.get(cacheKey) ?? []
      if (!candidates.some(item => item.startAtMillis <= atMillis && item.endAtMillis > atMillis)) {
        const page = await this.locate({ atMillis, dateStamp, transcriptSource: anchor.transcript_source }, signal)
        await assertCurrent()
        candidates = page.items
        nearby.set(cacheKey, candidates)
      }
      const matches = candidates.filter(item => item.startAtMillis <= atMillis && item.endAtMillis > atMillis)
      if (matches.length !== 1) throw new ArkmePluginError('voice-trigger-source-not-ready', '原音定位正在更新，请稍后重试', true, 409)
      const item = matches[0]!
      if (!items.some(other => other.itemRef === item.itemRef)) items.push(item)
    }
    if (!items.length) invalid()
    return { items: items.sort((a, b) => a.startAtMillis - b.startAtMillis) }
  }
}
