import { Context } from '@deepseek-ai/cordis'
import * as jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SessionPersistence, SessionAlreadyExistsError, SessionPersistenceNotFoundError,
  type SessionAccess, type SessionHandle, type SessionPersistenceCreateOptions, type SessionPersistenceOpenOptions,
  type SessionPersistenceListOptions, type SessionPersistenceSnapshot, type SessionPersistenceStatOptions,
} from '@deepseek-ai/dsh-session-persistence'
import { SessionId, type SessionHeader } from '@deepseek-ai/dsh-session'
import { join, resolve } from 'node:path'
import { stat } from 'node:fs/promises'
import { LocalSessionDiscovery, type LocalHistoryIdentity, type LocalHistorySource } from './local-session-discovery.js'
import { readLocalHistoryFormats } from './local-history-format.js'
import { SharedReadGroup } from './shared-read-group.js'
import type { FileAttachmentRef, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'

export interface LocalHistoryPersistenceConfig {
  dshHome: string; primaryRoot?: string; sharedRoot?: string; userHome: string; indexRoot: string; dataRoots: string[]; searchRoots: string[]
}
type Backend = { persistence: SessionPersistence; close(): Promise<void> }
type Admission = { source: LocalHistorySource; backend: Backend; identity: LocalHistoryIdentity }

/** Multiplex public native backends. Each journal stays at its original path,
 * so an old, uncoordinated client still contends on the SAME native writer lock. */
export class LocalHistoryPersistence extends SessionPersistence {
  private readonly sources = new Map<string, Admission>()
  private readonly backends = new Map<string, Promise<Backend>>()
  private readonly reads = new SharedReadGroup<boolean>()
  readonly discovery: LocalSessionDiscovery
  get home(): string { return this.config.dshHome }
  constructor(ctx: Context, private readonly config: LocalHistoryPersistenceConfig,
    private readonly primary: Backend, private readonly mount: (root: string) => Promise<Backend>) {
    super(ctx)
    this.discovery = new LocalSessionDiscovery(config)
    ctx.provide('arkmeLocalHistory', this)
    ctx.effect(() => async () => {
      this.reads.clear(); this.discovery.close()
      await Promise.allSettled([...this.backends.values()].map(async value => (await value).close()))
      await primary.close()
    }, 'arkme: local history native stores')
  }

  async discover(identity: LocalHistoryIdentity, signal: AbortSignal, sharedAlias = false, scope: 'registered' | 'all' = 'all'): Promise<boolean> {
    signal.throwIfAborted()
    const id = identity.sessionRef, known = this.sources.get(id)
    if (known) {
      if (known.identity.accountId !== identity.accountId || known.identity.environment !== identity.environment || known.source.runtimeRef !== identity.runtimeRef && !identity.previousRuntimeRefs?.includes(known.source.runtimeRef)) throw new Error('本机会话来源冲突，未接管历史')
      return true
    }
    return this.reads.run(JSON.stringify([identity, sharedAlias, scope]), async shared => {
      // An existing account-scoped coordinator alias is the provenance for
      // logs already moved by the previous shared-store implementation.
      const sharedHome = this.config.sharedRoot
      const sharedBackend = sharedAlias && sharedHome ? await this.mounted(join(sharedHome, 'sessions')) : undefined
      const hasShared = sharedBackend && await sharedBackend.persistence.stat(SessionId(id), { signal: shared })
      const found = hasShared ? [{ dshHome: sharedHome!, runtimeRef: identity.runtimeRef, sessionRef: id }]
        : (await this.discovery.find(identity, shared, scope)).filter(source => resolve(source.dshHome) !== resolve(this.config.dshHome))
      if (!found.length) return false
      if (found.length !== 1 || await this.primary.persistence.stat(SessionId(id), { signal: shared })) throw new Error('本机存在多个同标识历史副本，未自动选择或接管')
      if (this.sources.size >= 256) throw new Error('本机历史打开数量已达上限，请重启后重试')
      const source = found[0]!, root = join(source.dshHome, 'sessions')
      const resolved = await this.mounted(root), snapshot = await resolved.persistence.stat(SessionId(id), { signal: shared })
      shared.throwIfAborted()
      if (!snapshot) return false
      // A header classification is not full-body validation. Let the official
      // read handle validate the journal before advertising it to any adapter.
      const handle = await resolved.persistence.open(SessionId(id), 'read', { signal: shared })
      try { await handle.read(0, undefined, { signal: shared }) } finally { await handle.close() }
      shared.throwIfAborted()
      const concurrent = this.sources.get(id)
      if (concurrent && (concurrent.identity.accountId !== identity.accountId || concurrent.identity.environment !== identity.environment || concurrent.source.runtimeRef !== source.runtimeRef)) throw new Error('本机会话来源冲突，未接管历史')
      if (!this.sources.has(id) && this.sources.size >= 256) throw new Error('本机历史打开数量已达上限，请重启后重试')
      this.sources.set(id, { source, backend: resolved, identity })
      return true
    }, signal)
  }

  private mounted(root: string): Promise<Backend> {
    let backend = this.backends.get(root)
    if (!backend) {
      if (this.backends.size >= 32) throw new Error('本机历史实例打开数量已达上限')
      backend = this.mount(root).catch(error => { this.backends.delete(root); throw error })
      this.backends.set(root, backend)
    }
    return backend
  }

  async formats(id: SessionId, expected: { header: unknown; events: readonly unknown[] }, signal: AbortSignal) {
    const admission = this.sources.get(id)
    if (!admission) return
    const snapshots = await admission.backend.persistence.list({ signal })
    const children = snapshots.filter(row => row.header.parentSession === id).map(row => row.header.id)
    if (children.length > 256) throw new Error('旧会话子会话数量超过迁移上限')
    return readLocalHistoryFormats(join(admission.source.dshHome, 'sessions'), id, expected, children, signal)
  }

  isDiscovered(id: SessionId): boolean { return this.sources.has(id) }
  attachmentHomes(): string[] { return [...new Set([this.config.dshHome, ...[...this.sources.values()].map(value => value.source.dshHome)])] }

  private backend(id: SessionId): SessionPersistence { return this.sources.get(id)?.backend.persistence ?? this.primary.persistence }
  override async create(header: SessionHeader, options?: SessionPersistenceCreateOptions): Promise<SessionHandle> {
    if (this.sources.has(header.id)) throw new SessionAlreadyExistsError(header.id)
    return this.primary.persistence.create(header, options)
  }
  override async open(id: SessionId, access: SessionAccess, options?: SessionPersistenceOpenOptions): Promise<SessionHandle> {
    const backend = this.backend(id)
    if (access === 'write' && this.sources.has(id)) {
      // Do not silently replace a missing old workspace with this instance's cwd.
      const snapshot = await backend.stat(id, options)
      if (!snapshot) throw new SessionPersistenceNotFoundError(id)
      const cwd = snapshot.header.cwd
      if (!cwd || !(await stat(cwd).catch(() => undefined))?.isDirectory()) throw new Error('原会话工作目录不可用，可查看历史但不能继续')
      const writer = await backend.open(id, 'write', options)
      try {
        for (let offset = 0;; offset += 100) {
          const { events } = await writer.read(offset, 100, options)
          for (const event of events) await this.verifyAttachments(event.data, options?.signal)
          if (events.length < 100) break
        }
        return writer
      } catch (error) { await writer.close(); throw error }
    }
    return backend.open(id, access, options)
  }
  private async verifyAttachments(value: unknown, signal?: AbortSignal, depth = 0): Promise<void> {
    signal?.throwIfAborted()
    if (depth > 40) throw new Error('旧会话资源结构过深，未接管')
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) { for (const child of value) await this.verifyAttachments(child, signal, depth + 1); return }
    const row = value as Record<string, unknown>
    if (['image', 'file'].includes(String(row.type)) && row.attachment) {
      const store = this.ctx.get('attachments')
      if (!store) throw new Error('旧会话附件存储未就绪；文字历史仍可查看')
      if (row.type === 'image') await store.readImage(row.attachment as ImageAttachmentRef, signal)
      else for await (const _chunk of store.readFileStream(row.attachment as FileAttachmentRef, signal)) { signal?.throwIfAborted() }
      return
    }
    if ('attachmentId' in row || 'attachmentRef' in row || ['image', 'audio', 'video', 'file', 'attachment'].includes(String(row.type))) {
      throw new Error('旧会话包含不支持的附件引用；文字历史仍可查看')
    }
    for (const child of Object.values(row)) await this.verifyAttachments(child, signal, depth + 1)
  }
  override async stat(id: SessionId, options?: SessionPersistenceStatOptions): Promise<SessionPersistenceSnapshot | undefined> { return this.backend(id).stat(id, options) }
  override async list(options?: SessionPersistenceListOptions): Promise<readonly SessionPersistenceSnapshot[]> {
    const rows = [...await this.primary.persistence.list(options)]
    for (const [id, source] of this.sources) {
      options?.signal?.throwIfAborted()
      if (rows.some(row => row.header.id === id)) throw new Error('本机会话来源冲突')
      const row = await source.backend.persistence.stat(SessionId(id), options)
      if (row) rows.push(row)
    }
    return rows
  }
  override async flush(): Promise<void> {
    await this.primary.persistence.flush()
    for (const backend of this.backends.values()) await (await backend).persistence.flush()
  }
}

export async function apply(ctx: Context, config: LocalHistoryPersistenceConfig): Promise<void> {
  const mount = async (root: string): Promise<Backend> => {
    const scope = ctx.isolate('sessionPersistence')
    const fiber = scope.plugin({ name: 'arkme-local-history-jsonl', apply: async (child: Context) => { await child.plugin(jsonl, { root }) } })
    await fiber
    const persistence = scope.get('sessionPersistence')
    if (!persistence) { await fiber.dispose(); throw new Error('原生历史存储未就绪') }
    return { persistence, close: async () => { await fiber.dispose() } }
  }
  const primary = await mount(config.primaryRoot ?? join(config.dshHome, 'sessions'))
  new LocalHistoryPersistence(ctx, config, primary, mount)
}

declare module '@deepseek-ai/cordis' { interface Context { arkmeLocalHistory: LocalHistoryPersistence } }
