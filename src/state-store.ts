import { RECORDING_STRATEGIES, type RecordingStrategy } from './recording-strategy-contract.js'
import { sameArkoTurnIntent, isValidArkoPendingTurn, validArkoStoredTurn, type ArkmeArkoPendingTurn, type ArkmeArkoStoredTurn } from './arko-turn-contract.js'
import type { OfflineContextJournalEntry } from "./offline-context-contract.js"
import { sameRecordingImportBatch, validRecordingCreateRequestUID } from './recording-import-identity.js'
import { validRecordingImportBatch } from './recording-workflow-contract.js'
import { ArrangementBoardCacheStore } from './arrangement-board-cache-store.js'
import type { ArkmeArrangementBoardCachePages } from './arrangement-board-cache.js'
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
  validRecordingImportTaskId,
  RecordingImportContractError,
  isUnresolvedRecordingImportJob,
  type RecordingImportAdmission,
  type RecordingImportJob,
  type RecordingImportPhase,
} from './recording-import-contract.js'
import { recordingImportFileNameKey } from './recording-import-shared.js'
import { securePrivateDirectory, securePrivateFile } from './private-filesystem.js'
import { ArkmeRecordReeditDraftConflict, parseArkmeRecordReeditMentions, parseArkmeRecordReeditAttachments } from './record-reedit-contract.js'
import type { ArkmeRecordReeditSubmission } from './record-reedit-contract.js'

export interface ArkmeCancellationCompletion {
  userId: number
  sessionHash: string
  result: import('./types.js').ArkmeCancellationSnapshot
}

interface PersistedState {
  recordingVoiceDrafts?: unknown
 teamOutboundByAccount?: Record<string, Record<string, import('./team-outbound-contract.js').TeamOutboundRecovery>>
  teamMemberAdditions?: unknown
  recordingToolBatches?: unknown
  recordingImportStrategiesByAccount?: unknown
arkoTurnsByUser?: unknown
  dayReviewPending?: unknown
 offlineContextJournal?: unknown
  cancellationCompletion?: ArkmeCancellationCompletion

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

function offlineContextJournalScope(state:PersistedState,scope:string):Record<string,OfflineContextJournalEntry> {
 const fail=()=>new Error('本地上下文操作记录损坏，已保留恢复信息')
 if(!/^[a-z_-]+:[1-9][0-9]*$/u.test(scope)) throw fail()
 if(state.offlineContextJournal===undefined)state.offlineContextJournal={}
 const journal=state.offlineContextJournal
 if(!journal || typeof journal!=='object' || Array.isArray(journal))throw fail()
 const scoped=journal as Record<string,unknown>
 if(scoped[scope]===undefined)scoped[scope]={}
 const entries=scoped[scope]
 if(!entries || typeof entries!=='object' || Array.isArray(entries))throw fail()
 for(const value of Object.values(entries)) {
  if(!value || typeof value!=='object' || typeof value.fingerprint!=='string' || typeof value.sealed!=='string' || value.expiresAtMillis!==undefined && !Number.isSafeInteger(value.expiresAtMillis))throw fail()
 }
 return entries as Record<string,OfflineContextJournalEntry>
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
    .filter(candidate => !isUnresolvedRecordingImportJob(candidate) && (!candidate.clientTaskId || candidate.createdAtMillis < Date.now() - 30 * 24 * 60 * 60_000))
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
  const recordingKind = source.recordingKind === undefined ? 0 : source.recordingKind
  if (recordingKind !== 0 && recordingKind !== 1 && recordingKind !== 3) return undefined
  if (source.strategy !== undefined && !RECORDING_STRATEGIES.some(strategy => strategy.id === source.strategy)) {
    throw new Error('本地录音处理策略损坏，已保留恢复信息')
  }
  return {
    jobId: source.jobId as string,
    ...(typeof source.clientTaskId === 'string' ? { clientTaskId: source.clientTaskId } : {}),
    ...(validRecordingImportBatch(source.batch) ? { batch: { ...source.batch } } : {}),
    ...(validRecordingCreateRequestUID(source.createRequestUID) ? { createRequestUID: source.createRequestUID } : {}),
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
    recordingKind,
    ...(source.strategy === undefined ? {} : { strategy: source.strategy as RecordingStrategy }),
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
    // Invalid persisted batch metadata must never silently become an ordinary upload.
    ...(source.batch !== undefined && !validRecordingImportBatch(source.batch) && !['accepted', 'cancelled'].includes(source.phase)
      ? { phase: 'failed' as const, retryable: false, errorCode: 'recording-import-batch-invalid', errorMessage: '导入批次数据无效，请重新选择未上传的文件', failedFromPhase: undefined }
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
    ...(typeof source.sendAtMillis==='number'&&Number.isSafeInteger(source.sendAtMillis)&&source.sendAtMillis>0?{sendAtMillis:source.sendAtMillis}:{}),
    ...(typeof source.draftScope==='string'&&source.draftScope.length<=256?{draftScope:source.draftScope}:{}),
    ...(source.autoPublish === true ? { autoPublish: true } : {}),
    ...(itemUid === undefined ? {} : { itemUid }),
    ...(typeof source.baseVersion === 'number' && Number.isSafeInteger(source.baseVersion) && source.baseVersion > 0 ? { baseVersion: source.baseVersion } : {}),
    ...(source.textFormat === 'markdown' || source.textFormat === 'plain' ? { textFormat: source.textFormat } : {}),
    ...(source.document && typeof source.document === 'object' && !Array.isArray(source.document) ? { document: source.document as Record<string, unknown> } : {}),
    ...(Array.isArray(source.images) ? { images: source.images.filter((x): x is import('./types.js').ArkmeLongArticleImage => x && typeof x === 'object' && (typeof x.fileRef === 'string' || typeof x.fileAssetUid === 'string')) } : {}),
    ...(typeof source.recordUid === 'string' ? { recordUid: source.recordUid } : {}),
    ...(typeof source.relationUid === 'string' ? { relationUid: source.relationUid } : {}),
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

function longArticleDraftKey(sourceRef: string, itemUid?: string, draftScope?:string): string {
  return `${sourceRef}\u0000${itemUid ?? ''}${draftScope?`\u0000${draftScope}`:''}`
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
  let mentions: ArkmeRecordReeditDraft['mentions']
  let attachments: ArkmeRecordReeditDraft['attachments']
  try {
    if (source.mentions !== undefined) mentions = parseArkmeRecordReeditMentions(source.mentions)
    if (source.attachments !== undefined) attachments = parseArkmeRecordReeditAttachments(source.attachments)
  } catch { return undefined }
  return {
    schemaVersion: 1,
    draftRevision: source.draftRevision as number,
    sourceIdentityKey,
    lastSourceRef,
    itemUid,
    ...(typeof source.baseVersion === 'number' && Number.isSafeInteger(source.baseVersion) && source.baseVersion > 0 ? { baseVersion: source.baseVersion } : {}),
    ...(source.textFormat === 'markdown' || source.textFormat === 'plain' ? { textFormat: source.textFormat } : {}),
    ...(source.document && typeof source.document === 'object' && !Array.isArray(source.document) ? { document: source.document as Record<string, unknown> } : {}),
    ...(Array.isArray(source.images) ? { images: source.images.filter((x): x is import('./types.js').ArkmeLongArticleImage => x && typeof x === 'object' && (typeof x.fileRef === 'string' || typeof x.fileAssetUid === 'string')) } : {}),
    ...(typeof source.recordUid === 'string' ? { recordUid: source.recordUid } : {}),
    ...(typeof source.relationUid === 'string' ? { relationUid: source.relationUid } : {}),
    title: source.title.slice(0, 100),
    textContent: source.textContent.slice(0, 40000),
    ...(mentions === undefined ? {} : { mentions }),
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
    && JSON.stringify(left.mentions) === JSON.stringify(right.mentions)
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

function validCancellationCompletion(value: unknown): value is ArkmeCancellationCompletion {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as ArkmeCancellationCompletion
  const result = candidate.result
  return Number.isSafeInteger(candidate.userId) && candidate.userId > 0
    && typeof candidate.sessionHash === 'string' && /^[a-f0-9]{64}$/.test(candidate.sessionHash)
    && result != null && ['immediate', 'waiting'].includes(result.mode)
    && ['done', 'waiting'].includes(result.status) && Number.isSafeInteger(result.cancel_at)
    && typeof result.has_phone === 'boolean'
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
    arkoTurnsByUser: source.arkoTurnsByUser ?? {},
    version: 2,
    uniqueCode: typeof source.uniqueCode === 'string' && source.uniqueCode.trim() !== ''
      ? source.uniqueCode
      : randomUUID(),
    ...(validCancellationCompletion(source.cancellationCompletion) ? { cancellationCompletion: source.cancellationCompletion } : {}),
    offlineContextJournal:source.offlineContextJournal,
 ...(source.teamOutboundByAccount === undefined ? {} : {teamOutboundByAccount:source.teamOutboundByAccount as NonNullable<PersistedState['teamOutboundByAccount']>}),
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
    recordingToolBatches: source.recordingToolBatches,
    recordingImportStrategiesByAccount: source.recordingImportStrategiesByAccount,
    dayReviewPending: source.dayReviewPending ?? {},
    teamMemberAdditions: source.teamMemberAdditions,
    recordingVoiceDrafts: source.recordingVoiceDrafts,
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
  async recordingVoiceDraft(scope: string, change?: import('./recording-voice-trigger-contract.js').RecordingVoiceDraft): Promise<import('./recording-voice-trigger-contract.js').RecordingVoiceDraft> {
    const { defaultRecordingVoiceRule, recordingVoiceRules } = await import('./recording-voice-trigger-contract.js')
    if (!/^[a-z_-]+:[1-9][0-9]*$/u.test(scope)) throw new Error('语音触发账号无效')
    const access = (state: PersistedState) => {
      const root = state.recordingVoiceDrafts ?? {}
      if (!root || typeof root !== 'object' || Array.isArray(root)) throw new Error('语音触发配置损坏，已保留原数据')
      const entries = root as Record<string, import('./recording-voice-trigger-contract.js').RecordingVoiceDraft>
      const prior = entries[scope] ?? { revision: 0, rules: [defaultRecordingVoiceRule()] }
      if (!Number.isSafeInteger(prior.revision) || prior.revision < 0) throw new Error('语音触发配置损坏，已保留原数据')
      const rules = recordingVoiceRules(prior.rules)
      if (!change) return { revision: prior.revision, rules }
      if (change.revision !== prior.revision) throw new Error('规则已在其他窗口修改，请重新读取后保存')
      const next = { revision: prior.revision + 1, rules: recordingVoiceRules(change.rules) }
      entries[scope] = next; state.recordingVoiceDrafts = entries
      return structuredClone(next)
    }
    if (!change) return this.read(access)
    let result!: import('./recording-voice-trigger-contract.js').RecordingVoiceDraft
    await this.update(state => { result = access(state) })
    return result
  }
  private readonly boardCache: ArrangementBoardCacheStore
  private readonly path: string
  private state: PersistedState | undefined
  private queue: Promise<void> = Promise.resolve()

  constructor(directory: string) {
    this.path = join(directory, 'state.json')
    this.boardCache = new ArrangementBoardCacheStore(directory)
  }

  private arkoTurns(state: PersistedState, userId: number): Record<string, ArkmeArkoStoredTurn> {
    if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('Arko 账号无效')
    const root = state.arkoTurnsByUser ?? {}
    if (!root || typeof root !== 'object' || Array.isArray(root)) throw new Error('Arko 发送恢复数据损坏')
    const accounts = root as Record<string, unknown>
    const values = accounts[String(userId)] ?? {}
    if (!values || typeof values !== 'object' || Array.isArray(values)
      || Object.entries(values).some(([uid, entry]) => !validArkoStoredTurn(entry, userId, uid))) {
      throw new Error('Arko 发送恢复数据损坏')
    }
    accounts[String(userId)] = values
    state.arkoTurnsByUser = root
    return values as Record<string, ArkmeArkoStoredTurn>
  }

  async arkoPendingTurns(userId: number): Promise<ArkmeArkoPendingTurn[]> {
    return this.read(state => Object.values(this.arkoTurns(state, userId))
      .map(value => structuredClone(value.turn))
      .sort((left, right) => left.createdAtMillis - right.createdAtMillis))
  }

  async arkoTurn(userId: number, uid: string): Promise<ArkmeArkoStoredTurn | undefined> {
    return this.read(state => structuredClone(this.arkoTurns(state, userId)[uid]))
  }

  async prepareArkoTurn(userId: number, turn: ArkmeArkoPendingTurn, request?: Record<string, unknown>): Promise<void> {
    if (!isValidArkoPendingTurn(turn, userId)) throw new Error('Arko 发送恢复参数无效')
    await this.update(state => {
      const values = this.arkoTurns(state, userId)
      const existing = values[turn.clientTurnUid]
      if (existing && !sameArkoTurnIntent(existing.turn, turn)) throw new Error('Arko 轮次标识已用于其他内容')
      if (existing?.request && request && JSON.stringify(existing.request) !== JSON.stringify(request)) {
        throw new Error('Arko 请求已冻结，不能修改')
      }
      if (!existing && Object.keys(values).length >= 20) throw new Error('Arko 待确认消息过多，请先处理原消息')
      const frozenRequest = request ?? existing?.request
      const next = {
        turn: structuredClone(existing?.turn ?? turn),
        ...(frozenRequest === undefined ? {} : { request: structuredClone(frozenRequest) }),
      }
      if (!validArkoStoredTurn(next, userId, turn.clientTurnUid)) throw new Error('Arko 请求恢复数据无效')
      values[turn.clientTurnUid] = next
    })
  }

  async acknowledgeArkoTurn(userId: number, uid: string): Promise<void> {
    await this.update(state => { delete this.arkoTurns(state, userId)[uid] })
  }

  async arkoFileRefs(userId: number): Promise<string[]> {
    return this.read(state => Object.values(this.arkoTurns(state, userId))
      .flatMap(value => value.turn.images?.map(file => file.fileRef) ?? []))
  }

  async teamMemberAddition(scope: string, teamId: string, change?: {put: import('./team-member-add-contract.js').TeamMemberAdditionAttempt} | {ack: string}) {
    const access = (state: PersistedState) => {
      const raw = state.teamMemberAdditions ?? {}
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('成员添加恢复记录损坏，已保留原记录')
      state.teamMemberAdditions = raw
      const values = raw as Record<string, import('./team-member-add-contract.js').TeamMemberAdditionAttempt>
      const key = JSON.stringify([scope, teamId]), previous = values[key]
      if (change && 'put' in change) {
        if (previous && JSON.stringify(previous) !== JSON.stringify(change.put)) throw new Error('请先核对原批次的添加结果')
        values[key] = structuredClone(change.put)
      } else if (change && previous?.requestUid === change.ack) delete values[key]
      return structuredClone(values[key])
    }
    if (!change) return this.read(access)
    let result: import('./team-member-add-contract.js').TeamMemberAdditionAttempt | undefined
    await this.update(state => { result = access(state) })
    return result
  }

  private reviewPending(state: PersistedState): Record<string, unknown> {
    const value = state.dayReviewPending ?? {}
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('日回顾提交恢复记录损坏，未创建新任务')
    state.dayReviewPending = value
    return value as Record<string, unknown>
  }
  async readDayReviewPending(scope: string, day: string): Promise<unknown> {
    return this.read(state => structuredClone(this.reviewPending(state)[JSON.stringify([scope, day])]))
  }
  async prepareDayReview(scope: string, day: string, request: Record<string, unknown>): Promise<void> {
    await this.update(state => {
      const values = this.reviewPending(state), key = JSON.stringify([scope, day]), old = values[key]
      if (old !== undefined && JSON.stringify(old) !== JSON.stringify(request)) throw new Error('当天仍有提交结果待核对，请先核对原请求')
      values[key] = structuredClone(request)
    })
  }
  async acknowledgeDayReview(scope: string, day: string, requestId: string): Promise<void> {
    await this.update(state => {
      const values = this.reviewPending(state), key = JSON.stringify([scope, day]), old = values[key]
      if (old && typeof old === 'object' && !Array.isArray(old) && (old as Record<string, unknown>).requestId === requestId) delete values[key]
    })
  }

  async arrangementBoardCache(environment: string, userId: number, pages?: ArkmeArrangementBoardCachePages): Promise<ArkmeArrangementBoardCachePages> {
    return this.boardCache.access(environment, userId, pages)
  }

  async readCancellationCompletion(): Promise<ArkmeCancellationCompletion | undefined> {
    return await this.read(state => state.cancellationCompletion === undefined ? undefined : structuredClone(state.cancellationCompletion))
  }

  async writeCancellationCompletion(completion: ArkmeCancellationCompletion | undefined): Promise<void> {
    if (completion !== undefined && !validCancellationCompletion(completion)) throw new Error('注销完成记录无效')
    await this.update(state => {
      if (completion === undefined) delete state.cancellationCompletion
      else state.cancellationCompletion = structuredClone(completion)
    })
  }

  async uniqueCode(): Promise<string> {
    return await this.read(state => state.uniqueCode)
  }

  async readOfflineContextJournal(scope: string): Promise<Record<string, OfflineContextJournalEntry>> {
    return this.read(state => structuredClone(offlineContextJournalScope(state,scope)))
  }
  async putOfflineContextJournal(scope:string,id:string,entry:OfflineContextJournalEntry):Promise<void> {
    await this.update(state=>{
      const entries=offlineContextJournalScope(state,scope)
      const prior=entries[id]
      if(prior && prior.fingerprint!==entry.fingerprint) throw new Error('操作编号已用于其他内容')
      if(prior) return
      for(const [key,value] of Object.entries(entries)) if(value.expiresAtMillis!==undefined && value.expiresAtMillis<Date.now()) delete entries[key]
      if(Object.keys(entries).length>=64) throw new Error('请先核对尚未完成的操作')
      entries[id]=structuredClone(entry)
    })
  }
  async deleteOfflineContextJournal(scope:string,id:string,fingerprint:string):Promise<void> {
    await this.update(state=>{const entries=offlineContextJournalScope(state,scope);if(entries[id]?.fingerprint===fingerprint)delete entries[id]})
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

  async getLongArticleDraft(userId: number, sourceRef: string, itemUid?: string, draftScope?:string): Promise<ArkmeLongArticleDraft | undefined> {
    return await this.read(state => {
      const draft = state.longArticleDraftsByUser[String(userId)]?.[longArticleDraftKey(sourceRef, itemUid, draftScope)]
      return draft === undefined ? undefined : { ...draft }
    })
  }

  async putLongArticleDraft(userId: number, draft: ArkmeLongArticleDraft): Promise<void> {
    await this.update(state => {
      const userKey = String(userId)
      const drafts = state.longArticleDraftsByUser[userKey] ?? {}
      drafts[longArticleDraftKey(draft.sourceRef, draft.itemUid, draft.draftScope)] = { ...draft }
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
      .flatMap(draft => draft.attachments?.flatMap(item => item.fileRef === undefined ? [] : [item.fileRef]) ?? []).concat(Object.values(state.longArticleDraftsByUser[String(userId)] ?? {}).flatMap(draft => draft.images?.flatMap(image => image.fileRef ? [image.fileRef] : []) ?? [])))
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

  /** Freeze native UI strategies without extending the desktop upload headers. */
  async recordingImportStrategies(scope: string, tasks: Array<{ taskId: string; strategy?: RecordingStrategy }>, signal?: AbortSignal): Promise<Record<string, RecordingStrategy>> {
    if (!/^(prod|test):[1-9][0-9]*$/.test(scope) || tasks.length > 10_000
      || new Set(tasks.map(task => task.taskId)).size !== tasks.length
      || tasks.some(task => !validRecordingImportTaskId(task.taskId)
        || task.strategy !== undefined && !RECORDING_STRATEGIES.some(value => value.id === task.strategy))) {
      throw new RecordingImportContractError('recording-import-task-invalid', '录音导入任务或策略无效')
    }
    const access = (state: PersistedState): Record<string, RecordingStrategy> => {
      const root = state.recordingImportStrategiesByAccount === undefined ? {} : state.recordingImportStrategiesByAccount
      if (!root || typeof root !== 'object' || Array.isArray(root)) throw new Error('录音导入策略记录损坏，已保留恢复信息')
      const accounts = root as Record<string, unknown>
      const stored = accounts[scope] === undefined ? {} : accounts[scope]
      if (!stored || typeof stored !== 'object' || Array.isArray(stored)) throw new Error('录音导入策略记录损坏，已保留恢复信息')
      const entries: Record<string, RecordingStrategy> = {}
      for (const [taskId, strategy] of Object.entries(stored)) {
        if (!RECORDING_STRATEGIES.some(value => value.id === strategy)) throw new Error('录音导入策略记录损坏，已保留恢复信息')
        if (validRecordingImportTaskId(taskId)) entries[taskId] = strategy as RecordingStrategy
      }
      for (const task of tasks) if (task.strategy !== undefined) {
        if (entries[task.taskId] !== undefined && entries[task.taskId] !== task.strategy) {
          throw new RecordingImportContractError('recording-import-task-conflict', '此导入任务的处理策略已固定，请保留原策略重试')
        }
        entries[task.taskId] = task.strategy
      }
      if (tasks.some(task => task.strategy !== undefined)) {
        accounts[scope] = entries
        state.recordingImportStrategiesByAccount = accounts
      }
      return Object.fromEntries(tasks.flatMap(task => entries[task.taskId] === undefined ? [] : [[task.taskId, entries[task.taskId]!]]))
    }
    if (!tasks.some(task => task.strategy !== undefined)) return await this.read(access)
    let result: Record<string, RecordingStrategy> = {}
    await this.update(state => { result = access(state) }, signal)
    return result
  }

  async planRecordingToolBatch(scope: string, candidates: Array<{ key: string; isNew: boolean; strategy?: import('./recording-strategy-contract.js').RecordingStrategy }>, timeZone: string, signal?: AbortSignal) {
    const { planRecordingToolBatch } = await import('./recording-tool-batch.js')
    let members: Record<string, import('./recording-tool-batch.js').RecordingToolBatchMember> = {}
    await this.update(state => {
      if (!/^[a-z_-]+:[1-9][0-9]*$/.test(scope)) throw new Error('录音批次账号无效')
      const root = state.recordingToolBatches ?? {}
      if (!root || typeof root !== 'object' || Array.isArray(root)) throw new Error('录音导入批次记录损坏，已保留原记录')
      const accounts = root as Record<string, unknown>
      const plan = planRecordingToolBatch(accounts[scope], candidates, timeZone)
      accounts[scope] = plan.journal
      state.recordingToolBatches = accounts
      members = structuredClone(plan.members)
    }, signal)
    return members
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
    signal?: AbortSignal,
  ): Promise<RecordingImportAdmission> {
    if (job.userId !== userId) throw new Error('Recording import job account mismatch')
    let admission: RecordingImportAdmission | undefined
    await this.update(state => {
      const jobs = state.recordingImportJobsByUser[String(userId)] ?? {}
      const unresolved = Object.values(jobs)
        .filter(isUnresolvedRecordingImportJob)
      const receipt = job.clientTaskId ? Object.values(jobs).find(candidate => candidate.clientTaskId === job.clientTaskId) : undefined
      if (receipt && (!sameRecordingImportIdentity(receipt, job) || receipt.recordingKind !== job.recordingKind || !sameRecordingImportBatch(receipt.batch, job.batch))) throw new Error('Recording import task identity conflict')
      const existing = receipt ?? unresolved.find(candidate => sameRecordingImportIdentity(candidate, job) && candidate.recordingKind === job.recordingKind && sameRecordingImportBatch(candidate.batch, job.batch))
      if (existing !== undefined) {
        admission = { kind: 'existing', job: cloneRecordingImportJob(existing) }
        return
      }
      const fileNameKey = recordingImportFileNameKey(job.fileName)
      if (unresolved.some(candidate => recordingImportFileNameKey(candidate.fileName) === fileNameKey)) {
        admission = { kind: 'duplicate-file-name' }
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

  async removeLongArticleDraft(userId: number, sourceRef: string, itemUid?: string, expectedRecordUid?: string, draftScope?:string): Promise<void> {
    await this.update(state => {
      const userKey = String(userId)
      const drafts = state.longArticleDraftsByUser[userKey]
      if (drafts === undefined) return
      if (expectedRecordUid !== undefined && drafts[longArticleDraftKey(sourceRef, itemUid, draftScope)]?.recordUid !== expectedRecordUid) return
      delete drafts[longArticleDraftKey(sourceRef, itemUid, draftScope)]
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

  async teamOutboundTarget(scope: string, requestUid: string): Promise<import('./team-outbound-contract.js').TeamOutboundRecovery | undefined> {
    return this.read(state => { const entries=state.teamOutboundByAccount?.[scope]; const value=entries && Object.hasOwn(entries,requestUid) ? entries[requestUid] : undefined; return value ? structuredClone(value) : undefined })
  }
  async retainTeamOutboundTarget(scope: string, requestUid: string, value: import('./team-outbound-contract.js').TeamOutboundRecovery): Promise<void> {
    await this.update(state => {
      const entries=(state.teamOutboundByAccount??={})[scope]??={}
      const old=Object.hasOwn(entries,requestUid)?entries[requestUid]:undefined
      if(old && (old.teamId!==value.teamId || old.targetId!==value.targetId || old.selection!==value.selection))throw new Error('同一打开请求不能更换客户')
      Object.defineProperty(entries,requestUid,{value:structuredClone(value),writable:true,enumerable:true,configurable:true})
      while(Object.keys(entries).length>64)delete entries[Object.keys(entries)[0]!]
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
