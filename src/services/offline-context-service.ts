import type { MediaService } from './media-service.js'
import { createHash, randomUUID } from 'node:crypto'
import { EncryptedReferenceCodec } from '../encrypted-reference.js'
import { offlineContextSummaryLines, type OfflineContextEntry } from '../offline-context.js'
import type { OfflineContextCommand, OfflineContextCommandResult, OfflineContextPort, OfflineContextRequest, OfflineContextJournalEntry } from '../offline-context-contract.js'
import { TimelineTokenCodec } from './timeline-token.js'
import { recordOwnerId, type RecordOwnerId } from '../record-owner-id.js'
import type { SourceService } from './source-service.js'
import { ArkmePluginError, ArkmeUpstreamResponseError, objectValue, type ServiceRuntime } from './service.js'

const ROOT = '/api/v1/chats/offline-context/'
const JOURNAL = 'arkme-offline-context-journal-v1'
const invalid = () => new ArkmePluginError('offline-context-invalid', '上下文数据无效，请刷新后重试', false, 409)
function text(value: unknown, max = 200): string {
  if (typeof value !== 'string' || !value || value.length > max) throw invalid()
  return value
}
function number(value: unknown, zero = false): number {
  if (!Number.isSafeInteger(value) || Number(value) < (zero ? 0 : 1)) throw invalid()
  return Number(value)
}
function revision(value: unknown): number {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/u.test(value)) throw invalid()
  return number(Number(value))
}
function messageOwner(value: unknown): RecordOwnerId {
  const owner = recordOwnerId(value)
  if (!owner) throw invalid()
  return owner
}
const fingerprint = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')

/** One owner for UI, SDK and Tools. Backend identifiers and preview credentials
 * stay inside environment/account-bound authenticated envelopes. */
export class OfflineContextService implements OfflineContextPort {
  private epoch = 0
  private disposed = false
  private capabilityCache?: { scope: string; expires: number; supported: boolean }
  private readonly unsubscribe: () => void
  private readonly journalCodec: EncryptedReferenceCodec
  constructor(private readonly runtime: ServiceRuntime, private readonly sources: Pick<SourceService, 'openSourceRef' | 'sealSourceRef'>, private readonly media?: Pick<MediaService, 'issueContextPlayback'>, private readonly invalidateProjection?: (userId: number) => Promise<void>) {
    this.unsubscribe = runtime.subscribeAccountScope(() => { this.epoch++ })
    this.journalCodec = new EncryptedReferenceCodec(() => runtime.stateStore.uniqueCode(), invalid, 1024 * 1024)
  }
  dispose(): void { this.disposed = true; this.epoch++; this.unsubscribe() }

  async timelineReference(id: string, chat: string, kind: 'private_chat' | 'group_chat', name: string): Promise<string> {
    const session = await this.runtime.requireSession()
    const codec = new TimelineTokenCodec(await this.runtime.stateStore.uniqueCode(), `offline-context:${this.runtime.config.environment}:${session.userId}`)
    return codec.seal(JSON.stringify({ id: text(id), chat: text(chat), kind, name }), 'entry')
  }
  async timelineAnchor(ref: string, chat: string): Promise<string> {
    const session = await this.runtime.requireSession()
    const codec = new TimelineTokenCodec(await this.runtime.stateStore.uniqueCode(), `offline-context:${this.runtime.config.environment}:${session.userId}`)
    const identity = objectValue(JSON.parse(codec.open(text(ref, 32768), 'entry')))
    if (identity.chat !== chat) throw invalid()
    return text(identity.id)
  }

  async messageReference(chat: string, relation: string, record: string, owner: RecordOwnerId): Promise<string> {
    const session = await this.runtime.requireSession()
    const codec = new TimelineTokenCodec(await this.runtime.stateStore.uniqueCode(), `offline-context:${this.runtime.config.environment}:${session.userId}`)
    return codec.seal(JSON.stringify({ chat: text(chat), relation: text(relation), record: text(record), owner: messageOwner(owner) }), 'message')
  }
  async messageAnchor(ref: string, chat: string): Promise<{ record_uid: string; record_owner_user_id: RecordOwnerId }> {
    const session = await this.runtime.requireSession()
    const codec = new TimelineTokenCodec(await this.runtime.stateStore.uniqueCode(), `offline-context:${this.runtime.config.environment}:${session.userId}`)
    const identity = objectValue(JSON.parse(codec.open(text(ref, 32768), 'message')))
    if (identity.chat !== chat) throw invalid()
    return { record_uid: text(identity.record), record_owner_user_id: messageOwner(identity.owner) }
  }

  async offlineContext(input: OfflineContextRequest, signal?: AbortSignal): ReturnType<OfflineContextPort['offlineContext']> {
    const session = await this.runtime.requireSession(), epoch = this.epoch
    const scope = `${this.runtime.config.environment}:${session.userId}`
    const codec = new TimelineTokenCodec(await this.runtime.stateStore.uniqueCode(), `offline-context:${scope}`)
    const current = async () => {
      signal?.throwIfAborted()
      const now = await this.runtime.requireSession()
      if (this.disposed || epoch !== this.epoch || now.userId !== session.userId || now.refreshToken !== session.refreshToken) throw new ArkmePluginError('offline-context-account-changed', '账号已变化，请重新读取', false, 409)
    }
    const open = (ref: string, purpose: string) => objectValue(JSON.parse(codec.open(text(ref, 32768), purpose)))
    const seal = (data: unknown, purpose: string) => codec.seal(JSON.stringify(data), purpose)
    const post = async (path: string, body: Record<string, unknown>, write = false) => {
      await current()
      const raw = await this.runtime.authenticatedChatPost<unknown>(ROOT + path, body, session, signal, { lane: write ? 'write' : 'interactive-read', bypassCache: true })
      await current()
      return objectValue(raw)
    }
    let capability = this.capabilityCache
    if (!capability || capability.scope !== scope || capability.expires <= Date.now()) {
      const raw = await post('capability', {})
      capability = { scope, expires: Date.now() + 30000, supported: raw.supported === true && raw.version === 1 && raw.timeline_version === 2 }
      this.capabilityCache = capability
    }
    await current()
    if (input.operation === 'capability') return { supported: capability.supported, version: 1 }
    if (!capability.supported) throw new ArkmePluginError('offline-context-unsupported', '当前服务尚不支持线下交流关联', false, 409)
    if (input.operation === 'coverage') {
      const source = await this.sources.openSourceRef(input.sourceRef, session.userId)
      if (source.kind !== 'private_chat' && source.kind !== 'group_chat') throw invalid()
      const raw = await post('coverage', { chat_session_uid: source.ownerRef })
      if (!Array.isArray(raw.observations) || raw.observations.length > 32) throw invalid()
      return { observations: raw.observations.map(value => {
        const scan = objectValue(value)
        if (typeof scan.complete !== 'boolean' || typeof scan.evidence_seen !== 'boolean' || typeof scan.messages_seen !== 'boolean') throw invalid()
        return { startAtMillis: number(scan.start_at), endAtMillis: number(scan.end_at), observedAtMillis: number(scan.updated_at), complete: scan.complete, evidenceSeen: scan.evidence_seen, messagesSeen: scan.messages_seen, matches: number(scan.matches, true), issues: Object.keys(objectValue(scan.issues)).slice(0, 32) }
      }) }
    }
    const journal = async () => {
      if (!this.runtime.stateStore.readOfflineContextJournal || !this.runtime.stateStore.putOfflineContextJournal || !this.runtime.stateStore.deleteOfflineContextJournal) throw new ArkmePluginError('offline-context-storage-unavailable', '操作恢复存储暂时不可用', true, 503)
      return this.runtime.stateStore.readOfflineContextJournal(scope)
    }
    const save = async (id: string, value: unknown, fp: string, expiresAtMillis?: number) => {
      await journal()
      const sealed = await this.journalCodec.seal(JOURNAL, { scope, value })
      await this.runtime.stateStore.putOfflineContextJournal!(scope, id, { fingerprint: fp, sealed, ...(expiresAtMillis === undefined ? {} : { expiresAtMillis }) })
    }
    const readJournal = async (entry: OfflineContextJournalEntry) => {
      const raw = await this.journalCodec.open(JOURNAL, entry.sealed)
      if (raw.scope !== scope) throw invalid()
      return objectValue(raw.value)
    }
    const receipt = (raw: Record<string, unknown>, requestId: string): OfflineContextCommandResult => {
      if (!['applied', 'not_applied', 'pending', 'unknown'].includes(String(raw.outcome)) || raw.request_id !== requestId) throw invalid()
      return { requestId, outcome: raw.outcome as OfflineContextCommandResult['outcome'], ...(Number(raw.revision) > 0 ? { revision: String(number(raw.revision)) } : {}) }
    }
    const result = async (entryRef: string, requestId: string) => {
      const identity = open(entryRef, 'entry')
      const raw = await post('result', { association_id: text(identity.id), request_id: text(requestId) })
      const parsed = receipt(raw, requestId)
      if (parsed.outcome === 'applied' || parsed.outcome === 'not_applied') {
        const saved = (await journal())[`command:${requestId}`]
        if (saved) {
          await this.runtime.stateStore.deleteOfflineContextJournal!(scope, `command:${requestId}`, saved.fingerprint)
          if (parsed.outcome === 'applied') await this.invalidateProjection?.(session.userId)
        }
      }
      return parsed
    }
    const project = async (raw: Record<string, unknown>, sourceRef: string, name: string, kind: 'private_chat' | 'group_chat'): Promise<OfflineContextEntry> => {
      const id = text(raw.id), chat = text(raw.chat_session_uid), rev = String(number(raw.revision))
      if (!['suggested', 'linked', 'dismissed'].includes(String(raw.state))) throw invalid()
      const available = raw.availability === undefined || raw.availability === 'available'
      const evidence = available ? raw.evidence : []
      const messages = available ? raw.messages : []
      if (!Array.isArray(evidence) || evidence.length > 150 || !Array.isArray(messages) || messages.length > 40) throw invalid()
      const entry: OfflineContextEntry = { id: seal({ id, chat, kind, name }, 'entry'), revision: rev, conversationKey: sourceRef, conversationName: name, conversationKind: kind,
        startAtMillis: number(raw.occurred_start), endAtMillis: number(raw.occurred_end), title: available ? String(raw.title ?? '') : '', summary: available && raw.summary ? offlineContextSummaryLines(text(raw.summary, 16000)) : [],
        hasSharedSnapshot: raw.shared_message != null, participants: [], reason: available ? String(raw.reason ?? '') : '', state: raw.state as OfflineContextEntry['state'], visibility: 'private', sourceState: available ? 'available' : 'unavailable',
        evidence: [], messages: [], selectedEvidenceIds: [] }
      for (const value of evidence) {
        const e = objectValue(value), from = number(e.from, true), to = number(e.to), rawText = typeof e.text === 'string' ? e.text : ''
        const points = Array.from(rawText)
        if (to <= from || to > points.length || !['unknown', 'in_person', 'playback'].includes(String(e.sound_source))) throw invalid()
        const ref = seal({ association: id, evidence_id: text(e.id), version: text(e.version), from, to }, 'evidence')
        entry.evidence.push({ id: ref, startAtMillis: number(e.occurred_start), endAtMillis: number(e.occurred_end), speaker: '说话人', text: points.slice(from, to).join(''), soundSource: e.contains_playback ? 'playback' : e.sound_source as 'unknown' | 'in_person' | 'playback', transcriptRef: seal({ id, chat, evidence: text(e.id), version: text(e.version), from, to }, 'transcript'), ...(this.media ? { playbackRef: seal({ id, chat, evidence: text(e.id), version: text(e.version), from, to }, 'playback') } : {}) })
        entry.selectedEvidenceIds.push(ref)
      }
      for (const value of messages) {
        const m = objectValue(value)
        entry.messages.push({ messageRef: seal({ chat: text(m.chat_session_uid), relation: text(m.relation_uid), record: text(m.record_uid), owner: messageOwner(m.record_owner) }, 'message'), label: '关联消息', excerpt: typeof m.quote === 'string' ? m.quote : '', occurredAtMillis: number(m.occurred_at) })
      }
      return entry
    }
    if (input.operation === 'list') {
      const source = await this.sources.openSourceRef(input.sourceRef, session.userId)
      if (source.kind !== 'private_chat' && source.kind !== 'group_chat') throw invalid()
      const state = input.state ?? 'suggested'
      if (!['suggested', 'linked', 'dismissed'].includes(state)) throw invalid()
      if (input.messageRefs !== undefined && (!Array.isArray(input.messageRefs) || input.messageRefs.length < 1 || input.messageRefs.length > 100)) throw invalid()
      const relations = input.messageRefs?.map(ref => {
        const message = open(ref, 'message')
        if (message.chat !== source.ownerRef) throw invalid()
        return text(message.relation)
      }).sort()
      const filter = relations ? fingerprint(relations) : undefined
      const cursor = input.cursor ? open(input.cursor, 'page') : undefined
      if (cursor && (cursor.chat !== source.ownerRef || cursor.state !== state || cursor.filter !== filter)) throw invalid()
      const raw = await post('list', { chat_session_uid: source.ownerRef, state, limit: 20, descending: true, ...(relations ? { message_uids: relations } : {}), ...(cursor ? { after: cursor.after } : {}) })
      if (!Array.isArray(raw.items) || raw.items.length > 20 || typeof raw.has_more !== 'boolean') throw invalid()
      const entries = await Promise.all(raw.items.map(v => project(objectValue(v), input.sourceRef, source.displayName, source.kind as 'private_chat' | 'group_chat')))
      await current()
      return { entries, hasMore: raw.has_more, ...(raw.has_more ? { nextCursor: seal({ chat: source.ownerRef, state, ...(filter ? { filter } : {}), after: raw.next }, 'page') } : {}) }
    }
    if (input.operation === 'range-options') {
      const identity = open(input.entryRef, 'entry')
      const raw = await post('range-options', { association_id: text(identity.id), expected_revision: revision(input.revision) })
      if (String(raw.revision) !== input.revision || !Array.isArray(raw.evidence) || raw.evidence.length < 1 || raw.evidence.length > 150) throw invalid()
      if (!Array.isArray(raw.selected_evidence_ids) || raw.selected_evidence_ids.length > raw.evidence.length) throw invalid()
      const selected = raw.selected_evidence_ids.map(value => text(value))
      if (new Set(selected).size !== selected.length) throw invalid()
      const selectedEvidenceIds: string[] = []
      const evidence = raw.evidence.map(value => {
        const e = objectValue(value), rawText = text(e.text, 192000), from = number(e.from, true), to = number(e.to)
        if (to <= from || to > Array.from(rawText).length || !['unknown', 'in_person'].includes(String(e.sound_source)) || e.contains_playback) throw invalid()
        const id = seal({ association: text(identity.id), evidence_id: text(e.id), version: text(e.version), from, to }, 'evidence')
        if (selected.includes(text(e.id))) selectedEvidenceIds.push(id)
        return { id, text: Array.from(rawText).slice(from,to).join(''), startAtMillis: number(e.occurred_start), endAtMillis: number(e.occurred_end), speaker: '说话人', soundSource: e.sound_source as 'unknown' | 'in_person' }
      })
      if (selectedEvidenceIds.length !== selected.length) throw invalid()
      return { revision: input.revision, evidence, selectedEvidenceIds }
    }
    if (input.operation === 'read') {
      const identity = open(input.entryRef, 'entry')
      const raw = await post('read', { association_id: text(identity.id) })
      if (raw.chat_session_uid !== identity.chat) throw invalid()
      // The source reference itself carries no permission. Source and detail
      // reads are still authorized again by Chat on every request.
      if(identity.kind!=='private_chat' && identity.kind!=='group_chat')throw invalid()
      const name=typeof identity.name==='string'?identity.name:'关联会话'
      const sourceRef = await this.sources.sealSourceRef(session.userId, identity.kind, text(identity.chat), name)
      return project(raw, sourceRef, name, identity.kind)
    }
    if (input.operation === 'playback') {
      const identity = open(input.playbackRef, 'playback')
      const raw = await post('read', { association_id: text(identity.id) })
      if (!this.media || raw.chat_session_uid !== identity.chat || raw.availability && raw.availability !== 'available' || !Array.isArray(raw.evidence)) throw invalid()
      const e = raw.evidence.map(objectValue).find(e => e.id === identity.evidence)
      if (!e || e.version !== identity.version || e.from !== identity.from || e.to !== identity.to) throw invalid()
      const media = objectValue(e.media)
      const result = await this.media.issueContextPlayback({ session_id: text(media.session_id), child_id: text(media.child_id), evidence_id: text(e.id), version: text(e.version), ordinal: number(e.ordinal, true), from: number(e.from, true), to: number(e.to) }, signal)
      await current()
      return result
    }
    if (input.operation === 'transcript') {
      const identity = open(input.transcriptRef, 'transcript')
      const raw = await post('read', { association_id: text(identity.id) })
      if (raw.chat_session_uid !== identity.chat || raw.availability && raw.availability !== 'available' || !Array.isArray(raw.evidence)) throw invalid()
      const evidence = raw.evidence.map(objectValue).find(e => e.id === identity.evidence)
      if (!evidence || evidence.version !== identity.version || evidence.from !== identity.from || evidence.to !== identity.to || typeof evidence.text !== 'string') throw invalid()
      return { text: evidence.text, from: number(evidence.from, true), to: number(evidence.to), startAtMillis: number(evidence.occurred_start), endAtMillis: number(evidence.occurred_end) }
    }
    if (input.operation === 'preview') {
      const identity = open(input.entryRef, 'entry')
      if (typeof input.includeTranscript !== 'boolean') throw invalid()
      const raw = await post('preview', { association_id: text(identity.id), expected_revision: revision(input.revision), include_transcript: input.includeTranscript })
      const body = objectValue(raw.body), expires = number(raw.expires_at), token = text(raw.token, 400 * 1024), id = randomUUID()
      if (!Array.isArray(body.transcript ?? []) || (body.transcript as unknown[] | undefined)?.some(v => typeof v !== 'string')) throw invalid()
      await save(`preview:${id}`, { token, entryRef: input.entryRef, revision: input.revision }, fingerprint(token), expires)
      await current()
      return { previewRef: seal({ id }, 'preview'), title: text(body.title, 400), summary: text(body.summary, 16000), transcript: (body.transcript ?? []) as string[], expiresAtMillis: expires }
    }
    if (input.operation === 'result') return result(input.entryRef, input.requestId)
    if (input.operation === 'pending') {
      const pending = await journal(), values: OfflineContextCommandResult[] = []
      for (const [key, stored] of Object.entries(pending)) {
        if (!key.startsWith('command:')) continue
        const value = await readJournal(stored)
        values.push({ ...await result(text(value.entryRef, 32768), text(value.requestId)), entryRef: text(value.entryRef, 32768) })
      }
      return values
    }
    if (input.operation !== 'command') throw invalid()
    const cmd: OfflineContextCommand = input.command
    const requestId = text(cmd.requestId), identity = open(cmd.entryRef, 'entry'), expected = revision(cmd.revision)
    const pending = await journal(), key = `command:${requestId}`, fp = fingerprint(cmd)
    // Recovery is a write command, never a side effect of read/result/pending.
    // Reuse the exact encrypted payload and request ID; a new preview or current
    // revision would turn a transport retry into a different user action.
    if (pending[key]) {
      if (cmd.action !== 'retry' && pending[key].fingerprint !== fp) throw invalid()
      const saved = await readJournal(pending[key])
      if (saved.entryRef !== cmd.entryRef || saved.requestId !== requestId) throw invalid()
      const observed = await result(cmd.entryRef, requestId)
      if (observed.outcome !== 'unknown') return observed
      const route = text(saved.route), body = objectValue(saved.body)
      if (!['apply', 'share', 'withdraw'].includes(route) || body.request_id !== requestId) throw invalid()
      try {
        const replayed = receipt(await post(route, body, true), requestId)
        if (replayed.outcome === 'applied' || replayed.outcome === 'not_applied') {
          await this.runtime.stateStore.deleteOfflineContextJournal!(scope, key, pending[key].fingerprint)
        }
        await this.invalidateProjection?.(session.userId)
        return replayed
      } catch {
        await current()
        // A retired server receipt plus a newer revision cannot establish that
        // the original write never happened. Keep this uncertainty explicit.
        return { requestId, outcome: 'unknown' }
      }
    }
    if (cmd.action === 'retry') return result(cmd.entryRef, requestId)
    let route = 'apply'
    const body: Record<string, unknown> = { association_id: text(identity.id), request_id: requestId, expected_revision: expected, action: cmd.action }
    switch (cmd.action) {
      case 'confirm': case 'restore': break
      case 'withdraw': route = 'withdraw'; delete body.action; break
      case 'dismiss': if (!['unrelated', 'playback', 'remove'].includes(cmd.reason)) throw invalid(); body.reason = cmd.reason; break
      case 'range':
        if (!Array.isArray(cmd.evidenceRefs) || !cmd.evidenceRefs.length || cmd.evidenceRefs.length > 150) throw invalid()
        body.selections = cmd.evidenceRefs.map((ref, index) => {
          const e = open(ref, 'evidence'); if (e.association !== identity.id) throw invalid()
          const base = number(e.from, true), bound = number(e.to)
          const from = index === 0 && cmd.startOffset !== undefined ? base + number(cmd.startOffset, true) : base
          const to = index === cmd.evidenceRefs.length - 1 && cmd.endOffset !== undefined ? base + number(cmd.endOffset) : bound
          if (from < base || to > bound || from >= to) throw invalid()
          return { evidence_id: text(e.evidence_id), version: text(e.version), from, to }
        })
        break
      case 'relink': { const m = open(cmd.messageRef, 'message'); body.chat_session_uid = text(m.chat); body.message_uids = [text(m.relation)]; break }
      case 'share': {
        const ref = open(cmd.previewRef, 'preview'), saved = pending[`preview:${text(ref.id)}`]
        if (!saved || !saved.expiresAtMillis || saved.expiresAtMillis < Date.now()) throw invalid()
        const preview = await readJournal(saved)
        if (preview.entryRef !== cmd.entryRef || preview.revision !== cmd.revision) throw invalid()
        route = 'share'
        for (const field of Object.keys(body)) delete body[field]
        body.preview_token = text(preview.token, 400 * 1024); body.request_id = requestId
        break
      }
      default: throw invalid()
    }
    await save(key, { entryRef: cmd.entryRef, requestId, route, body }, fp)
    await current()
    let parsed: OfflineContextCommandResult
    try { parsed = receipt(await post(route, body, true), requestId) }
    catch (error) {
      await current()
      const reason = error instanceof ArkmeUpstreamResponseError ? objectValue(error.responseData).reason : undefined
      if (['invalid_request', 'access_denied', 'source_unavailable', 'revision_conflict', 'request_conflict'].includes(String(reason))) parsed = { requestId, outcome: 'not_applied' }
      else { await this.invalidateProjection?.(session.userId); return { requestId, outcome: 'unknown' } }
    }
    if (parsed.outcome === 'applied' || parsed.outcome === 'not_applied') await this.runtime.stateStore.deleteOfflineContextJournal!(scope, key, fp)
    // Host owns the commit invalidation, including writes started from Tools or
    // a card that has since unmounted. An old in-flight read cannot cover it.
    await this.invalidateProjection?.(session.userId)
    return parsed
  }
}
