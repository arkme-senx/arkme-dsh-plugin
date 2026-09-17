import type { ArkmeArchiveEntry, ArkmeArchivePage, ArkmeArchiveSetInput, ArkmeArchiveSetResult, ArkmeArchiveState } from '../archive-contract.js'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import { ArkmePluginError, objectValue, ServiceRuntime } from './service.js'
import type { SourceService } from './source-service.js'

const invalid = () => new ArkmePluginError('archive-contract-invalid', '归档数据无效，请刷新后重试', false, 502)

/** One Host owner for UI, Tools and SDK. Raw topic identities stay here. */
export class ArchiveService {
  constructor(private readonly runtime: ServiceRuntime, private readonly sources: SourceService) {}

  private async assertSession(session: ArkmeSessionCredentials): Promise<void> {
    const current = await this.runtime.accountScopedSession()
    if (current?.userId !== session.userId || current.refreshToken !== session.refreshToken) {
      throw new ArkmePluginError('archive-account-changed', '账号已变化，请刷新后重试', false, 409)
    }
  }

  async list(cursor?: string, signal?: AbortSignal): Promise<ArkmeArchivePage> {
    return this.runtime.runOwnerRead('archives', { operation: 'list', cursor }, async readSignal => {
      const session = await this.runtime.requireSession()
      const data = await this.runtime.authenticatedPost<Record<string, unknown>>('/api/v1/archives/list', {
        entity_type: 1, limit: 50, ...(cursor === undefined ? {} : { cursor }),
      }, session, readSignal, { lane: 'interactive-read' })
      if (!Array.isArray(data.items) || typeof data.has_more !== 'boolean') throw invalid()
      const items: ArkmeArchiveEntry[] = []
      for (const value of data.items) {
        const raw = objectValue(value)
        if (typeof raw.title !== 'string' || typeof raw.privacy_locked !== 'boolean') throw invalid()
        const title = raw.privacy_locked ? '隐私主题' : raw.title
        const state = await this.state(session, raw, title)
        if (!state.ownerAvailable || !state.effectiveArchived) throw invalid()
        items.push({ ...state, privacyLocked: raw.privacy_locked, source: {
          kind: 'topic', topicKind: 1, sourceRef: state.sourceRef, displayName: title,
          activeAtMillis: state.displayArchiveAt, unreadCount: 0,
          topicHierarchyKey: await this.sources.topicHierarchyKey(session.userId, raw.entity_uid as string),
        } })
      }
      if (data.has_more && (typeof data.next_cursor !== 'string' || data.next_cursor === '' || data.next_cursor === cursor)) throw invalid()
      await this.assertSession(session)
      return { items, hasMore: data.has_more, ...(data.has_more ? { nextCursor: data.next_cursor as string } : {}) }
    }, signal)
  }

  async states(sourceRefs: readonly string[], signal?: AbortSignal): Promise<ArkmeArchiveState[]> {
    if (sourceRefs.length === 0 || sourceRefs.length > 200 || new Set(sourceRefs).size !== sourceRefs.length) throw invalid()
    return this.runtime.runOwnerRead('archives', { operation: 'states', sourceRefs }, async readSignal => {
      const session = await this.runtime.requireSession()
      const refs = await Promise.all(sourceRefs.map(ref => this.sources.openSourceRef(ref, session.userId)))
      if (refs.some(ref => ref.kind !== 'topic')) throw new ArkmePluginError('archive-target-invalid', '仅支持个人主题归档', false, 400)
      await this.assertSession(session)
      const data = await this.runtime.authenticatedPost<Record<string, unknown>>('/api/v1/archives/states/query', {
        entities: refs.map(ref => ({ entity_type: 1, entity_uid: ref.ownerRef })),
      }, session, readSignal, { lane: 'interactive-read' })
      if (!Array.isArray(data.items) || data.items.length !== refs.length) throw invalid()
      const byUID = new Map(data.items.map(value => { const raw = objectValue(value); return [raw.entity_uid, raw] }))
      if (byUID.size !== refs.length) throw invalid()
      const states = await Promise.all(refs.map(async (ref, i) => ({
        ...await this.state(session, byUID.get(ref.ownerRef), ''), sourceRef: sourceRefs[i]!,
      })))
      await this.assertSession(session)
      return states
    }, signal)
  }

  async set(input: ArkmeArchiveSetInput, signal?: AbortSignal): Promise<ArkmeArchiveSetResult> {
    if (typeof input.selfArchived !== 'boolean' || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw invalid()
    const session = await this.runtime.requireSession()
    const ref = await this.sources.openSourceRef(input.sourceRef, session.userId)
    if (ref.kind !== 'topic') throw new ArkmePluginError('archive-target-invalid', '仅支持个人主题归档', false, 400)
    await this.assertSession(session)
    signal?.throwIfAborted()
    return this.runtime.withOwnerReadInvalidation('archives', async () => {
      try {
        const data = await this.runtime.authenticatedPost<Record<string, unknown>>('/api/v1/archives/set', {
          entity_type: 1, entity_uid: ref.ownerRef, self_status: input.selfArchived ? 2 : 1, expected_revision: input.expectedRevision,
        }, session, signal, { trackWriteOutcome: true })
        if (data.entity_uid !== ref.ownerRef || data.self_status !== (input.selfArchived ? 2 : 1)
          || typeof data.state_changed !== 'boolean' || !Number.isSafeInteger(data.effective_changed_count) || Number(data.effective_changed_count) < 0) throw invalid()
        const state = await this.state(session, data, '')
        await this.assertSession(session)
        return { ...state, sourceRef: input.sourceRef, stateChanged: data.state_changed, effectiveChangedCount: Number(data.effective_changed_count) }
      } finally {
        // An unknown write outcome must also invalidate pre-write directory flights.
        this.sources.invalidateSourceListCache(session.userId, 'send_to_self')
      }
    })
  }

  private async state(session: ArkmeSessionCredentials, value: unknown, title: string): Promise<ArkmeArchiveState> {
    const raw = objectValue(value)
    if (raw.entity_type !== 1 || typeof raw.entity_uid !== 'string' || raw.entity_uid.trim() === ''
      || (raw.self_status !== 1 && raw.self_status !== 2) || (raw.effective_status !== 1 && raw.effective_status !== 2)
      || typeof raw.owner_available !== 'boolean' || !Number.isSafeInteger(raw.revision) || Number(raw.revision) < 0
      || !Number.isSafeInteger(raw.display_archive_at)) throw invalid()
    const parent = raw.inherited_from === undefined ? undefined : objectValue(raw.inherited_from)
    if (parent !== undefined && (parent.entity_type !== 1 || typeof parent.entity_uid !== 'string' || parent.entity_uid === '')) throw invalid()
    return {
      entityType: 'topic', sourceRef: await this.sources.sealSourceRef(session.userId, 'topic', raw.entity_uid, title),
      ownerAvailable: raw.owner_available, selfArchived: raw.self_status === 2, effectiveArchived: raw.effective_status === 2,
      revision: Number(raw.revision), displayArchiveAt: Number(raw.display_archive_at),
      ...(parent === undefined ? {} : { inheritedFrom: { sourceRef: await this.sources.sealSourceRef(session.userId, 'topic', parent.entity_uid as string, '归档来源'), topicHierarchyKey: await this.sources.topicHierarchyKey(session.userId, parent.entity_uid as string) } }),
    }
  }
}
