import { createHash } from 'node:crypto'
import { ArkmePluginError, type ServiceRuntime } from './service.js'
import { readUnderlineSnapshot, underlineId } from '../message-annotations.js'
import { readMessageQuote } from '../message-quote.js'
import type { NativeAnnotationRequest, NativeAnnotationTarget, NativeAnnotationContext, NativeAnnotationSnapshot, NativeAnnotationCapabilities } from '../native-annotations.js'
import type { DshRemoteHistoryEntry } from '../dsh-remote/dsh-event-contract.js'

const base = '/api/v1/dsh-remote'
const invalid = () => new ArkmePluginError('native-annotation-invalid', '标记目标无效，请重新选择', false, 400)
export type NativeAnnotationSource = (target: NativeAnnotationTarget, signal: AbortSignal) => Promise<{ runtimeRef: string; hostGeneration: number; entry: DshRemoteHistoryEntry; canonical: string }>

/** All consumers share source verification, permission, persistent retries and error semantics. */
export class NativeAnnotationsService {
  source?: NativeAnnotationSource
  sourceRuntime: (() => string | undefined) | undefined
  private flights = new Map<string, Promise<unknown>>()
  private contexts = new Map<string, NativeAnnotationContext>()
  constructor(private runtime: ServiceRuntime) {}
  async execute(request: NativeAnnotationRequest, signal?: AbortSignal): Promise<unknown> {
    if (!request || typeof request !== 'object') throw invalid()
    const session = await this.runtime.requireSession()
    const scope = JSON.stringify([this.runtime.config.environment, session.userId])
    const cache = this.runtime.stateStore.messageMarks
    const offline = (error: unknown) => error instanceof ArkmePluginError && error.retryable && !/401|403|account|permission/u.test(error.code)
    const scopedSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000)
    const assertAccount = async () => {
      scopedSignal.throwIfAborted()
      const current = await this.runtime.accountScopedSession()
      if (!current || current.userId !== session.userId || current.refreshToken !== session.refreshToken) throw new ArkmePluginError('native-annotation-account-changed', '账号已变化，请重新打开会话', false, 403)
    }
    const post = async <T>(path: string, body: Record<string, unknown>): Promise<T> => {
      await assertAccount()
      try {
        const result = await this.runtime.authenticatedDshRemotePost<T>(`${base}/${path}`, body, session, scopedSignal)
        await assertAccount(); return result
      } catch (error) {
        if (error instanceof ArkmePluginError && error.code === 'REMOTE_NOT_FOUND') throw new ArkmePluginError('native-annotation-permission-lost', '来源消息已不可访问', false, 403)
        if (error instanceof ArkmePluginError && error.code === 'REMOTE_STORAGE_FAILED') throw new ArkmePluginError(error.code, '标记服务暂不可用，待同步操作已保留', true, 503)
        if (error instanceof ArkmePluginError && error.code === 'ANNOTATION_SOURCE_NOT_READY') throw new ArkmePluginError(error.code, '来源文字尚未同步，请先在来源电脑打开该消息', true, 409)
        throw error
      }
    }
    const snapshot = (raw: unknown): NativeAnnotationSnapshot => {
      const value = raw as { message_ref?: unknown }
      if (typeof value?.message_ref !== 'string') throw invalid()
      return { ...readUnderlineSnapshot(raw, session.userId), messageRef: value.message_ref }
    }
    switch (request.action) {
      case 'capabilities': {
        type Cap = { protocol_version?: number; enabled?: boolean; max_length?: number; refresh_millis?: number }
        let value: Cap
        try { value = await post<Cap>('annotations/capabilities', {}); cache?.writeCloudCache(scope, 'capabilities', value) }
        catch (error) {
          if (error instanceof ArkmePluginError && [404, 405].includes(error.upstreamStatus ?? 0)) return { supported: false, protocolVersion: 1, maxLength: 2000, refreshMillis: 15000 } satisfies NativeAnnotationCapabilities
          const cached = cache?.readCloudCache<Cap>(scope, 'capabilities'); if (!cached || !offline(error)) throw error; await assertAccount(); value = cached
        }
        return { supported: value.protocol_version === 1 && value.enabled === true, protocolVersion: 1, maxLength: Math.min(2000, Number(value.max_length) || 0), refreshMillis: Math.max(15000, Number(value.refresh_millis) || 15000) } satisfies NativeAnnotationCapabilities
      }
      case 'contexts': {
        if (!Array.isArray(request.targets) || !request.targets.length || request.targets.length > 40) throw invalid()
        const values: NativeAnnotationContext[] = []
        for (const target of request.targets) {
          if (!target || !Number.isSafeInteger(target.eventSeq) || target.eventSeq < 0 || !['user', 'assistant'].includes(target.role) || !underlineId(target.sessionRef) || target.runtimeRef !== undefined && !underlineId(target.runtimeRef)) throw invalid()
          const runtimeKey = target.runtimeRef ?? this.sourceRuntime?.()
          const key = JSON.stringify([scope, target, runtimeKey])
          const cached = this.contexts.get(key) ?? cache?.readCloudCache<NativeAnnotationContext>(scope, `context:${JSON.stringify([target, runtimeKey])}`)
          let raw: Record<string, unknown>
          if (target.runtimeRef === undefined) {
            if (!this.source) throw new ArkmePluginError('native-annotation-source-not-ready', '来源电脑尚未准备好文字标记同步', true, 503)
            const source = await this.source(target, scopedSignal).catch((error: unknown) => {
              const code = (error as { code?: string })?.code
              if (code === 'CAPABILITY_UNSUPPORTED') throw new ArkmePluginError('native-annotation-source-not-ready', '来源消息暂不支持云标记；已有本机标记仍保留', true, 503)
              if (code === 'SESSION_NOT_FOUND' || code === 'REMOTE_NOT_FOUND') throw new ArkmePluginError('native-annotation-permission-lost', '来源消息已不可访问', false, 403)
              throw error
            })
            if (source.entry.event.seq !== target.eventSeq) throw invalid()
            try { raw = await post<Record<string, unknown>>('annotations/source-context', { runtime_ref: source.runtimeRef, host_generation: source.hostGeneration, session_ref: target.sessionRef, entry: source.entry, canonical_text: source.canonical, projection: 'dsh-selection-v1' }) }
            catch (error) {
              if (!cached || !offline(error) || cached.runtimeRef !== source.runtimeRef || cached.canonicalText !== source.canonical) throw error
              await assertAccount(); values.push(cached); continue
            }
          } else {
            try {
              const response = await post<{ items: Record<string, unknown>[] }>('messages/selection-context', { targets: [{ runtime_ref: target.runtimeRef, session_ref: target.sessionRef, event_seq: target.eventSeq, role: target.role }] })
              if (response.items?.length !== 1) throw invalid()
              raw = response.items[0]!
            } catch (error) {
              if (!cached || !offline(error)) throw error
              await assertAccount(); values.push(cached); continue
            }
          }
          if (raw.projection !== 'dsh-selection-v1' || typeof raw.message_ref !== 'string' || typeof raw.canonical_text !== 'string' || typeof raw.source_digest !== 'string' || raw.event_seq !== target.eventSeq || raw.role !== target.role || raw.session_ref !== target.sessionRef || typeof raw.runtime_ref !== 'string') throw invalid()
          const context: NativeAnnotationContext = { ...target, runtimeRef: raw.runtime_ref, messageRef: raw.message_ref, canonicalText: raw.canonical_text, sourceDigest: raw.source_digest }
          if (this.contexts.size >= 500) this.contexts.delete(this.contexts.keys().next().value!)
          cache?.writeCloudCache(scope, `context:${JSON.stringify([target, runtimeKey])}`, context)
          this.contexts.set(key, context); values.push(context)
        }
        return values
      }
      case 'list': {
        if (!Array.isArray(request.messageRefs) || !request.messageRefs.length || request.messageRefs.length > 40) throw invalid()
        try {
          await this.resume(scope, request.messageRefs, post)
          const value = await post<{ items: unknown[] }>('annotations/list', { message_refs: request.messageRefs })
          if (!Array.isArray(value.items) || value.items.length !== request.messageRefs.length) throw invalid()
          const rows = value.items.map(snapshot)
          for (const row of rows) cache?.writeCloudCache(scope, `snapshot:${row.messageRef}`, row)
          return rows
        } catch (error) {
          const rows = request.messageRefs.map(ref => cache?.readCloudCache<NativeAnnotationSnapshot>(scope, `snapshot:${ref}`))
          if (!offline(error) || rows.some(row => !row)) throw error
          await assertAccount(); return rows.map(row => ({ ...row!, syncState: 'cached', syncNotice: '离线缓存，尚未确认其他设备的最新标记' }))
        }
      }
      case 'changes': {
        if (!Array.isArray(request.watches) || !request.watches.length || request.watches.length > 40 || request.watches.some(w => !Number.isSafeInteger(w.revision) || w.revision < 0)) throw invalid()
        try {
          await this.resume(scope, request.watches.map(w => w.messageRef), post)
          const value = await post<{ items: unknown[]; complete?: boolean }>('annotations/changes', { watches: request.watches.map(w => ({ message_ref: w.messageRef, revision: w.revision })) })
          if (!value.complete || !Array.isArray(value.items)) throw invalid()
          const rows = value.items.map(snapshot); for (const row of rows) cache?.writeCloudCache(scope, `snapshot:${row.messageRef}`, row); return rows
        } catch (error) { if (!offline(error)) throw error; return await this.execute({ action: 'list', messageRefs: request.watches.map(w => w.messageRef) }, signal) }
      }
      case 'add': case 'remove': {
        if (!underlineId(request.operationId) || !/^dsha_[a-f0-9]{64}$/u.test(request.messageRef) || (request.action === 'add' ? !readMessageQuote(request.anchor) : !underlineId(request.annotationId))) throw invalid()
        const body = { message_ref: request.messageRef, operation_id: request.operationId, ...(request.action === 'add' ? { anchor: request.anchor } : { annotation_id: request.annotationId }) }
        const path = request.action === 'add' ? 'annotations/create' : 'annotations/remove'
        const key = createHash('sha256').update(JSON.stringify([scope, request.messageRef, request.operationId])).digest('hex')
        const marks = this.runtime.stateStore.messageMarks
        if (!marks) throw new ArkmePluginError('native-annotation-storage-unavailable', '同步队列暂不可用，标记未保存', true, 503)
        await this.resume(scope, [request.messageRef], post)
        marks.stageCloudOperation(scope, key, { path, body })
        const raw = await this.submit(scope, key, { path, body }, post)
        const value = snapshot(raw); cache?.writeCloudCache(scope, `snapshot:${value.messageRef}`, value)
        return value
      }
      default: throw invalid()
    }
  }
  private async submit(scope: string, key: string, operation: { path: string; body: Record<string, unknown> }, post: <T>(path: string, body: Record<string, unknown>) => Promise<T>) {
    const active = this.flights.get(key); if (active) return active
    const flight = post(operation.path, operation.body).then(value => { this.runtime.stateStore.messageMarks!.completeCloudOperation(scope, key); return value }).catch(error => {
      // A definitive rejection has no remote effect. Unknown outcomes keep their original key.
      if (error instanceof ArkmePluginError && !error.retryable && !error.writeOutcomeUnknown) {
        this.runtime.stateStore.messageMarks!.completeCloudOperation(scope, key)
        throw error
      }
      throw new ArkmePluginError('native-annotation-pending', `${error instanceof Error ? error.message : '同步结果未确认'}；标记操作已保留，尚未确认同步`, true, 503, { cause: error, writeOutcomeUnknown: true })
    })
    this.flights.set(key, flight)
    try { return await flight } finally { if (this.flights.get(key) === flight) this.flights.delete(key) }
  }
  private async resume(scope: string, refs: string[], post: <T>(path: string, body: Record<string, unknown>) => Promise<T>) {
    const pending = this.runtime.stateStore.messageMarks?.cloudOperations(scope) ?? []
    for (const operation of pending.filter(item => refs.includes(String(item.value.body.message_ref))).slice(0, 20)) {
      // Server receipts are retained with the document, so replay remains safe after long offline periods.
      await this.submit(scope, operation.key, operation.value, post)
    }
  }
}
