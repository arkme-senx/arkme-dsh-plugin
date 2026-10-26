import { createHash } from 'node:crypto'
import { underlineId, type MessageUnderlineChange } from '../message-annotations.js'
import { MESSAGE_QUOTE_LIMIT, normalizeQuoteText, quoteMatchesCanonical, quoteSourceContent, readMessageQuote } from '../message-quote.js'
import { ArkmePluginError, type ServiceRuntime } from './service.js'

const invalid = () => new ArkmePluginError('native-local-mark-invalid', '本机标记引用无效，请重新打开会话', false, 403)
/** Private annotations of client-rendered DSH text, never authority to edit/share a Chat record. */
export class NativeLocalMarks {
  constructor(private readonly runtime: ServiceRuntime, private readonly namespace: 'dsh-native' | 'codex' = 'dsh-native') {}
  private async context(sourceRef: string, signal?: AbortSignal) {
    const session = await this.runtime.requireSession()
    let source: unknown
    try { source = JSON.parse(sourceRef) } catch { throw invalid() }
    if (!Array.isArray(source) || source.length !== 3 || source[0] !== this.namespace
      || source[1] !== session.userId || typeof source[2] !== 'string' || !source[2].trim() || source[2].length > 512) throw invalid()
    const store = this.runtime.stateStore.messageMarks
    if (!store) throw new ArkmePluginError('native-local-mark-storage-unavailable', '本机标记存储暂不可用，请重试', true, 503)
    const scope = JSON.stringify([this.runtime.config.environment, session.userId, this.namespace, source[2]])
    const assertAccount = async () => {
      signal?.throwIfAborted()
      const current = await this.runtime.accountScopedSession()
      if (!current || current.userId !== session.userId || current.refreshToken !== session.refreshToken) {
        throw new ArkmePluginError('native-local-mark-account-changed', '账号已变化，请重新打开会话', false, 403)
      }
    }
    const resolve = (ref: string) => {
      if (typeof ref !== 'string' || Buffer.byteLength(ref, 'utf8') > 300_000) throw invalid()
      let target: unknown
      try { target = JSON.parse(ref) } catch { throw invalid() }
      if (!Array.isArray(target) || (target.length !== 3 && target.length !== 4) || target[0] !== sourceRef || typeof target[1] !== 'string'
        || !target[1].trim() || target[1].length > 1024 || typeof target[2] !== 'string'
        || !target[2] || normalizeQuoteText(target[2]) !== target[2]) throw invalid()
      return { key: target[1], canonical: target[2], digest: createHash('sha256').update(quoteSourceContent({ title: '', textContent: target[2], textFormat: 'plain' })).digest('hex') }
    }
    return { session, store, scope, assertAccount, resolve }
  }
  async capabilities(sourceRef: string, signal?: AbortSignal) {
    const context = await this.context(sourceRef, signal); await context.assertAccount()
    return { supported: true, maxLength: MESSAGE_QUOTE_LIMIT, storage: 'local' as const }
  }
  async list(sourceRef: string, refs: string[], signal?: AbortSignal) {
    if (!Array.isArray(refs) || !refs.length || refs.length > 40 || new Set(refs).size !== refs.length) throw invalid()
    const context = await this.context(sourceRef, signal), targets = refs.map(context.resolve)
    await context.assertAccount()
    return targets.map((target, index) => ({ actionRef: refs[index]!, snapshot: context.store.read(context.scope, target.key, context.session.userId, target.digest) }))
  }
  async change(sourceRef: string, ref: string, change: MessageUnderlineChange, signal?: AbortSignal) {
    if (!change || !underlineId(change.operationId) || !['add', 'remove'].includes(change.kind)
      || change.kind === 'remove' && !underlineId(change.annotationId)) throw invalid()
    const context = await this.context(sourceRef, signal), target = context.resolve(ref)
    const anchor = change.kind === 'add' ? readMessageQuote(change.anchor) : undefined
    if (change.kind === 'add' && (!anchor || anchor.sourceDigest !== target.digest || anchor.recordVersion !== undefined
      || !quoteMatchesCanonical(anchor, target.canonical))) throw new ArkmePluginError('native-local-mark-source-changed', '选区与原文不一致，请重新选择', false, 409)
    await context.assertAccount()
    try {
      return context.store.change(context.scope, target.key, context.session.userId, target.digest, change.kind === 'add'
        ? { kind: 'add', operationId: change.operationId, anchor: anchor! } : change)
    } catch {
      throw new ArkmePluginError('native-local-mark-save-failed', '本机标记未保存，已恢复，请重试', true, 500)
    }
  }
}
