import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  ArkmeLongArticleDraft,
  ArkmePendingWrite,
  ArkmeRecordCaptureContext,
  ArkmeRecordReeditDraft,
} from './types.js'
import {
  sameRecordingImportIdentity,
  isUnresolvedRecordingImportJob,
  type RecordingImportAdmission,
  type RecordingImportJob,
  type RecordingImportPhase,
} from './recording-import-contract.js'
import { recordingImportFileNameKey } from './recording-import-shared.js'
import { securePrivateDirectory, securePrivateFile } from './private-filesystem.js'
import { ArkmeRecordReeditDraftConflict, parseArkmeRecordReeditAttachments } from './record-reedit-contract.js'
import type { ArkmeRecordReeditSubmission } from './record-reedit-contract.js'

interface PersistedState {
  version: 2
  uniqueCode: string
  pendingByUser: Record<string, ArkmePendingWrite[]>
  longArticleDraftsByUser: Record<string, Record<string, ArkmeLongArticleDraft>>
  // Preserve unrecognized recovery evidence; validate only at the owning account boundary.
  recordReeditDraftsByUser: unknown
  recordReeditSubmissionsByUser: unknown
  recordReeditDraftRevision: unknown
  recordingImportJobsByUser: Record<string, Record<string, RecordingImportJob>>
}

function emptyState(): PersistedState {
  return {
    version: 2,
    uniqueCode: randomUUID(),
    pendingByUser: {},
    longArticleDraftsByUser: {},
    recordReeditDraftsByUser: {},
    recordReeditSubmissionsByUser: {},
    recordReeditDraftRevision: 0,
    recordingImportJobsByUser: {},
  }
}

const RECORDING_IMPORT_PHASES = new Set<RecordingImportPhase>([
  'prepared', 'uploading', 'finalizing', 'accepted', 'failed', 'cancelled',
])
export const RECORDING_IMPORT_TERMINAL_HISTORY_LIMIT = 100

function cloneRecordingImportJob(job: RecordingImportJob): RecordingImportJob {
  return structuredClone(job)
}

function pruneRecordingImportTerminalJobs(jobs: Record<string, RecordingImportJob>): void {
  const expiredTerminalJobs = Object.values(jobs)
    .filter(candidate => !isUnresolvedRecordingImportJob(candidate))
    .sort((left, right) => right.createdAtMillis - left.createdAtMillis)
    .slice(RECORDING_IMPORT_TERMINAL_HISTORY_LIMIT)
  for (const expired of expiredTerminalJobs) delete jobs[expired.jobId]
}

function normalizedRecordingImportJob(value: unknown): RecordingImportJob | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  const requiredStrings = ['jobId', 'fileName', 'mimeType', 'sha256', 'sourceHandle'] as const
  const requiredNumbers = [
    'userId', 'revision', 'fileSize', 'durationMillis', 'startAtMillis', 'belongUserId',
    'uploadedBytes', 'createdAtMillis', 'updatedAtMillis',
  ] as const
  if (requiredStrings.some(key => typeof source[key] !== 'string')) return undefined
  if (requiredNumbers.some(key => typeof source[key] !== 'number' || !Number.isFinite(source[key]))) return undefined
  if (typeof source.phase !== 'string' || !RECORDING_IMPORT_PHASES.has(source.phase as RecordingImportPhase)) return undefined
  return {
    jobId: source.jobId as string,
    userId: source.userId as number,
    revision: source.revision as number,
    phase: source.phase as RecordingImportPhase,
    fileName: source.fileName as string,
    mimeType: source.mimeType as string,
    fileSize: source.fileSize as number,
    durationMillis: source.durationMillis as number,
    sha256: source.sha256 as string,
    startAtMillis: source.startAtMillis as number,
    belongUserId: source.belongUserId as number,
    sourceHandle: source.sourceHandle as string,
    uploadedBytes: source.uploadedBytes as number,
    createdAtMillis: source.createdAtMillis as number,
    updatedAtMillis: source.updatedAtMillis as number,
    ...(typeof source.sessionId === 'string' ? { sessionId: source.sessionId } : {}),
    ...(typeof source.childId === 'string' ? { childId: source.childId } : {}),
    ...(typeof source.childFinished === 'boolean' ? { childFinished: source.childFinished } : {}),
    ...(typeof source.errorCode === 'string' ? { errorCode: source.errorCode } : {}),
    ...(typeof source.errorMessage === 'string' ? { errorMessage: source.errorMessage } : {}),
    ...(typeof source.retryable === 'boolean' ? { retryable: source.retryable } : {}),
    ...(typeof source.failedFromPhase === 'string'
      && RECORDING_IMPORT_PHASES.has(source.failedFromPhase as RecordingImportPhase)
      && !['failed', 'cancelled', 'accepted'].includes(source.failedFromPhase)
      ? { failedFromPhase: source.failedFromPhase as Exclude<RecordingImportJob['failedFromPhase'], undefined> }
      : {}),
    ...(source.uploadCheckpoint !== null && typeof source.uploadCheckpoint === 'object'
      && !Array.isArray(source.uploadCheckpoint)
      ? { uploadCheckpoint: source.uploadCheckpoint as Record<string, unknown> }
      : {}),
  }
}

function normalizedLongArticleDraft(value: unknown): ArkmeLongArticleDraft | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const source = value as Record<string, unknown>
  if (typeof source.sourceRef !== 'string' || source.sourceRef.trim() === '') return undefined
  if (typeof source.title !== 'string' || typeof source.textContent !== 'string') return undefined
  const itemUid = typeof source.itemUid === 'string' && source.itemUid.trim() !== '' ? source.itemUid.trim() : undefined
  return {
    sourceRef: source.sourceRef,
    ...(itemUid === undefined ? {} : { itemUid }),
    title: source.title.slice(0, 100),
    textContent: source.textContent.slice(0, 40000),
    durationMillis: typeof source.durationMillis === 'number' && Number.isFinite(source.durationMillis)
      ? Math.max(0, Math.trunc(source.durationMillis))
      : 0,
    updatedAtMillis: typeof source.updatedAtMillis === 'number' && Number.isFinite(source.updatedAtMillis)
      ? Math.max(0, Math.trunc(source.updatedAtMillis))
      : 0,
  }
}

function longArticleDraftKey(sourceRef: string, itemUid?: string): string {
  return `${sourceRef}\u0000${itemUid ?? ''}`
}

function normalizedRecordReeditDraft(value: unknown): ArkmeRecordReeditDraft | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  const sourceIdentityKey = typeof source.sourceIdentityKey === 'string' ? source.sourceIdentityKey.trim() : ''
  const lastSourceRef = typeof source.lastSourceRef === 'string' ? source.lastSourceRef.trim() : ''
  const itemUid = typeof source.itemUid === 'string' ? source.itemUid.trim() : ''
  const fingerprint = typeof source.baseContentFingerprint === 'string'
    ? source.baseContentFingerprint.trim().toLowerCase()
    : ''
  if (source.schemaVersion !== 1 || sourceIdentityKey === '' || lastSourceRef === '' || itemUid === ''
    || typeof source.title !== 'string' || typeof source.textContent !== 'string'
    || !Number.isSafeInteger(source.draftRevision) || (source.draftRevision as number) <= 0
    || !Number.isSafeInteger(source.baseVersion) || (source.baseVersion as number) <= 0
    || !/^[a-f0-9]{64}$/.test(fingerprint)) return undefined
  let attachments: ArkmeRecordReeditDraft['attachments']
  try {
    if (source.attachments !== undefined) attachments = parseArkmeRecordReeditAttachments(source.attachments)
  } catch { return undefined }
  return {
    schemaVersion: 1,
    draftRevision: source.draftRevision as number,
    sourceIdentityKey,
    lastSourceRef,
    itemUid,
    title: source.title.slice(0, 100),
    textContent: source.textContent.slice(0, 40000),
    ...(attachments === undefined ? {} : { attachments }),
    baseVersion: source.baseVersion as number,
    baseContentFingerprint: fingerprint,
    editDurationMillis: typeof source.editDurationMillis === 'number' && Number.isFinite(source.editDurationMillis)
      ? Math.max(0, Math.trunc(source.editDurationMillis))
      : 0,
    updatedAtMillis: typeof source.updatedAtMillis === 'number' && Number.isFinite(source.updatedAtMillis)
      ? Math.max(0, Math.trunc(source.updatedAtMillis))
      : 0,
  }
}

function recordReeditDraftKey(sourceIdentityKey: string, itemUid: string): string {
  return `${sourceIdentityKey}\u0000${itemUid}`
}

function sameRecordReeditCandidate(left: Omit<ArkmeRecordReeditDraft, 'draftRevision'>, right: Omit<ArkmeRecordReeditDraft, 'draftRevision'>): boolean {
  // Cache timestamps and refreshed source capabilities do not create new content.
  return left.baseVersion === right.baseVersion
    && left.baseContentFingerprint === right.baseContentFingerprint && left.title === right.title
    && left.textContent === right.textContent
    && JSON.stringify(left.attachments) === JSON.stringify(right.attachments)
}

function sameRecordReeditDraft(left: ArkmeRecordReeditDraft, right: ArkmeRecordReeditDraft): boolean {
  return left.draftRevision === right.draftRevision && sameRecordReeditCandidate(left, right)
}

function normalizedCaptureContext(value: unknown): ArkmeRecordCaptureContext | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  const clientName = typeof source.clientName === 'string' ? source.clientName.trim().slice(0, 120) : ''
  const networkName = typeof source.networkName === 'string' ? source.networkName.trim().slice(0, 120) : ''
  const electric = typeof source.electric === 'number' && Number.isFinite(source.electric) ? Math.trunc(source.electric) : undefined
  const charge = typeof source.charge === 'number' && Number.isFinite(source.charge) ? Math.trunc(source.charge) : 0
  const result: ArkmeRecordCaptureContext = {
    ...(clientName === '' ? {} : { clientName }),
    ...(networkName === '' ? {} : { networkName }),
    ...(electric === undefined || electric < 0 || electric > 100 ? {} : { electric }),
    ...(charge < 1 || charge > 3 ? {} : { charge }),
  }
  return Object.keys(result).length === 0 ? undefined : result
}

function normalizedPending(value: unknown): ArkmePendingWrite[] {
  if (!Array.isArray(value)) return []
  const result: ArkmePendingWrite[] = []
  for (const item of value) {
    if (item === null || typeof item !== 'object') continue
    const source = item as Record<string, unknown>
    if (typeof source.recordUid !== 'string' || source.recordUid.trim() === '') continue
    if (typeof source.textContent !== 'string' || source.textContent.trim() === '') continue
    const recordDurationMillis = typeof source.recordDurationMillis === 'number' && Number.isFinite(source.recordDurationMillis)
      ? Math.max(0, Math.trunc(source.recordDurationMillis))
      : 0
    const captureContext = normalizedCaptureContext(source.captureContext)
    result.push({
      recordUid: source.recordUid,
      textContent: source.textContent,
      createdAtMillis: typeof source.createdAtMillis === 'number' ? source.createdAtMillis : 0,
      sendAtMillis: typeof source.sendAtMillis === 'number' ? source.sendAtMillis : 0,
      attempts: typeof source.attempts === 'number' ? source.attempts : 0,
      ...(recordDurationMillis === 0 ? {} : { recordDurationMillis }),
      ...(captureContext === undefined ? {} : { captureContext }),
      ...(typeof source.lastError === 'string' && source.lastError !== ''
        ? { lastError: source.lastError }
        : {}),
    })
  }
  return result
}

function legacyRecordReeditRevision(drafts: unknown, submissions: unknown): number {
  let revision = 0
  // A receipt may outlive its draft. Inspect recognizable evidence without
  // letting another account's malformed evidence break ordinary state reads.
  if (drafts && typeof drafts === 'object' && !Array.isArray(drafts)) {
    for (const entries of Object.values(drafts)) {
      if (!entries || typeof entries !== 'object' || Array.isArray(entries)) continue
      for (const [key, raw] of Object.entries(entries)) {
        const draft = normalizedRecordReeditDraft(raw)
        if (draft && key === recordReeditDraftKey(draft.sourceIdentityKey, draft.itemUid)) revision = Math.max(revision, draft.draftRevision)
      }
    }
  }
  if (submissions && typeof submissions === 'object' && !Array.isArray(submissions)) {
    for (const entries of Object.values(submissions)) {
      if (!entries || typeof entries !== 'object' || Array.isArray(entries)) continue
      for (const job of Object.values(entries)) {
        const draft = normalizedRecordReeditDraft(job && typeof job === 'object' ? (job as Record<string, unknown>).draft : undefined)
        if (draft) revision = Math.max(revision, draft.draftRevision)
      }
    }
  }
  return revision
}

function parseState(raw: string): PersistedState {
  const parsed = JSON.parse(raw) as unknown
  if (parsed === null || typeof parsed !== 'object') return emptyState()
  const source = parsed as Record<string, unknown>
  const recordReeditDraftsByUser = source.recordReeditDraftsByUser === undefined ? {} : source.recordReeditDraftsByUser
  const recordReeditSubmissionsByUser = source.recordReeditSubmissionsByUser === undefined ? {} : source.recordReeditSubmissionsByUser
  const pendingByUser: Record<string, ArkmePendingWrite[]> = {}
  if (source.pendingByUser !== null && typeof source.pendingByUser === 'object') {
    for (const [userId, pending] of Object.entries(source.pendingByUser as Record<string, unknown>)) {
      pendingByUser[userId] = normalizedPending(pending)
    }
  }
  const longArticleDraftsByUser: Record<string, Record<string, ArkmeLongArticleDraft>> = {}
  if (source.longArticleDraftsByUser !== null && typeof source.longArticleDraftsByUser === 'object') {
    for (const [userId, rawDrafts] of Object.entries(source.longArticleDraftsByUser as Record<string, unknown>)) {
      if (rawDrafts === null || typeof rawDrafts !== 'object') continue
      const drafts: Record<string, ArkmeLongArticleDraft> = {}
      for (const [key, rawDraft] of Object.entries(rawDrafts as Record<string, unknown>)) {
        const draft = normalizedLongArticleDraft(rawDraft)
        if (draft !== undefined) drafts[key] = draft
      }
      if (Object.keys(drafts).length > 0) longArticleDraftsByUser[userId] = drafts
    }
  }
  const recordingImportJobsByUser: Record<string, Record<string, RecordingImportJob>> = {}
  if (source.recordingImportJobsByUser !== null && typeof source.recordingImportJobsByUser === 'object') {
    for (const [userId, rawJobs] of Object.entries(source.recordingImportJobsByUser as Record<string, unknown>)) {
      if (rawJobs === null || typeof rawJobs !== 'object' || Array.isArray(rawJobs)) continue
      const jobs: Record<string, RecordingImportJob> = {}
      for (const [jobId, rawJob] of Object.entries(rawJobs as Record<string, unknown>)) {
        const job = normalizedRecordingImportJob(rawJob)
        if (job !== undefined && job.jobId === jobId && String(job.userId) === userId) jobs[jobId] = job
      }
      if (Object.keys(jobs).length > 0) recordingImportJobsByUser[userId] = jobs
    }
  }
  return {
    version: 2,
    uniqueCode: typeof source.uniqueCode === 'string' && source.uniqueCode.trim() !== ''
      ? source.uniqueCode
      : randomUUID(),
    pendingByUser,
    longArticleDraftsByUser,
    recordReeditDraftsByUser,
    recordReeditSubmissionsByUser,
    recordReeditDraftRevision: source.recordReeditDraftRevision === undefined
      ? legacyRecordReeditRevision(recordReeditDraftsByUser, recordReeditSubmissionsByUser)
      : Number.isSafeInteger(source.recordReeditDraftRevision) && (source.recordReeditDraftRevision as number) >= 0
        ? Math.max(source.recordReeditDraftRevision as number, legacyRecordReeditRevision(recordReeditDraftsByUser, recordReeditSubmissionsByUser))
        : source.recordReeditDraftRevision,
    recordingImportJobsByUser,
  }
}

function recordReeditDraftEntries(state: PersistedState, userId: number): Record<string, ArkmeRecordReeditDraft> {
  const unavailable = () => new Error('本地重新编辑草稿状态损坏，证据已保留，请勿覆盖或删除')
  const collection = state.recordReeditDraftsByUser
  if (collection === null || typeof collection !== 'object' || Array.isArray(collection)) throw unavailable()
  const entries = (collection as Record<string, unknown>)[String(userId)]
  if (entries === undefined) return {}
  if (entries === null || typeof entries !== 'object' || Array.isArray(entries)) throw unavailable()
  const drafts: Record<string, ArkmeRecordReeditDraft> = {}
  for (const [key, raw] of Object.entries(entries)) {
    const draft = normalizedRecordReeditDraft(raw)
    if (!draft || key !== recordReeditDraftKey(draft.sourceIdentityKey, draft.itemUid)) throw unavailable()
    drafts[key] = draft
  }
  return drafts
}

function recordReeditSubmissionEntries(state: PersistedState, userId: number): Record<string, ArkmeRecordReeditSubmission> {
  const unavailable = () => new Error('本地重新编辑提交状态损坏，证据已保留，请勿重复提交')
  const collection = state.recordReeditSubmissionsByUser
  if (collection === null || typeof collection !== 'object' || Array.isArray(collection)) throw unavailable()
  const entries = (collection as Record<string, unknown>)[String(userId)]
  if (entries === undefined) return {}
  if (entries === null || typeof entries !== 'object' || Array.isArray(entries)) throw unavailable()
  for (const [key, raw] of Object.entries(entries)) {
    if (!validRecordReeditSubmission(raw, userId, key)) throw unavailable()
  }
  return entries as Record<string, ArkmeRecordReeditSubmission>
}

function validRecordReeditSubmission(raw: unknown, userId: number, key: string): raw is ArkmeRecordReeditSubmission {
  if (!raw || typeof raw !== 'object') return false
  const job = raw as ArkmeRecordReeditSubmission
  const draft = normalizedRecordReeditDraft(job.draft)
  if (!draft || typeof job.submissionId !== 'string' || job.submissionId === '' || !job.context
    || job.context.expectedUserId !== userId || job.context.itemUid !== draft.itemUid
    || job.context.sourceIdentityKey !== draft.sourceIdentityKey
    || job.context.baseVersion !== draft.baseVersion || job.context.draftRevision !== draft.draftRevision
    || job.context.baseContentFingerprint !== draft.baseContentFingerprint
    || key !== recordReeditDraftKey(job.context.sourceIdentityKey, job.context.itemUid)
    || !Array.isArray(job.attachments)) return false
  if ((job.error !== undefined && typeof job.error !== 'string')
    || (job.voiceFileAssetUid !== undefined && typeof job.voiceFileAssetUid !== 'string')) return false
  if (job.voiceBlock !== undefined && (!job.voiceBlock || job.voiceBlock.kind !== 'audio'
    || !job.voiceFileAssetUid || job.voiceBlock.fileAssetUid !== job.voiceFileAssetUid
    || typeof job.voiceBlock.mediaRef !== 'string' || typeof job.voiceBlock.fileName !== 'string'
    || typeof job.voiceBlock.mimeType !== 'string' || !Number.isFinite(job.voiceBlock.size) || job.voiceBlock.size < 0)) return false
  try {
    parseArkmeRecordReeditAttachments(job.attachments.map(attachment => attachment.selection))
    for (const attachment of job.attachments) {
      const file = attachment.localFile ?? attachment.asset
      if (!file || typeof file.fileName !== 'string' || typeof file.mimeType !== 'string'
        || !Number.isFinite(file.size) || file.size < 0 || ![1, 2, 3, 4].includes(file.fileKind)
        || (attachment.localFile !== undefined) === (attachment.asset !== undefined)) return false
      if (attachment.localFile ? attachment.localFile.fileRef !== attachment.selection.fileRef
        : attachment.asset?.fileAssetUid !== attachment.selection.fileAssetUid) return false
      if (attachment.block !== undefined && (!attachment.block || typeof attachment.block !== 'object'
        || Array.isArray(attachment.block) || typeof attachment.block.kind !== 'string')) return false
    }
  } catch { return false }
  if (job.expectedCommittedFingerprint !== undefined && !/^[a-f0-9]{64}$/.test(job.expectedCommittedFingerprint)) return false
  switch (job.state) {
    case 'committed': return job.result?.status === 'committed' && job.result.itemUid === draft.itemUid
      && job.result.version === draft.baseVersion + 1 && typeof job.result.revisionUid === 'string'
    case 'committing':
    case 'uncertain': return typeof job.expectedCommittedFingerprint === 'string' && job.result === undefined
    case 'pending':
    case 'failed': return job.result === undefined
    default: return false
  }
}

export class ArkmeStateStore {
  private readonly path: string
  private state: PersistedState | undefined
  private queue: Promise<void> = Promise.resolve()

  constructor(directory: string) {
    this.path = join(directory, 'state.json')
  }

  async uniqueCode(): Promise<string> {
    return await this.read(state => state.uniqueCode)
  }

  async listPending(userId: number): Promise<ArkmePendingWrite[]> {
    return await this.read(state => [...(state.pendingByUser[String(userId)] ?? [])])
  }

  async putPending(userId: number, pending: ArkmePendingWrite): Promise<void> {
    await this.update(state => {
      const key = String(userId)
      const current = state.pendingByUser[key] ?? []
      const next = current.filter(item => item.recordUid !== pending.recordUid)
      next.push(pending)
      state.pendingByUser[key] = next
    })
  }

  async getLongArticleDraft(userId: number, sourceRef: string, itemUid?: string): Promise<ArkmeLongArticleDraft | undefined> {
    return await this.read(state => {
      const draft = state.longArticleDraftsByUser[String(userId)]?.[longArticleDraftKey(sourceRef, itemUid)]
      return draft === undefined ? undefined : { ...draft }
    })
  }

  async putLongArticleDraft(userId: number, draft: ArkmeLongArticleDraft): Promise<void> {
    await this.update(state => {
      const userKey = String(userId)
      const drafts = state.longArticleDraftsByUser[userKey] ?? {}
      drafts[longArticleDraftKey(draft.sourceRef, draft.itemUid)] = { ...draft }
      state.longArticleDraftsByUser[userKey] = drafts
    })
  }

  async getRecordReeditDraft(
    userId: number,
    sourceIdentityKey: string,
    itemUid: string,
  ): Promise<ArkmeRecordReeditDraft | undefined> {
    return await this.read(state => {
      const draft = recordReeditDraftEntries(state, userId)[
        recordReeditDraftKey(sourceIdentityKey, itemUid)
      ]
      return draft === undefined ? undefined : structuredClone(draft)
    })
  }

  async putRecordReeditDraft(
    userId: number,
    input: Omit<ArkmeRecordReeditDraft, 'draftRevision'>,
    expectedRevision?: number,
  ): Promise<ArkmeRecordReeditDraft> {
    const normalized = normalizedRecordReeditDraft({ ...input, draftRevision: 1 })
    if (normalized === undefined) throw new Error('Record re-edit draft is invalid')
    let stored!: ArkmeRecordReeditDraft
    await this.update(state => {
      const userKey = String(userId)
      const drafts = recordReeditDraftEntries(state, userId)
      const key = recordReeditDraftKey(normalized.sourceIdentityKey, normalized.itemUid)
      const current = drafts[key]
      if (expectedRevision !== undefined && expectedRevision !== (current?.draftRevision ?? 0)) {
        throw new ArkmeRecordReeditDraftConflict('Record re-edit draft changed')
      }
      const sameCandidate = current !== undefined && sameRecordReeditCandidate(current, normalized)
      if (!Number.isSafeInteger(state.recordReeditDraftRevision) || (state.recordReeditDraftRevision as number) < 0
        || (state.recordReeditDraftRevision as number) >= Number.MAX_SAFE_INTEGER) throw new Error('本地编辑版本分配器不可用，草稿已保留')
      if (!sameCandidate) state.recordReeditDraftRevision = (state.recordReeditDraftRevision as number) + 1
      stored = {
        ...normalized,
        draftRevision: sameCandidate ? current.draftRevision : state.recordReeditDraftRevision as number,
      }
      drafts[key] = stored
      const collection = state.recordReeditDraftsByUser as Record<string, unknown>
      collection[userKey] = drafts
    })
    return structuredClone(stored)
  }

  async recordReeditFileRefs(userId: number): Promise<string[]> {
    return await this.read(state => [...Object.values(recordReeditDraftEntries(state, userId)),
      ...Object.values(recordReeditSubmissionEntries(state, userId)).map(job => job.draft)]
      .flatMap(draft => draft.attachments?.flatMap(item => item.fileRef === undefined ? [] : [item.fileRef]) ?? []))
  }

  async listRecordReeditSubmissions(userId: number): Promise<ArkmeRecordReeditSubmission[]> {
    return await this.read(state => structuredClone(Object.values(recordReeditSubmissionEntries(state, userId))))
  }

  async acknowledgeRecordReeditSubmission(userId: number, identity: string, submissionId: string, version: number): Promise<void> {
    await this.update(state => {
      const entries = recordReeditSubmissionEntries(state, userId)
      for (const [key, job] of Object.entries(entries)) {
        if (job.context.sourceIdentityKey === identity && job.submissionId === submissionId
          && job.state === 'committed' && job.result && version >= job.result.version) delete entries[key]
      }
    })
  }

  async putRecordReeditSubmission(userId: number, job: ArkmeRecordReeditSubmission, expectedId?: string): Promise<void> {
    await this.update(state => {
      const entries = recordReeditSubmissionEntries(state, userId)
      const key = recordReeditDraftKey(job.context.sourceIdentityKey, job.context.itemUid)
      if (entries[key]?.submissionId !== expectedId) throw new ArkmeRecordReeditDraftConflict('提交状态已变化，请重新读取')
      if (!validRecordReeditSubmission(job, userId, key)) throw new Error('本地重新编辑提交状态损坏，请勿重复提交')
      entries[key] = structuredClone(job)
      const collection = state.recordReeditSubmissionsByUser as Record<string, unknown>
      collection[String(userId)] = entries
      if (job.state === 'committed') {
        const drafts = recordReeditDraftEntries(state, userId)
        if (drafts[key] && sameRecordReeditDraft(drafts[key]!, job.draft)) {
          delete drafts[key]
          const draftCollection = state.recordReeditDraftsByUser as Record<string, unknown>
          if (Object.keys(drafts).length === 0) delete draftCollection[String(userId)]
          else draftCollection[String(userId)] = drafts
        }
      }
    })
  }

  async discardRecordReeditCandidate(userId: number, sourceIdentityKey: string, itemUid: string, expectedRevision: number): Promise<boolean> {
    let removed = false
    await this.update(state => {
      const key = recordReeditDraftKey(sourceIdentityKey, itemUid)
      const drafts = recordReeditDraftEntries(state, userId)
      if (drafts[key]?.draftRevision !== expectedRevision) return
      const entries = recordReeditSubmissionEntries(state, userId)
      const job = entries[key]
      if (job && ['pending', 'committing', 'uncertain'].includes(job.state)) throw new ArkmeRecordReeditDraftConflict('这条快记仍在保存或核对，暂不能放弃')
      if (job?.state === 'failed') delete entries![key]
      delete drafts[key]
      const collection = state.recordReeditDraftsByUser as Record<string, unknown>
      collection[String(userId)] = drafts
      removed = true
    })
    return removed
  }

  async removeRecordReeditDraft(
    userId: number,
    sourceIdentityKey: string,
    itemUid: string,
    expectedRevision: number,
    expectedCandidate?: ArkmeRecordReeditDraft,
  ): Promise<boolean> {
    let removed = false
    await this.update(state => {
      const userKey = String(userId)
      const drafts = recordReeditDraftEntries(state, userId)
      const key = recordReeditDraftKey(sourceIdentityKey, itemUid)
      if (drafts[key]?.draftRevision !== expectedRevision) return
      const current = drafts[key]!
      if (expectedCandidate && !sameRecordReeditDraft(current, expectedCandidate)) return
      delete drafts[key]
      const collection = state.recordReeditDraftsByUser as Record<string, unknown>
      if (Object.keys(drafts).length === 0) delete collection[userKey]
      else collection[userKey] = drafts
      removed = true
    })
    return removed
  }

  async listRecordingImportJobs(userId: number): Promise<RecordingImportJob[]> {
    return await this.read(state => Object.values(state.recordingImportJobsByUser[String(userId)] ?? {})
      .map(cloneRecordingImportJob))
  }

  async listAllRecordingImportJobs(): Promise<RecordingImportJob[]> {
    return await this.read(state => Object.values(state.recordingImportJobsByUser)
      .flatMap(jobs => Object.values(jobs).map(cloneRecordingImportJob)))
  }

  async getRecordingImportJob(userId: number, jobId: string): Promise<RecordingImportJob | undefined> {
    return await this.read(state => {
      const job = state.recordingImportJobsByUser[String(userId)]?.[jobId]
      return job === undefined ? undefined : cloneRecordingImportJob(job)
    })
  }

  async putRecordingImportJob(userId: number, job: RecordingImportJob): Promise<void> {
    if (job.userId !== userId) throw new Error('Recording import job account mismatch')
    await this.update(state => {
      const jobs = state.recordingImportJobsByUser[String(userId)] ?? {}
      jobs[job.jobId] = cloneRecordingImportJob(job)
      pruneRecordingImportTerminalJobs(jobs)
      state.recordingImportJobsByUser[String(userId)] = jobs
    })
  }

  async admitRecordingImportJob(
    userId: number,
    job: RecordingImportJob,
    unresolvedLimit: number,
    signal?: AbortSignal,
  ): Promise<RecordingImportAdmission> {
    if (job.userId !== userId) throw new Error('Recording import job account mismatch')
    if (!Number.isSafeInteger(unresolvedLimit) || unresolvedLimit < 1) {
      throw new Error('Recording import unresolved limit must be a positive integer')
    }
    let admission: RecordingImportAdmission | undefined
    await this.update(state => {
      const jobs = state.recordingImportJobsByUser[String(userId)] ?? {}
      const unresolved = Object.values(jobs)
        .filter(isUnresolvedRecordingImportJob)
      const existing = unresolved.find(candidate => sameRecordingImportIdentity(candidate, job))
      if (existing !== undefined) {
        admission = { kind: 'existing', job: cloneRecordingImportJob(existing) }
        return
      }
      const fileNameKey = recordingImportFileNameKey(job.fileName)
      if (unresolved.some(candidate => recordingImportFileNameKey(candidate.fileName) === fileNameKey)) {
        admission = { kind: 'duplicate-file-name' }
        return
      }
      if (unresolved.length >= unresolvedLimit) {
        admission = { kind: 'limit' }
        return
      }
      jobs[job.jobId] = cloneRecordingImportJob(job)
      pruneRecordingImportTerminalJobs(jobs)
      state.recordingImportJobsByUser[String(userId)] = jobs
      admission = { kind: 'inserted', job: cloneRecordingImportJob(job) }
    }, signal)
    if (admission === undefined) throw new Error('Recording import admission was not decided')
    return admission
  }

  async replaceRecordingImportJob(
    userId: number,
    job: RecordingImportJob,
    expectedRevision: number,
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (job.userId !== userId) throw new Error('Recording import job account mismatch')
    let replaced = false
    await this.update(state => {
      const current = state.recordingImportJobsByUser[String(userId)]?.[job.jobId]
      if (current?.revision !== expectedRevision) return
      const jobs = state.recordingImportJobsByUser[String(userId)]!
      jobs[job.jobId] = cloneRecordingImportJob(job)
      pruneRecordingImportTerminalJobs(jobs)
      replaced = true
    }, signal)
    return replaced
  }

  async removeRecordingImportJob(userId: number, jobId: string): Promise<void> {
    await this.update(state => {
      const userKey = String(userId)
      const jobs = state.recordingImportJobsByUser[userKey]
      if (jobs === undefined) return
      delete jobs[jobId]
      if (Object.keys(jobs).length === 0) delete state.recordingImportJobsByUser[userKey]
    })
  }

  async removeLongArticleDraft(userId: number, sourceRef: string, itemUid?: string): Promise<void> {
    await this.update(state => {
      const userKey = String(userId)
      const drafts = state.longArticleDraftsByUser[userKey]
      if (drafts === undefined) return
      delete drafts[longArticleDraftKey(sourceRef, itemUid)]
      if (Object.keys(drafts).length === 0) delete state.longArticleDraftsByUser[userKey]
    })
  }

  async markAttempt(userId: number, recordUid: string, error: string): Promise<void> {
    await this.update(state => {
      const pending = state.pendingByUser[String(userId)] ?? []
      const item = pending.find(candidate => candidate.recordUid === recordUid)
      if (item === undefined) return
      item.attempts += 1
      item.lastError = error.slice(0, 500)
    })
  }

  async removePending(userId: number, recordUid: string): Promise<void> {
    await this.update(state => {
      const key = String(userId)
      const next = (state.pendingByUser[key] ?? []).filter(item => item.recordUid !== recordUid)
      if (next.length === 0) {
        delete state.pendingByUser[key]
      } else {
        state.pendingByUser[key] = next
      }
    })
  }

  private async read<T>(reader: (state: PersistedState) => T): Promise<T> {
    let result!: T
    await this.serial(async () => {
      const state = await this.load()
      result = reader(state)
    })
    return result
  }

  private async update(mutator: (state: PersistedState) => void, signal?: AbortSignal): Promise<void> {
    await this.serial(async () => {
      signal?.throwIfAborted()
      const state = structuredClone(await this.load())
      signal?.throwIfAborted()
      mutator(state)
      await this.write(state, signal)
    })
  }

  private async serial(work: () => Promise<void>): Promise<void> {
    const next = this.queue.then(work, work)
    this.queue = next.then(() => undefined, () => undefined)
    await next
  }

  private async load(): Promise<PersistedState> {
    if (this.state !== undefined) return this.state
    try {
      this.state = parseState(await readFile(this.path, 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await this.write(emptyState())
    }
    return this.state!
  }

  private async write(state: PersistedState, signal?: AbortSignal): Promise<void> {
    const directory = dirname(this.path)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await securePrivateDirectory(directory)
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, `${JSON.stringify(state, undefined, 2)}\n`, { mode: 0o600 })
      await securePrivateFile(temporary)
      signal?.throwIfAborted()
      // Rename commits the private file; publish memory only after that succeeds.
      await rename(temporary, this.path)
      this.state = state
    } catch (error) {
      await unlink(temporary).catch(() => undefined)
      throw error
    }
  }
}
