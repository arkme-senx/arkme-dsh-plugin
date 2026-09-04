import type { ArkmeSessionCredentials } from '../keychain-store.js'
import { ArkmePluginError, ServiceRuntime, objectValue, stringValue } from './service.js'

export const CHAT_SESSION_CONVERSATION_LIST_ENTITY = 1 as const
export const BOT_DIRECT_CONVERSATION_LIST_ENTITY = 2 as const
export const CONVERSATION_LIST_VISIBLE = 1 as const
export const CONVERSATION_LIST_DISMISSED = 2 as const

const UPDATED_OUTCOME = 1
const IDEMPOTENT_OUTCOME = 2
const MAX_BATCH_SIZE = 200
const MAX_QUERY_REFS = 1_000
const MAX_ENTITY_UID_BYTES = 128

export type ConversationListPreferenceEntityKind =
  | typeof CHAT_SESSION_CONVERSATION_LIST_ENTITY
  | typeof BOT_DIRECT_CONVERSATION_LIST_ENTITY

export interface ConversationListPreferenceRef {
  entityKind: ConversationListPreferenceEntityKind
  entityUid: string
}

export interface ConversationListActivityEvidence {
  sequence: number
  activityAtMillis: number
}

export interface ConversationListPreferenceEntry {
  ownerUserId: number
  ref: ConversationListPreferenceRef
  evidence: ConversationListActivityEvidence
}

export interface ConversationListPreferenceSnapshot {
  ref: ConversationListPreferenceRef
  visibilityState: typeof CONVERSATION_LIST_VISIBLE | typeof CONVERSATION_LIST_DISMISSED
  dismissedThroughSequence: number
  dismissedThroughActivityAtMillis: number
  revision: number
  updatedAtMillis: number
}

export interface ConversationListPreferenceOperation {
  ownerUserId: number
  signal?: AbortSignal
}

/** Chat-owner port consumed by the directory use case. */
export interface ConversationListPreferencePort {
  query(
    refs: readonly ConversationListPreferenceRef[],
    operation: ConversationListPreferenceOperation,
  ): Promise<ConversationListPreferenceSnapshot[]>
  dismiss(
    ref: ConversationListPreferenceRef,
    evidence: ConversationListActivityEvidence,
    operation: ConversationListPreferenceOperation,
  ): Promise<ConversationListPreferenceSnapshot>
  restore(
    refs: readonly ConversationListPreferenceRef[],
    operation: ConversationListPreferenceOperation,
  ): Promise<void>
  restoreIfUnchanged(
    snapshots: readonly ConversationListPreferenceSnapshot[],
    operation: ConversationListPreferenceOperation,
  ): Promise<void>
}

/** HTTP/CAS adapter. Only revision hints are cached; owner snapshots stay server-owned. */
export class ConversationListPreferenceService implements ConversationListPreferencePort {
  private revisionOwnerUserId?: number
  private readonly revisionHints = new Map<string, number>()

  constructor(private readonly runtime: ServiceRuntime) {}

  async query(
    refs: readonly ConversationListPreferenceRef[],
    operation: ConversationListPreferenceOperation,
  ): Promise<ConversationListPreferenceSnapshot[]> {
    const normalized = normalizeRefs(refs)
    if (normalized.length === 0) return []
    const session = await this.requireOwnerSession(operation.ownerUserId)
    return await this.queryWithSession(normalized, session, operation.signal)
  }

  async dismiss(
    rawRef: ConversationListPreferenceRef,
    rawEvidence: ConversationListActivityEvidence,
    operation: ConversationListPreferenceOperation,
  ): Promise<ConversationListPreferenceSnapshot> {
    const ref = normalizeRef(rawRef)
    const evidence = normalizeEvidence(rawEvidence)
    if (evidence.sequence === 0 && evidence.activityAtMillis === 0) {
      throw new ArkmePluginError(
        'conversation-list-preference-evidence-unavailable',
        '当前会话活动信息不完整，请刷新后重试',
        true,
        409,
      )
    }
    if (ref.entityKind === BOT_DIRECT_CONVERSATION_LIST_ENTITY && evidence.sequence !== 0) {
      throw new ArkmePluginError(
        'conversation-list-preference-evidence-invalid',
        'Bot 会话活动信息无效，请刷新后重试',
        false,
        400,
      )
    }
    const session = await this.requireOwnerSession(operation.ownerUserId)
    const key = conversationListPreferenceRefKey(ref)
    const expectedRevision = this.revisionHints.get(key)
      ?? (await this.queryWithSession([ref], session, operation.signal))[0]!.revision
    const result = (await this.set([{
      ref,
      expectedRevision,
      targetVisibilityState: CONVERSATION_LIST_DISMISSED,
      evidence,
    }], session, operation.signal))[0]!
    if ((result.outcome !== UPDATED_OUTCOME && result.outcome !== IDEMPOTENT_OUTCOME)
      || result.snapshot.visibilityState !== CONVERSATION_LIST_DISMISSED
      || !conversationListPreferenceIsDismissed(result.snapshot, evidence)) {
      throw new ArkmePluginError(
        'conversation-list-preference-conflict',
        '会话状态已变化，已保留在列表中',
        false,
        409,
      )
    }
    return result.snapshot
  }

  async restore(
    refs: readonly ConversationListPreferenceRef[],
    operation: ConversationListPreferenceOperation,
  ): Promise<void> {
    const normalized = normalizeRefs(refs)
    if (normalized.length === 0) return
    const session = await this.requireOwnerSession(operation.ownerUserId)
    const snapshots = await this.queryWithSession(normalized, session, operation.signal)
    const writes = snapshots
      .filter(snapshot => snapshot.visibilityState === CONVERSATION_LIST_DISMISSED)
      .map(snapshot => ({
        ref: snapshot.ref,
        expectedRevision: snapshot.revision,
        targetVisibilityState: CONVERSATION_LIST_VISIBLE,
        evidence: { sequence: 0, activityAtMillis: 0 },
      } as const))
    for (let offset = 0; offset < writes.length; offset += MAX_BATCH_SIZE) {
      await this.set(writes.slice(offset, offset + MAX_BATCH_SIZE), session, operation.signal)
    }
  }

  async restoreIfUnchanged(
    snapshots: readonly ConversationListPreferenceSnapshot[],
    operation: ConversationListPreferenceOperation,
  ): Promise<void> {
    if (snapshots.length === 0) return
    const session = await this.requireOwnerSession(operation.ownerUserId)
    const writes = snapshots.map(snapshot => {
      if (snapshot.visibilityState !== CONVERSATION_LIST_DISMISSED
        || !Number.isSafeInteger(snapshot.revision) || snapshot.revision <= 0) {
        throw contractError('restore-snapshot')
      }
      return {
        ref: normalizeRef(snapshot.ref),
        expectedRevision: snapshot.revision,
        targetVisibilityState: CONVERSATION_LIST_VISIBLE,
        evidence: { sequence: 0, activityAtMillis: 0 },
      } as const
    })
    for (let offset = 0; offset < writes.length; offset += MAX_BATCH_SIZE) {
      await this.set(writes.slice(offset, offset + MAX_BATCH_SIZE), session, operation.signal)
    }
  }

  private async queryWithSession(
    refs: readonly ConversationListPreferenceRef[],
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<ConversationListPreferenceSnapshot[]> {
    const snapshots: ConversationListPreferenceSnapshot[] = []
    for (let offset = 0; offset < refs.length; offset += MAX_BATCH_SIZE) {
      const chunk = refs.slice(offset, offset + MAX_BATCH_SIZE)
      const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/conversation-list/preferences/query',
        { entry_refs: chunk.map(refBody) },
        session,
        signal,
      )
      const items = requiredList(data.items, 'query-items')
      if (items.length !== chunk.length) throw contractError('query-shape')
      items.forEach((value, index) => {
        const snapshot = parseSnapshot(objectValue(value))
        if (!sameRef(snapshot.ref, chunk[index]!)) throw contractError('query-identity')
        snapshots.push(snapshot)
      })
    }
    this.rememberRevisions(snapshots, session.userId)
    return snapshots
  }

  private async set(
    writes: readonly ConversationListPreferenceWrite[],
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<ConversationListPreferenceSetResult[]> {
    if (writes.length === 0 || writes.length > MAX_BATCH_SIZE) throw contractError('set-batch')
    const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/conversation-list/preferences/set',
      { items: writes.map(write => ({
        ...refBody(write.ref),
        target_visibility_state: write.targetVisibilityState,
        expected_revision: write.expectedRevision,
        observed_seq: write.evidence.sequence,
        observed_activity_at: write.evidence.activityAtMillis,
      })) },
      session,
      signal,
    )
    const items = requiredList(data.items, 'set-items')
    if (items.length !== writes.length) throw contractError('set-shape')
    const results = items.map((value, index) => {
      const raw = objectValue(value)
      const outcome = requiredInteger(raw.outcome, 'outcome')
      const snapshot = parseSnapshot(raw)
      if (outcome < 1 || outcome > 3) throw contractError('outcome')
      if (!sameRef(snapshot.ref, writes[index]!.ref)) throw contractError('set-identity')
      return { outcome, snapshot }
    })
    this.rememberRevisions(results.map(result => result.snapshot), session.userId)
    return results
  }

  private async requireOwnerSession(ownerUserId: number): Promise<ArkmeSessionCredentials> {
    const session = await this.runtime.requireSession()
    if (!Number.isSafeInteger(ownerUserId) || ownerUserId <= 0 || session.userId !== ownerUserId) {
      throw new ArkmePluginError('login-context-changed', '登录账号已切换，请重试当前操作', false, 409)
    }
    if (this.revisionOwnerUserId !== ownerUserId) {
      this.revisionOwnerUserId = ownerUserId
      this.revisionHints.clear()
    }
    return session
  }

  private rememberRevisions(
    snapshots: readonly ConversationListPreferenceSnapshot[],
    ownerUserId: number,
  ): void {
    if (this.revisionOwnerUserId !== ownerUserId) return
    for (const snapshot of snapshots) {
      const key = conversationListPreferenceRefKey(snapshot.ref)
      this.revisionHints.set(key, Math.max(this.revisionHints.get(key) ?? 0, snapshot.revision))
    }
  }
}

interface ConversationListPreferenceWrite {
  ref: ConversationListPreferenceRef
  expectedRevision: number
  targetVisibilityState: typeof CONVERSATION_LIST_VISIBLE | typeof CONVERSATION_LIST_DISMISSED
  evidence: ConversationListActivityEvidence
}

interface ConversationListPreferenceSetResult {
  outcome: number
  snapshot: ConversationListPreferenceSnapshot
}

export function conversationListPreferenceIsDismissed(
  snapshot: ConversationListPreferenceSnapshot,
  evidence: ConversationListActivityEvidence,
): boolean {
  return snapshot.visibilityState === CONVERSATION_LIST_DISMISSED
    && evidence.sequence <= snapshot.dismissedThroughSequence
    && evidence.activityAtMillis <= snapshot.dismissedThroughActivityAtMillis
}

export function conversationListPreferenceRefKey(ref: ConversationListPreferenceRef): string {
  return `${String(ref.entityKind)}:${ref.entityUid}`
}

function parseSnapshot(raw: Record<string, unknown>): ConversationListPreferenceSnapshot {
  const ref = normalizeRef({
    entityKind: requiredInteger(raw.entity_kind, 'entity-kind') as ConversationListPreferenceEntityKind,
    entityUid: stringValue(raw.entity_uid),
  })
  const visibilityState = requiredInteger(raw.visibility_state, 'visibility-state')
  if (visibilityState !== CONVERSATION_LIST_VISIBLE && visibilityState !== CONVERSATION_LIST_DISMISSED) {
    throw contractError('visibility-state')
  }
  const snapshot = {
    ref,
    visibilityState,
    dismissedThroughSequence: requiredInteger(raw.dismissed_through_seq, 'dismissed-sequence'),
    dismissedThroughActivityAtMillis: requiredInteger(raw.dismissed_through_activity_at, 'dismissed-activity'),
    revision: requiredInteger(raw.revision, 'revision'),
    updatedAtMillis: requiredInteger(raw.updated_at, 'updated-at'),
  }
  if (snapshot.visibilityState === CONVERSATION_LIST_VISIBLE
    && (snapshot.dismissedThroughSequence !== 0 || snapshot.dismissedThroughActivityAtMillis !== 0)) {
    throw contractError('visible-anchor')
  }
  if (snapshot.visibilityState === CONVERSATION_LIST_DISMISSED
    && snapshot.dismissedThroughSequence === 0 && snapshot.dismissedThroughActivityAtMillis === 0) {
    throw contractError('dismissed-anchor')
  }
  if (snapshot.ref.entityKind === BOT_DIRECT_CONVERSATION_LIST_ENTITY
    && snapshot.dismissedThroughSequence !== 0) {
    throw contractError('bot-sequence')
  }
  if ((snapshot.revision === 0) !== (snapshot.updatedAtMillis === 0)
    || (snapshot.visibilityState === CONVERSATION_LIST_DISMISSED && snapshot.revision === 0)) {
    throw contractError('revision')
  }
  return snapshot
}

function normalizeRefs(refs: readonly ConversationListPreferenceRef[]): ConversationListPreferenceRef[] {
  if (refs.length > MAX_QUERY_REFS) throw contractError('query-too-large')
  const unique = new Map<string, ConversationListPreferenceRef>()
  for (const value of refs) {
    const ref = normalizeRef(value)
    unique.set(conversationListPreferenceRefKey(ref), ref)
  }
  return [...unique.values()]
}

function normalizeRef(ref: ConversationListPreferenceRef): ConversationListPreferenceRef {
  if ((ref.entityKind !== CHAT_SESSION_CONVERSATION_LIST_ENTITY
      && ref.entityKind !== BOT_DIRECT_CONVERSATION_LIST_ENTITY)
    || ref.entityUid === '' || ref.entityUid !== ref.entityUid.trim()
    || Buffer.byteLength(ref.entityUid, 'utf8') > MAX_ENTITY_UID_BYTES) {
    throw contractError('identity')
  }
  return { ...ref }
}

function normalizeEvidence(evidence: ConversationListActivityEvidence): ConversationListActivityEvidence {
  if (!Number.isSafeInteger(evidence.sequence) || evidence.sequence < 0
    || !Number.isSafeInteger(evidence.activityAtMillis) || evidence.activityAtMillis < 0) {
    throw contractError('evidence')
  }
  return { ...evidence }
}

function refBody(ref: ConversationListPreferenceRef): Record<string, unknown> {
  return { entity_kind: ref.entityKind, entity_uid: ref.entityUid }
}

function sameRef(left: ConversationListPreferenceRef, right: ConversationListPreferenceRef): boolean {
  return left.entityKind === right.entityKind && left.entityUid === right.entityUid
}

function requiredList(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw contractError(field)
  return value
}

function requiredInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw contractError(field)
  return value
}

function contractError(field: string): ArkmePluginError {
  return new ArkmePluginError(
    `conversation-list-preference-${field}-invalid`,
    '会话列表偏好响应不完整，请刷新后重试',
    true,
    502,
  )
}
