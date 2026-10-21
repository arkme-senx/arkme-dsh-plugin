import { createHash } from 'node:crypto'
import { EncryptedReferenceCodec } from '../encrypted-reference.js'
import { underlineId, type MessageUnderlineChange } from '../message-annotations.js'
import { MESSAGE_QUOTE_LIMIT, quoteCanonicalText, quoteMatchesCanonical, quoteSourceContent, readMessageQuote } from '../message-quote.js'
import type { ArkmeArkoHistoryItem } from '../types.js'
import { ArkmePluginError, type ServiceRuntime } from './service.js'

const PREFIX = 'arkme-arko-local-mark-v1'
const invalid = () => new ArkmePluginError('arko-local-mark-invalid', '消息标记引用无效，请重新打开消息', false, 403)
const terminal = new Set(['completed', 'partial', 'cancelled', 'expired'])

/** Arko authority stays separate from Chat/Record; only the private SQLite store is shared. */
export class ArkoLocalMarks {
  private readonly codec: EncryptedReferenceCodec
  constructor(private readonly runtime: ServiceRuntime) {
    // A completed Markdown reply can exceed the default small-reference limit.
    this.codec = new EncryptedReferenceCodec(() => runtime.stateStore.uniqueCode(), invalid, 1_048_576)
  }

  async project(item: ArkmeArkoHistoryItem, userId: number): Promise<string | undefined> {
    if (!this.runtime.stateStore.messageMarks || item.status !== 1 || !item.text.trim()
      || !Number.isSafeInteger(item.sessionId) || item.sessionId <= 0
      || !Number.isSafeInteger(item.messageId) || item.messageId <= 0
      || item.role === 'assistant' && item.runStatus !== undefined && !terminal.has(item.runStatus)) return undefined
    const content = { title: '', textContent: item.text, textFormat: item.role === 'assistant' ? 'markdown' as const : 'plain' as const }
    const canonical = quoteCanonicalText(content)
    if (Buffer.byteLength(canonical, 'utf8') > 700_000) return undefined
    return this.codec.seal(PREFIX, { environment: this.runtime.config.environment, userId,
      sessionId: item.sessionId, messageId: item.messageId,
      digest: createHash('sha256').update(quoteSourceContent(content)).digest('hex'), canonical })
  }

  private async context(sourceRef: string, signal?: AbortSignal) {
    const session = await this.runtime.requireSession()
    if (sourceRef !== `arko:${this.runtime.config.environment}:${session.userId}`) throw invalid()
    const store = this.runtime.stateStore.messageMarks
    if (!store) throw new ArkmePluginError('arko-local-mark-storage-unavailable', '本机标记存储暂不可用，请重试', true, 503)
    const assertAccount = async () => {
      signal?.throwIfAborted()
      const current = await this.runtime.accountScopedSession()
      if (!current || current.userId !== session.userId || current.refreshToken !== session.refreshToken) {
        throw new ArkmePluginError('arko-local-mark-account-changed', '账号已变化，请重新打开 Arko', false, 403)
      }
    }
    const resolve = async (ref: string) => {
      const target = await this.codec.open(PREFIX, ref)
      if (target.environment !== this.runtime.config.environment || target.userId !== session.userId
        || !Number.isSafeInteger(target.sessionId) || Number(target.sessionId) <= 0
        || !Number.isSafeInteger(target.messageId) || Number(target.messageId) <= 0
        || typeof target.digest !== 'string' || !/^[a-f0-9]{64}$/u.test(target.digest)
        || typeof target.canonical !== 'string') throw invalid()
      return { scope: JSON.stringify([this.runtime.config.environment, session.userId, 'arko', target.sessionId]),
        key: String(target.messageId), digest: target.digest, canonical: target.canonical }
    }
    return { session, store, assertAccount, resolve }
  }

  async capabilities(sourceRef: string, signal?: AbortSignal) {
    const context = await this.context(sourceRef, signal)
    await context.assertAccount()
    return { supported: true, maxLength: MESSAGE_QUOTE_LIMIT, storage: 'local' as const }
  }

  async list(sourceRef: string, refs: readonly string[], signal?: AbortSignal) {
    if (!refs.length || refs.length > 40 || new Set(refs).size !== refs.length) throw invalid()
    const context = await this.context(sourceRef, signal)
    const targets = await Promise.all(refs.map(context.resolve))
    await context.assertAccount()
    return targets.map((target, index) => ({ actionRef: refs[index]!,
      snapshot: context.store.read(target.scope, target.key, context.session.userId, target.digest) }))
  }

  async change(sourceRef: string, ref: string, change: MessageUnderlineChange, signal?: AbortSignal) {
    if (!change || !underlineId(change.operationId) || !['add', 'remove'].includes(change.kind)
      || change.kind === 'remove' && !underlineId(change.annotationId)) throw invalid()
    const context = await this.context(sourceRef, signal), target = await context.resolve(ref)
    const anchor = change.kind === 'add' ? readMessageQuote(change.anchor) : undefined
    if (change.kind === 'add' && (!anchor || anchor.sourceDigest !== target.digest
      || anchor.recordVersion !== undefined || !quoteMatchesCanonical(anchor, target.canonical))) {
      throw new ArkmePluginError('arko-local-mark-source-changed', '选区与原文不一致，请重新选择', false, 409)
    }
    await context.assertAccount()
    try {
      return context.store.change(target.scope, target.key, context.session.userId, target.digest, change.kind === 'add'
        ? { kind: 'add', operationId: change.operationId, anchor: anchor! } : change)
    } catch (error) {
      throw new ArkmePluginError('arko-local-mark-save-failed', `本机标记未保存，已恢复。${error instanceof Error ? error.message : '请重试'}`, true, 500)
    }
  }
}
