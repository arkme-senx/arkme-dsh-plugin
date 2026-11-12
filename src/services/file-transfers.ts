import type { PendingAttachment, AttachmentReceipt, ProgressiveCapability, ProgressiveTarget } from './progressive-attachments.js'
import type { ArkmeUploadCompletion, ArkmeUploadCompletionRecovery } from './media-service.js'
import type { TeamSendTask } from '../team-send-contract.js'
import { createHash, randomUUID } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import { chmod, copyFile, lstat, mkdir, open, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { arkmeNormalizedFileMimeType, arkmePickedFileKind, type ArkmeFileOpenResult, type ArkmeFilePolicy, type ArkmeFileProgress, type ArkmeFileReception, type ArkmeFileSendInput, type ArkmeFileSendTask, type ArkmeLocalFile } from '../file-transfer-contract.js'
import type { ArkmeUploadedAsset, ArkmeSourceSendResult } from '../types.js'
import { ArkmePluginError } from './service.js'
import { ARKME_TOOL_FILE_MAX_BYTES } from '../file-transfer-contract.js'
import { arkmeFileBackgroundSound, assertArkmeBackgroundSoundLocalFiles } from '../record-background-sound.js'
import { isLongArticleImageMimeType, LONG_ARTICLE_IMAGE_MAX_BYTES } from '../long-article-content.js'

type Metadata = Pick<ArkmeLocalFile, 'fileName' | 'mimeType' | 'size'>
interface StoredFile extends ArkmeLocalFile { sha256: string; createdAtMillis: number; asset?: ArkmeUploadedAsset; retention?: 'references'; longArticle?: true }
interface StoredSendTask extends ArkmeFileSendTask { inlinePhotoPreviewSupported?: true; photoThumbnailSupported?: true; photoThumbnails?: Record<string, ProgressiveTarget>; completions?: Record<string, { generation: number; completion: ArkmeUploadCompletion }>; retryAfterMillis?: number; sourceKey?: string; contentDigest?: string }
interface FileState { version: 1; files: Record<string, StoredFile>; tasks: StoredSendTask[]; textTasks: StoredSendTask[]; originals: Record<string, string>; teamSends?: TeamSendTask[] }
export type FileTransferSendOutcome =
  | { kind: 'owner_accepted'; result: ArkmeSourceSendResult }
  | { kind: 'owner_not_accepted'; message: string; code?: string; retryable?: boolean; retryAfterMillis?: number }
  | { kind: 'owner_outcome_unknown'; message?: string; code?: string; retryAfterMillis?: number }
export interface FileTransferPorts {
  onProgressChange?(userId: number, taskRef: string): void
  currentUser(): Promise<number>
  retainedFileRefs?(userId: number): Promise<readonly string[]>
  validateSource(sourceRef: string, userId: number): Promise<string | void>
  upload(path: string, metadata: StoredFile, progress: (value: ArkmeFileProgress) => void, userId: number, signal: AbortSignal): Promise<ArkmeUploadedAsset>
  progressive?: {
    supported(userId: number, signal: AbortSignal): Promise<ProgressiveCapability>
    uploadPhotoThumbnail?(path: string, target: ProgressiveTarget, userId: number, signal: AbortSignal): Promise<void>
    reconcile(recordUid: string, userId: number, signal: AbortSignal): Promise<AttachmentReceipt[]>
    retry(target: ProgressiveTarget, userId: number, signal: AbortSignal): Promise<AttachmentReceipt[]>
    upload(path: string, metadata: StoredFile, progress: (value: ArkmeFileProgress) => void, userId: number, signal: AbortSignal, target: ProgressiveTarget, recovery: ArkmeUploadCompletionRecovery): Promise<ArkmeUploadedAsset>
  }
  send(
    input: ArkmeFileSendInput,
    assets: ArkmeUploadedAsset[],
    backgroundSound: import('../types.js').ArkmeRichBackgroundSoundInput | undefined,
    userId: number,
    signal: AbortSignal,
    pending?: PendingAttachment[],
  ): Promise<FileTransferSendOutcome>
  fetchMedia(ref: string, signal: AbortSignal): Promise<{ response: Response; descriptor: Metadata }>
  openPath?(path: string, signal: AbortSignal): Promise<void>
  /** null is an exact negative owner receipt; undefined is inconclusive. */
  reconcile?(input: ArkmeFileSendInput, signal: AbortSignal): Promise<ArkmeSourceSendResult | undefined | null>
}
function allTasks(state: FileState): StoredSendTask[] { return [...state.tasks, ...state.textTasks] }
function taskListKey(task: Pick<ArkmeFileSendInput, 'fileRefs'>): 'tasks' | 'textTasks' {
  return task.fileRefs.length ? 'tasks' : 'textTasks'
}
const REF = /^arkme-file-v1\.[0-9a-f-]{36}$/
const progressiveAttachmentUid = (recordUid: string, fileRef: string): string =>
  `pa-${createHash('sha256').update(`${recordUid}:${fileRef}`).digest('hex')}`
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const fail = (code: string, message: string) => new ArkmePluginError(code, message, false, 400)
const clone = <T>(value: T): T => structuredClone(value)
const validLocation = (location: ArkmeFileSendInput['location']): boolean => location === undefined || (
  Number.isFinite(location.latitude) && location.latitude >= -90 && location.latitude <= 90
  && Number.isFinite(location.longitude) && location.longitude >= -180 && location.longitude <= 180
  && Number.isSafeInteger(location.capturedAtMillis) && location.capturedAtMillis > 0
)
async function readPhotoPresentation(path: string): Promise<Pick<ArkmeLocalFile, 'imageDimensions' | 'inlinePhotoPreview'>> {
  try {
    const { default: sharp } = await import('sharp')
    const image = sharp(path)
    const { autoOrient } = await image.metadata()
    const { width, height } = autoOrient
    if (width <= 0 || height <= 0) return {}
    const thumbnail = await image.rotate().resize(32, 32, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#eee' }).jpeg({ quality: 35 }).toBuffer().catch(() => undefined)
    return { imageDimensions: autoOrient, ...(thumbnail && thumbnail.length <= 1536 ? { inlinePhotoPreview: thumbnail.toString('base64') } : {}) }
  } catch {
    // Some image formats can still be sent even when local metadata is unavailable.
  }
  return {}
}
const publicFile = (file: ArkmeLocalFile): ArkmeLocalFile => ({ fileRef: file.fileRef, fileName: file.fileName, mimeType: file.mimeType, size: file.size, fileKind: file.fileKind,
  ...(file.imageDimensions ? { imageDimensions: file.imageDimensions } : {}),
  ...(file.inlinePhotoPreview ? { inlinePhotoPreview: file.inlinePhotoPreview } : {}),
  ...(file.origin === 'local' || file.origin === 'received' ? { origin: file.origin } : {}) })
const nativeOpenFileName = (fileName: string): string => {
  const cleaned = fileName.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').trim().replace(/^[. ]+|[. ]+$/g, '')
  const extension = /\.[a-zA-Z0-9]{1,16}$/.exec(cleaned)?.[0] ?? ''
  let stem = (extension === '' ? cleaned : cleaned.slice(0, -extension.length)).replace(/[. ]+$/g, '')
  if (stem === '' || stem === '.' || stem === '..') stem = 'file'
  stem = stem.slice(0, Math.max(1, 180 - extension.length))
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(stem)) stem = `_${stem}`
  return `${stem}${extension}`
}

/** Plugin-owned files, not DSH session attachments. No client-controlled path is persisted. */
export class FileTransfers {
  private readonly states = new Map<number, Promise<FileState>>()
  private writes: Promise<void> = Promise.resolve()
  private textWrites: Promise<void> = Promise.resolve()
  private mutations: Promise<unknown> = Promise.resolve()
  private directUploads: Promise<unknown> = Promise.resolve()
  private readonly uploadingRefs = new Set<string>()
  private queue: Promise<void> = Promise.resolve()
  private legacyFileQueue: Promise<void> = Promise.resolve()
  private photoThumbnailQueue: Promise<void> = Promise.resolve()
  private photoThumbnailDrain: AbortController | undefined
  private uploadQueue: Promise<void> = Promise.resolve()
  private readonly jobs = new Set<Promise<void>>()
  private readonly controllers = new Set<AbortController>()
  private readonly receptions = new Map<string, ArkmeFileReception>()
  private readonly policy: ArkmeFilePolicy
  private recoveryTimer: ReturnType<typeof setTimeout> | undefined
  private recovering: Promise<void> | undefined
  private recoveryUser: number | undefined
  private recoveryGeneration = 0
  private closed = false
  private readonly scheduled = new Map<string, Promise<void>>()
  private readonly reconciling = new Map<string, Promise<ArkmeFileSendTask>>()

  constructor(private readonly directory: string, private readonly ports: FileTransferPorts, maxBytes: number) {
    this.policy = { version: 1, textMessagesVersion: 1, admissionRecoveryVersion: 1, maxFileBytes: maxBytes, maxImageBytes: Math.min(maxBytes, 50 * 1024 * 1024), maxAttachments: 9, ...(ports.progressive ? { metadataFirstVersion: 2 as const } : {}) }
  }

  capabilities(): ArkmeFilePolicy { return { ...this.policy } }
  cancelActive(): void { ++this.recoveryGeneration; clearTimeout(this.recoveryTimer); this.recoveryTimer = undefined; this.recovering = undefined; this.recoveryUser = undefined; for (const controller of this.controllers) controller.abort(); this.receptions.clear() }
  dispose(): void { this.closed = true; this.cancelActive() }
  async settled(): Promise<void> { await this.recovering; await Promise.allSettled(this.reconciling.values()); await this.queue; await this.legacyFileQueue; await this.uploadQueue; await this.photoThumbnailQueue; await this.directUploads.catch(() => {}); await Promise.all(this.jobs); await Promise.all([this.writes, this.textWrites]) }

  async resume(): Promise<void> {
    if (this.closed) return
    const user = await this.ports.currentUser()
    if (this.closed || this.recoveryUser === user) return
    if (this.recoveryUser !== undefined) this.cancelActive()
    this.recoveryUser = user
    const state = await this.state(user)
    for (const task of allTasks(state)) if (task.state === 'queued') this.schedule(user, state, task)
    this.armRecovery(user, state)
    this.resumePhotoThumbnails(user, state)
  }

  async resumeAfterReconnect(): Promise<void> {
    await this.resume()
    const user = this.recoveryUser
    if (user === undefined || this.closed) return
    const generation = this.recoveryGeneration
    const state = await this.state(user)
    await this.exclusive(async () => {
      if (this.closed || generation !== this.recoveryGeneration || this.recoveryUser !== user) return
      await this.assertUser(user)
      if (this.closed || generation !== this.recoveryGeneration || this.recoveryUser !== user) return
      for (const task of allTasks(state)) {
        if (task.retryAttempts === undefined || task.retryAfterMillis !== undefined
          || task.retryable === false || !['failed', 'uncertain'].includes(task.state)) continue
        if (task.nextRetryAtMillis === undefined) {
          if (task.retryAttempts < 6 || !['arkme-network-error', 'arkme-timeout'].includes(task.errorCode ?? '')) continue
          task.retryAttempts = 0
        }
        task.nextRetryAtMillis = Date.now()
        await this.saveTask(user, state, task)
      }
      this.armRecovery(user, state)
      this.resumePhotoThumbnails(user, state)
    })
  }

  private planRecovery(task: StoredSendTask): void {
    delete task.nextRetryAtMillis
    if (task.retryAttempts === undefined || task.retryAttempts >= 6 || task.retryable === false
      || !['failed', 'uncertain'].includes(task.state)
      || task.state === 'failed' && task.retryable !== true) return
    task.nextRetryAtMillis = Date.now() + Math.max(Math.min(60_000, 2_000 * 2 ** task.retryAttempts), task.retryAfterMillis ?? 0)
  }

  private armRecovery(user: number, state: FileState): void {
    if (this.closed || this.recoveryUser !== user || this.recovering) return
    clearTimeout(this.recoveryTimer); this.recoveryTimer = undefined
    const times = allTasks(state).flatMap(task => task.nextRetryAtMillis !== undefined && task.retryAttempts !== undefined
      && task.retryAttempts < 6 && ['failed', 'uncertain'].includes(task.state) && task.retryable !== false ? [task.nextRetryAtMillis] : [])
    if (!times.length) return
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = undefined
      const recovery = this.recover(user, state).catch(() => {}).finally(() => {
        if (this.recovering === recovery) { this.recovering = undefined; this.armRecovery(user, state) }
      })
      this.recovering = recovery
    }, Math.min(2_147_483_647, Math.max(1, Math.min(...times) - Date.now())))
    this.recoveryTimer.unref?.()
  }

  private async recover(user: number, state: FileState): Promise<void> {
    const generation = this.recoveryGeneration
    const current = () => !this.closed && this.recoveryUser === user && this.recoveryGeneration === generation
    const activeUser = await this.ports.currentUser().catch(() => undefined)
    if (!current()) return
    if (activeUser !== user) { this.cancelActive(); return }
    for (const task of allTasks(state)) {
      if (!current()) return
      if (task.nextRetryAtMillis === undefined || task.nextRetryAtMillis > Date.now() || (task.retryAttempts ?? 6) >= 6
        || !['failed', 'uncertain'].includes(task.state) || this.scheduled.has(`${user}:${task.taskRef}`)) continue
      const claimed = await this.exclusive(async () => {
        await this.assertUser(user)
        if (!current() || !state[taskListKey(task)].includes(task) || task.nextRetryAtMillis === undefined || task.nextRetryAtMillis > Date.now()
          || !['failed', 'uncertain'].includes(task.state)) return false
        // Preserve the due marker if the Host exits while checking the receipt.
        task.retryAttempts = (task.retryAttempts ?? 0) + 1
        await this.saveTask(user, state, task)
        return true
      })
      if (!claimed) continue
      try {
        if (task.state === 'uncertain') await this.reconcile(task.taskRef)
        await this.exclusive(async () => {
          await this.assertUser(user)
          if (!current() || !state[taskListKey(task)].includes(task)) return
          if (task.state === 'failed' && task.retryable !== false) {
            task.state = 'queued'; delete task.error; delete task.errorCode; delete task.nextRetryAtMillis
            await this.saveTask(user, state, task); this.schedule(user, state, task)
          } else if (task.state === 'uncertain') { this.planRecovery(task); await this.saveTask(user, state, task) }
        })
      } catch (error) {
        if (!current() || !state[taskListKey(task)].includes(task)) return
        if (error instanceof ArkmePluginError && !error.retryable) {
          task.retryable = false; task.errorCode = error.code; task.error = error.message
        }
        this.planRecovery(task); await this.saveTask(user, state, task)
      }
    }
  }

  private root(userId: number): string { return join(this.directory, String(userId)) }
  private path(userId: number, ref: string): string {
    if (!REF.test(ref)) throw fail('file-ref-invalid', '文件引用无效或不属于当前账号')
    return join(this.root(userId), ref)
  }
  private openDirectory(userId: number, ref: string): string {
    if (!REF.test(ref)) throw fail('file-ref-invalid', '文件引用无效或不属于当前账号')
    return join(this.root(userId), '.open', ref)
  }
  private async nativeOpenPath(userId: number, ref: string, file: ArkmeLocalFile): Promise<string> {
    const source = this.path(userId, ref)
    const directory = this.openDirectory(userId, ref)
    const target = join(directory, nativeOpenFileName(file.fileName))
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const sourceInfo = await stat(source)
    const targetInfo = await lstat(target).catch(error => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (targetInfo !== undefined && !targetInfo.isFile()) throw fail('file-open-target-invalid', '本地打开副本不是普通文件')
    // Editable copies must never share the attachment's bytes; independent user edits are retained.
    if (targetInfo !== undefined && (targetInfo.dev !== sourceInfo.dev || targetInfo.ino !== sourceInfo.ino)) return target
    const temporary = join(directory, `${randomUUID()}.tmp`)
    try {
      await copyFile(source, temporary, constants.COPYFILE_FICLONE)
      await chmod(temporary, 0o600)
      await rename(temporary, target)
    } finally { await unlink(temporary).catch(() => {}) }
    return target
  }
  private async assertUser(userId: number, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    if (this.closed || await this.ports.currentUser() !== userId) throw fail('file-account-changed', '账号已切换，请在原账号中重试')
    signal?.throwIfAborted()
  }
  private state(userId: number): Promise<FileState> {
    let loaded = this.states.get(userId)
    if (loaded === undefined) {
      loaded = (async () => {
        await mkdir(this.root(userId), { recursive: true, mode: 0o700 })
        const load = async (name: string) => {
          try { return JSON.parse(await readFile(join(this.root(userId), name), 'utf8')) as unknown }
          catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
            throw fail('file-state-invalid', '本地发送状态无法读取，请勿重复发送')
          }
        }
        const [fileData, textData] = await Promise.all([load('state.json'), load('text-sends.json')])
        const file: Omit<FileState, 'textTasks'> = fileData === undefined
          ? { version: 1, files: {}, tasks: [], originals: {} } : fileData as Omit<FileState, 'textTasks'>
        if (!file || file.version !== 1 || !file.files || !Array.isArray(file.tasks) || !file.originals
          || file.tasks.some(task => !task || !Array.isArray(task.fileRefs))
          || (file.teamSends !== undefined && (!Array.isArray(file.teamSends) || file.teamSends.some(task => !task || !Array.isArray(task.fileRefs) || !Array.isArray(task.files) || typeof task.taskRef !== 'string')))) {
          throw fail('file-state-invalid', '本地文件状态版本无效')
        }
        const text = textData as { version: number; tasks: StoredSendTask[] } | undefined
        if (textData !== undefined && (!text || text.version !== 1 || !Array.isArray(text.tasks)
          || text.tasks.some(task => !task || !Array.isArray(task.fileRefs) || task.fileRefs.length !== 0))) {
          throw fail('file-state-invalid', '本地文字发送状态版本无效')
        }
        const migrated = file.tasks.filter(task => taskListKey(task) === 'textTasks')
        const textIds = new Set(text?.tasks.map(task => task.recordUid))
        const state: FileState = { ...file, tasks: file.tasks.filter(task => taskListKey(task) === 'tasks'),
          textTasks: [...migrated.filter(task => !textIds.has(task.recordUid)), ...(text?.tasks ?? [])] }
        let redacted = false
        for (const task of allTasks(state)) {
          if (task.state === 'sent') redacted = this.compactTextReceipt(task) || redacted
          task.delivery ??= 'legacy'
          if ((task.retryAttempts ?? 0) >= 6) delete task.nextRetryAtMillis
          const interrupted = ['sending', 'queued', 'uploading'].includes(task.state)
          if (task.state === 'sending') { task.state = 'uncertain'; task.error = '发送结果待确认，请先核对会话，避免重复发送' }
          else if (task.state === 'queued' || task.state === 'uploading') { task.state = 'failed'; task.error = '上次传输已中断，请重试' }
          if (interrupted && task.retryAttempts !== undefined && task.retryAttempts < 6 && task.retryable !== false) {
            task.retryable = true; task.nextRetryAtMillis = Date.now()
          }
        }
        // Save migrated text first. A restart between writes prefers the new ledger.
        if (redacted || migrated.length) await this.saveText(userId, state)
        if (migrated.length) await this.save(userId, state)
        return state
      })()
      this.states.set(userId, loaded)
    }
    return loaded
  }
  private save(userId: number, { textTasks: _text, ...file }: FileState): Promise<void> {
    return this.writeState(userId, 'state.json', file)
  }
  private saveText(userId: number, state: FileState): Promise<void> {
    return this.writeState(userId, 'text-sends.json', { version: 1, tasks: state.textTasks })
  }
  private saveTask(userId: number, state: FileState, task: StoredSendTask): Promise<void> {
    return taskListKey(task) === 'textTasks' ? this.saveText(userId, state) : this.save(userId, state)
  }
  private writeState(userId: number, name: 'state.json' | 'text-sends.json', value: object): Promise<void> {
    const lane = name === 'text-sends.json' ? 'textWrites' : 'writes'
    const data = JSON.stringify(value)
    const write = this[lane].catch(() => {}).then(async () => {
      const target = join(this.root(userId), name)
      const temporary = `${target}.${randomUUID()}.tmp`
      try { await writeFile(temporary, data, { mode: 0o600 }); await rename(temporary, target) }
      finally { await unlink(temporary).catch(() => {}) }
    })
    this[lane] = write
    return write
  }
  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const work = this.mutations.catch(() => {}).then(action)
    this.mutations = work
    return work
  }
  private validateMetadata(metadata: Metadata, longArticle = false): void {
    const limit = longArticle ? LONG_ARTICLE_IMAGE_MAX_BYTES : metadata.mimeType.startsWith('image/') ? this.policy.maxImageBytes : this.policy.maxFileBytes
    if (!metadata.fileName.trim() || metadata.fileName.length > 255 || /[\u0000-\u001f]/.test(metadata.fileName)
      || metadata.mimeType.length > 200 || !/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(metadata.mimeType)
      || !Number.isSafeInteger(metadata.size) || metadata.size <= 0 || metadata.size > limit) {
      throw fail('file-input-invalid', `文件为空或超出限制（${Math.floor(limit / 1024 / 1024)} MiB）`)
    }
  }

  async stageLongArticleImage(temporaryPath: string, metadata: Metadata, expectedUserId?: number): Promise<ArkmeLocalFile> {
    const mime = arkmeNormalizedFileMimeType(metadata.mimeType, metadata.fileName)
    if (!isLongArticleImageMimeType(mime)) throw fail('long-article-image-invalid', '长文仅支持 JPG、PNG、GIF、WebP、AVIF、BMP 图片')
    return await this.stageLocal(temporaryPath, metadata, expectedUserId, 'references', true, 'local')
  }
  async stage(temporaryPath: string, metadata: Metadata, expectedUserId?: number, retention?: 'references'): Promise<ArkmeLocalFile> {
    return await this.stageLocal(temporaryPath, metadata, expectedUserId, retention, false, 'local')
  }
  private async stageLocal(temporaryPath: string, metadata: Metadata, expectedUserId: number | undefined, retention: 'references' | undefined, longArticle: boolean, origin: 'local' | 'received'): Promise<ArkmeLocalFile> {
    const userId = await this.ports.currentUser()
    if (expectedUserId !== undefined && expectedUserId !== userId) throw fail('file-account-changed', '账号已切换，本次文件导入已取消')
    const normalizedMetadata = { ...metadata, mimeType: arkmeNormalizedFileMimeType(metadata.mimeType, metadata.fileName) }
    this.validateMetadata(normalizedMetadata, longArticle)
    return this.exclusive(async () => {
      const state = await this.state(userId)
      await this.prune(userId, state)
      const ordinaryFiles = Object.values(state.files).filter(file => file.longArticle !== true)
      const used = ordinaryFiles.reduce((sum, file) => sum + file.size, 0)
      if (!longArticle && used + metadata.size > Math.max(this.policy.maxFileBytes, 1024 * 1024 * 1024)) {
        throw fail('file-cache-full', '本地附件空间不足，请移除不再需要的草稿或失败任务')
      }
      const info = await stat(temporaryPath)
      if (!info.isFile() || info.size !== metadata.size) throw fail('file-size-mismatch', '本地文件不完整')
      const hash = createHash('sha256')
      for await (const chunk of createReadStream(temporaryPath)) hash.update(chunk)
      const fileKind = arkmePickedFileKind(normalizedMetadata.mimeType, normalizedMetadata.fileName)
      const photoPresentation = fileKind === 1 && origin === 'local' && !longArticle ? await readPhotoPresentation(temporaryPath) : {}
      await this.assertUser(userId)
      const ref = `arkme-file-v1.${randomUUID()}`
      const file: StoredFile = { ...normalizedMetadata, origin, fileRef: ref, fileKind, ...photoPresentation, sha256: hash.digest('hex'), createdAtMillis: Date.now(), ...(retention ? { retention } : {}), ...(longArticle ? { longArticle: true as const } : {}) }
      await copyFile(temporaryPath, this.path(userId, ref))
      await chmod(this.path(userId, ref), 0o600)
      state.files[ref] = file
      try { await this.save(userId, state) }
      catch (error) { delete state.files[ref]; await unlink(this.path(userId, ref)).catch(() => {}); throw error }
      return publicFile(file)
    })
  }
  private async prune(userId: number, state: FileState): Promise<void> {
    const retained = new Set((state.teamSends ?? []).filter(task => !['sent', 'cancelled'].includes(task.state)
      || Date.now() - (task.completedAtMillis ?? task.createdAtMillis) < 7 * 24 * 3600_000).flatMap(task => task.fileRefs))
    for (const ref of state.tasks.filter(task => task.state !== 'sent').flatMap(task => task.fileRefs)) retained.add(ref)
    // Cleanup is optional; unavailable retention evidence must neither delete
    // a possibly referenced file nor prevent ordinary staging and sending.
    let editRefs: readonly string[]
    try { editRefs = await this.ports.retainedFileRefs?.(userId) ?? [] }
    catch { return }
    for (const ref of editRefs) retained.add(ref)
    const completed = new Set([...state.tasks.filter(task => task.state === 'sent').flatMap(task => task.fileRefs), ...(state.teamSends ?? []).filter(task => ['sent', 'cancelled'].includes(task.state)).flatMap(task => task.fileRefs)])
    const expired = Object.values(state.files).filter(file => {
      if (Date.now() - file.createdAtMillis < 7 * 24 * 3600_000 || retained.has(file.fileRef)
        || this.uploadingRefs.has(`${userId}:${file.fileRef}`)) return false
      return file.retention === 'references' ? this.ports.retainedFileRefs !== undefined : completed.has(file.fileRef)
    })
    const expiredRefs = new Set(expired.map(file => file.fileRef))
    const tasks = state.tasks.filter(task => task.state !== 'sent' || Date.now() - task.createdAtMillis < 7 * 24 * 3600_000
      || task.fileRefs.some(ref => state.files[ref] !== undefined && !expiredRefs.has(ref)))
    const teamSends = state.teamSends?.filter(task => !['sent', 'cancelled'].includes(task.state) || Date.now() - (task.completedAtMillis ?? task.createdAtMillis) < 7 * 24 * 3600_000
      || task.fileRefs.some(ref => state.files[ref] !== undefined && !expiredRefs.has(ref)))
    if (expired.length === 0 && tasks.length === state.tasks.length && teamSends?.length === state.teamSends?.length) return
    const previous = { files: state.files, tasks: state.tasks, teamSends: state.teamSends }
    state.files = Object.fromEntries(Object.entries(state.files).filter(([ref]) => !expiredRefs.has(ref)))
    state.tasks = tasks
    if (teamSends) state.teamSends = teamSends
    try { await this.save(userId, state) }
    catch (error) { Object.assign(state, previous); throw error }
    for (const file of expired) {
      await unlink(this.path(userId, file.fileRef)).catch(() => {})
      await rm(this.openDirectory(userId, file.fileRef), { recursive: true, force: true })
    }
  }
  /** Validate new references and persist their owner without a cleanup/removal gap. Local I/O only. */
  async withReferences<T>(refs: readonly string[], userId: number, persist: () => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      await this.assertUser(userId)
      const retained = new Set(await this.ports.retainedFileRefs?.(userId) ?? [])
      // Existing unavailable attachments must not prevent saving/removing their draft.
      for (const ref of new Set(refs)) if (!retained.has(ref)) await this.readLocal(ref)
      await this.assertUser(userId)
      return await persist()
    })
  }
  async readLocal(ref: string): Promise<{ path: string; file: ArkmeLocalFile }> {
    const userId = await this.ports.currentUser()
    const state = await this.state(userId)
    const file = state.files[ref]
    if (file === undefined) throw fail('file-ref-invalid', '文件引用无效或不属于当前账号')
    const path = this.path(userId, ref)
    const info = await stat(path).catch(() => undefined)
    if (!info?.isFile() || info.size !== file.size) throw fail('file-local-missing', '本地文件已不存在，请重新添加或接收')
    await this.assertUser(userId)
    return { path, file: publicFile(file) }
  }
  async openLocal(ref: string, signal?: AbortSignal): Promise<ArkmeFileOpenResult> {
    return { opened: true, file: await this.openLocalTarget(ref, 'file', signal) }
  }
  async openLocalFolder(ref: string, signal?: AbortSignal): Promise<{ folderOpened: true }> {
    await this.openLocalTarget(ref, 'folder', signal)
    return { folderOpened: true }
  }
  private async openLocalTarget(ref: string, target: 'file' | 'folder', signal?: AbortSignal): Promise<ArkmeLocalFile> {
    if (this.ports.openPath === undefined) throw fail('file-open-unavailable', target === 'folder' ? '当前宿主不能打开本机文件夹' : '当前宿主不能使用本机应用打开文件')
    const controller = new AbortController()
    this.controllers.add(controller)
    const operationSignal = signal === undefined ? controller.signal : AbortSignal.any([signal, controller.signal])
    try {
      operationSignal.throwIfAborted()
      const userId = await this.ports.currentUser()
      const { file, path } = await this.exclusive(async () => {
        await this.assertUser(userId, operationSignal)
        const { file } = await this.readLocal(ref)
        await this.assertUser(userId, operationSignal)
        return { file, path: await this.nativeOpenPath(userId, ref, file) }
      })
      await this.assertUser(userId, operationSignal)
      await this.ports.openPath(target === 'folder' ? dirname(path) : path, operationSignal)
      await this.assertUser(userId, operationSignal)
      return file
    } catch (error) {
      if (error instanceof ArkmePluginError) throw error
      throw target === 'folder'
        ? fail('file-folder-open-failed', '文件夹打开失败，请重试')
        : fail('file-open-failed', '文件打开失败，请重试')
    } finally {
      this.controllers.delete(controller)
    }
  }
  async files(): Promise<ArkmeLocalFile[]> {
    const state = await this.state(await this.ports.currentUser())
    return Object.values(state.files).map(publicFile)
  }
  async remove(ref: string): Promise<void> {
    const userId = await this.ports.currentUser()
    await this.exclusive(async () => {
      const state = await this.state(userId)
      await this.assertUser(userId)
      if (state.tasks.some(task => task.fileRefs.includes(ref)) || (state.teamSends ?? []).some(task => task.state !== 'cancelled' && task.fileRefs.includes(ref))) throw fail('file-in-use', '文件仍被本地发送任务引用，请先移除该任务')
      if (this.uploadingRefs.has(`${userId}:${ref}`)) throw fail('file-in-use', '文件正在上传，请稍后移除')
      if ((await this.ports.retainedFileRefs?.(userId))?.includes(ref)) throw fail('file-in-use', '文件仍被重新编辑草稿引用，请先从草稿移除')
      if (!state.files[ref]) return
      delete state.files[ref]; await this.save(userId, state)
      await unlink(this.path(userId, ref)).catch(() => {})
      await rm(this.openDirectory(userId, ref), { recursive: true, force: true })
    })
  }
  async tasks(sourceRef?: string, watchTaskRefs?: readonly string[]): Promise<ArkmeFileSendTask[]> {
    const user = await this.ports.currentUser()
    const state = await this.state(user)
    const tasks = allTasks(state)
    const sourceKey = sourceRef && tasks.some(task => task.sourceKey !== undefined && task.sourceRef !== sourceRef)
      ? await this.ports.validateSource(sourceRef, user) : undefined
    await this.assertUser(user)
    const watched = watchTaskRefs === undefined ? undefined : new Set(watchTaskRefs)
    return tasks.filter(task => (watched === undefined || watched.has(task.taskRef)
      || task.state === 'queued' || task.state === 'uploading' || task.state === 'sending' || task.nextRetryAtMillis !== undefined)
      && (!sourceRef || task.sourceRef === sourceRef || sourceKey && task.sourceKey === sourceKey))
      .map(task => this.publicTask(watched?.has(task.taskRef) ? { ...task, content: {} } : task, sourceRef))
  }
  /** Internal Team delivery uses the existing account store and file-reference lock. */
  async teamSends(userId: number): Promise<TeamSendTask[]> {
    await this.assertUser(userId)
    return clone((await this.state(userId)).teamSends ?? [])
  }
  async mutateTeamSends(userId: number, mutate: (tasks: TeamSendTask[]) => void): Promise<TeamSendTask[]> {
    return this.exclusive(async () => {
      await this.assertUser(userId)
      const state = await this.state(userId)
      const previous = state.teamSends
      const next = clone(previous ?? [])
      mutate(next)
      for (const task of next) if (!['sent', 'cancelled'].includes(task.state)) {
        for (const ref of task.fileRefs) if (!previous?.find(old => old.taskRef === task.taskRef)?.fileRefs.includes(ref) && !state.files[ref]) throw fail('file-local-missing', '本地附件已不存在')
      }
      state.teamSends = next
      try { await this.save(userId, state) }
      catch (error) { if (previous) state.teamSends = previous; else delete state.teamSends; throw error }
      return clone(next)
    })
  }
  async stageBytes(contentBase64: string, metadata: Omit<Metadata, 'size'>): Promise<ArkmeLocalFile> {
    if (contentBase64.length > Math.ceil(ARKME_TOOL_FILE_MAX_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(contentBase64)) throw fail('file-tool-input-invalid', '工具暂存只接受最多 64 KiB 的 Base64 内容，不接受本机路径')
    const data = Buffer.from(contentBase64, 'base64')
    if (data.length > ARKME_TOOL_FILE_MAX_BYTES) throw fail('file-tool-input-invalid', '工具暂存文件超过 64 KiB')
    const userId = await this.ports.currentUser(); await this.state(userId)
    const temporary = join(this.root(userId), `${randomUUID()}.import`)
    try {
      await writeFile(temporary, data, { mode: 0o600, flag: 'wx' }); await this.assertUser(userId)
      return await this.stage(temporary, { ...metadata, size: data.length }, userId)
    } finally { await unlink(temporary).catch(() => {}) }
  }
  async discard(taskRef: string): Promise<void> {
    const userId = await this.ports.currentUser()
    await this.exclusive(async () => {
      const state = await this.state(userId); await this.assertUser(userId)
      const task = allTasks(state).find(value => value.taskRef === taskRef)
      if (!task) return
      if (['queued', 'uploading', 'sending'].includes(task.state)) throw fail('file-task-active', '任务仍在进行中，不能移除')
      // Removing a local task never deletes a remote record, or files still used by drafts.
      const key = taskListKey(task)
      const previousTasks = state[key]
      state[key] = previousTasks.filter(value => value !== task)
      try { await this.saveTask(userId, state, task) }
      catch (error) { state[key] = previousTasks; throw error }
    })
  }
  async reconcile(taskRef: string): Promise<ArkmeFileSendTask> {
    const userId = await this.ports.currentUser()
    const state = await this.state(userId)
    await this.assertUser(userId)
    const task = allTasks(state).find(value => value.taskRef === taskRef)
    if (!task) throw fail('file-task-missing', '发送任务不存在')
    if (task.state !== 'uncertain') return this.publicTask(task)
    const key = `${userId}:${taskRef}`
    const running = this.reconciling.get(key)
    if (running) return running
    const work = (async () => {
      const controller = new AbortController(); this.controllers.add(controller)
      try {
        await this.assertUser(userId, controller.signal)
        const result = await this.ports.reconcile?.(task, controller.signal)
        return await this.exclusive(async () => {
          await this.assertUser(userId, controller.signal)
          if (!state[taskListKey(task)].includes(task)) throw fail('file-task-missing', '发送任务不存在')
          if (task.state !== 'uncertain') return this.publicTask(task)
          if (result) {
            task.result = result
            task.state = task.delivery === 'progressive' ? 'queued' : 'sent'
            if (task.state === 'sent') this.compactTextReceipt(task)
            delete task.location; delete task.error; delete task.errorCode; delete task.nextRetryAtMillis
            await this.saveTask(userId, state, task)
            if (task.delivery === 'progressive') this.schedule(userId, state, task)
          } else if (result === null) {
            task.state = 'failed'; task.retryable = true
            task.error = '原发送尚未受理，可以重试'
            await this.saveTask(userId, state, task)
          }
          // Absence from a recent page is not proof that the send was rejected.
          return this.publicTask(task)
        })
      } finally { this.controllers.delete(controller) }
    })().finally(() => this.reconciling.delete(key))
    this.reconciling.set(key, work)
    return work
  }
  async enqueue(input: ArkmeFileSendInput, recovery?: { signal?: AbortSignal }): Promise<ArkmeFileSendTask> {
    const userId = await this.ports.currentUser()
    if (input.expectedUserId !== undefined
      && (!Number.isSafeInteger(input.expectedUserId) || input.expectedUserId <= 0)) {
      throw fail('file-expected-user-invalid', '文件发送的预期账号无效')
    }
    if (input.expectedUserId !== undefined && input.expectedUserId !== userId) {
      throw fail('file-account-changed', '账号已切换，本次文件发送已取消')
    }
    if (!Array.isArray(input.fileRefs) || !input.content || !UUID.test(input.recordUid) || !UUID.test(input.relationUid) || !input.sourceRef.trim()
      || input.fileRefs.length + (input.content.assets?.length ?? 0) > this.policy.maxAttachments
      || (input.fileRefs.length === 0 && !input.content.assets?.length && !input.content.textContent?.trim())
      || new Set(input.fileRefs).size !== input.fileRefs.length || (input.content.textContent?.length ?? 0) > 20_000
      || (input.content.sendAtMillis !== undefined && (!Number.isSafeInteger(input.content.sendAtMillis) || input.content.sendAtMillis <= 0))
      || !validLocation(input.location)) {
      throw fail('file-send-invalid', '发送标识、正文或附件数量无效')
    }
    if(input.content.representation!==undefined&&(!Number.isSafeInteger(input.content.sendAtMillis)||Number(input.content.sendAtMillis)<=0))throw fail('team-identity-time-invalid','团队发送必须保留原发送时间')
    const backgroundSound = arkmeFileBackgroundSound(input.backgroundSound, input.fileRefs)
    if (backgroundSound !== undefined) {
      const backgroundRefs = new Set(backgroundSound.fileRefs)
      const hasOrdinaryFile = input.fileRefs.some(ref => !backgroundRefs.has(ref))
      const hasText = (input.content.textContent?.trim() ?? '') !== '' || (input.content.title?.trim() ?? '') !== ''
      if (!hasOrdinaryFile && !hasText) {
        throw fail('file-send-background-only-invalid', '背景音不能作为唯一发送内容')
      }
    }
    const { expectedUserId: _expectedUserId, ...persistedInput } = input
    const normalizedInput: ArkmeFileSendInput = {
      ...clone(persistedInput),
      ...(backgroundSound === undefined ? {} : { backgroundSound }),
    }
    const sourceKey = await this.ports.validateSource(input.sourceRef, userId)
    const state = await this.state(userId)
    const findPrior = () => state.textTasks.find(task => task.recordUid === input.recordUid)
      ?? state.tasks.find(task => task.recordUid === input.recordUid)
    let existingReceipt: ArkmeSourceSendResult | undefined
    if (recovery && !findPrior()) {
      if (input.fileRefs.length) throw fail('file-send-invalid', '本机接收恢复仅用于文字消息')
      const { location: _location, ...receiptInput } = normalizedInput
      const signal = recovery.signal ?? new AbortController().signal
      await this.assertUser(userId, signal)
      const outcome = await this.ports.reconcile?.(receiptInput, signal)
      await this.assertUser(userId, signal)
      if (outcome === undefined) throw fail('file-send-uncertain', '暂时无法确认原消息是否送达')
      if (outcome !== null) existingReceipt = outcome
    }
    return this.exclusive(async () => {
      await this.assertUser(userId, recovery?.signal)
      const prior = findPrior()
      const content = { ...normalizedInput.content, sendAtMillis: input.content.sendAtMillis ?? prior?.content.sendAtMillis ?? Date.now() }
      if (prior) {
        if ((prior.sourceRef !== input.sourceRef && (!sourceKey || prior.sourceKey !== sourceKey)) || prior.relationUid !== input.relationUid || JSON.stringify(prior.fileRefs) !== JSON.stringify(input.fileRefs)
          || (prior.contentDigest === undefined
            ? JSON.stringify(prior.content) !== JSON.stringify(prior.retryAttempts === undefined ? input.content : content)
            : prior.contentDigest !== this.contentDigest(content))
          || JSON.stringify(prior.attachmentOrder) !== JSON.stringify(input.attachmentOrder)
          || JSON.stringify(prior.backgroundSound) !== JSON.stringify(backgroundSound)
          || (prior.state !== 'sent' && JSON.stringify(prior.location) !== JSON.stringify(input.location))) throw fail('file-send-conflict', '发送标识已用于另一份内容')
        return this.publicTask(prior, input.sourceRef)
      }
      if (!existingReceipt && allTasks(state).filter(task => task.state !== 'sent').length >= 100) throw fail('file-queue-full', '待发送文件过多，请先处理失败任务')
      const files: ArkmeFileSendTask['files'] = []
      for (const ref of input.fileRefs) {
        const { file } = await this.readLocal(ref)
        files.push({ ...file, progress: { phase: 'preparing', sentBytes: 0, totalBytes: file.size } })
      }
      assertArkmeBackgroundSoundLocalFiles(backgroundSound, files)
      await this.assertUser(userId)
      const task: StoredSendTask = { ...normalizedInput, content, ...(sourceKey ? { sourceKey } : {}), taskRef: `arkme-send-v1.${randomUUID()}`, createdAtMillis: Date.now(), state: 'queued', files, retryAttempts: 0, delivery: files.length && this.ports.progressive ? 'negotiating' : 'legacy' }
      if (task.delivery === 'negotiating') {
        for (const file of task.files) file.attachmentUid = progressiveAttachmentUid(task.recordUid, file.fileRef)
      }
      if (existingReceipt) {
        task.state = 'sent'
        task.result = existingReceipt
        delete task.location
        this.compactTextReceipt(task)
      }
      const key = taskListKey(task)
      const previousTasks = state[key]
      const expired = key === 'textTasks' ? new Set(previousTasks.filter(task => task.state === 'sent').slice(0, -99)) : undefined
      state[key] = [...(expired ? previousTasks.filter(task => !expired.has(task)) : previousTasks), task]
      try { await this.saveTask(userId, state, task) } catch (error) { state[key] = previousTasks; throw error }
      if (this.recoveryUser !== undefined && this.recoveryUser !== userId) this.cancelActive()
      this.recoveryUser = userId
      if (!existingReceipt) this.schedule(userId, state, task)
      return this.publicTask(task)
    })
  }
  private imageFailure(error: unknown, fileRef: string, file: ArkmeLocalFile | undefined, phase: 'validation' | 'upload'): ArkmePluginError {
    const known = error instanceof ArkmePluginError ? error : new ArkmePluginError('long-article-image-failed', '图片处理失败，请重试', true, 502, { cause: error })
    return new ArkmePluginError(known.code, `${file?.fileName ?? '图片'}：${known.message}`, known.retryable, known.httpStatus, {
      ...known, cause: known, imageFailures: [{ fileRef, fileName: file?.fileName ?? '图片', phase }],
    })
  }
  async uploadLongArticleImages(fileRefs: readonly string[], signal?: AbortSignal): Promise<ArkmeUploadedAsset[]> {
    for (const ref of fileRefs) {
      let file: ArkmeLocalFile | undefined
      try {
        const stored = (await this.state(await this.ports.currentUser())).files[ref]
        if (stored !== undefined) file = publicFile(stored)
        if (file !== undefined) this.validateMetadata(file, true)
        file = (await this.readLocal(ref)).file
        if (file.fileKind !== 1 || !isLongArticleImageMimeType(file.mimeType)) throw fail('long-article-image-invalid', '长文仅支持 JPG、PNG、GIF、WebP、AVIF、BMP 图片')
        this.validateMetadata(file, true)
      } catch (error) { throw this.imageFailure(error, ref, file, 'validation') }
    }
    return await this.uploadDirectRefs(fileRefs, signal, true)
  }
  async uploadRefs(fileRefs: readonly string[], signal?: AbortSignal, progress?: (ref: string, value: ArkmeFileProgress) => void): Promise<ArkmeUploadedAsset[]> {
    return await this.uploadDirectRefs(fileRefs, signal, false, progress)
  }
  private async uploadDirectRefs(fileRefs: readonly string[], signal: AbortSignal | undefined, longArticle: boolean, progress?: (ref: string, value: ArkmeFileProgress) => void): Promise<ArkmeUploadedAsset[]> {
    const userId = await this.ports.currentUser()
    if (fileRefs.length < 1 || (!longArticle && fileRefs.length > this.policy.maxAttachments)
      || new Set(fileRefs).size !== fileRefs.length || fileRefs.some(ref => !REF.test(ref))) {
      throw fail('file-upload-invalid', '请选择 1 至 9 个有效附件')
    }
    const controller = new AbortController()
    const abort = () => { controller.abort(signal?.reason) }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    this.controllers.add(controller)
    // Serialize direct uploads, not local file mutations: a slow edit upload
    // must not hold the staging/enqueue lock used by ordinary message sending.
    const work = this.directUploads.catch(() => {}).then(async () => {
      const state = await this.exclusive(async () => {
        await this.assertUser(userId, controller.signal)
        const current = await this.state(userId)
        if (fileRefs.some(ref => !current.files[ref])) throw fail('file-local-missing', '本地附件已不存在')
        for (const ref of fileRefs) this.uploadingRefs.add(`${userId}:${ref}`)
        return current
      })
      try {
        const assets: ArkmeUploadedAsset[] = new Array(fileRefs.length)
        let cursor = 0
        const worker = async () => {
        while (cursor < fileRefs.length) {
          const index = cursor++
          const fileRef = fileRefs[index]!
          await this.assertUser(userId, controller.signal)
          const stored = state.files[fileRef]
          if (stored === undefined) throw fail('file-local-missing', '本地附件已不存在')
          let asset = stored.asset?.fileKind === stored.fileKind ? stored.asset
            : Object.values(state.files).find(other => other.sha256 === stored.sha256 && other.asset?.fileKind === stored.fileKind)?.asset
          if (asset === undefined) {
            try {
              asset = await this.ports.upload(
                this.path(userId, fileRef), stored, value => progress?.(fileRef, value), userId, controller.signal,
              )
            } catch (error) {
              if (!longArticle || controller.signal.aborted) throw error
              throw this.imageFailure(error, fileRef, stored, 'upload')
            }
          }
          await this.assertUser(userId, controller.signal)
          asset = { ...asset, fileName: stored.fileName }
          await this.exclusive(async () => {
            stored.asset = asset
            await this.save(userId, state)
          })
          assets[index] = asset
        }
        }
        const outcomes = await Promise.allSettled(Array.from({ length: longArticle ? Math.min(3, fileRefs.length) : 1 }, worker))
        const failure = outcomes.find(result => result.status === 'rejected')
        if (failure?.status === 'rejected') {
          const first = failure.reason
          if (longArticle && first instanceof ArkmePluginError) {
            const imageFailures = outcomes.flatMap(result => result.status === 'rejected' && result.reason instanceof ArkmePluginError ? result.reason.imageFailures ?? [] : [])
            if (imageFailures.length) throw new ArkmePluginError(first.code, first.message, first.retryable, first.httpStatus, { ...first, cause: first, imageFailures })
          }
          throw first
        }
        await this.assertUser(userId, controller.signal)
        return clone(assets)
      } finally {
        for (const ref of fileRefs) this.uploadingRefs.delete(`${userId}:${ref}`)
      }
    })
    this.directUploads = work
    try { return await work }
    finally { signal?.removeEventListener('abort', abort); this.controllers.delete(controller) }
  }
  async retry(taskRef: string): Promise<ArkmeFileSendTask> {
    const userId = await this.ports.currentUser()
    const current = allTasks(await this.state(userId)).find(value => value.taskRef === taskRef)
    // The failure can be visible before its worker finishes persisting it.
    if (current?.state === 'failed' || current?.state === 'uncertain') await this.scheduled.get(`${userId}:${taskRef}`)
    if (current?.state === 'uncertain' && current.retryable !== false) {
      await this.assertUser(userId)
      await this.reconcile(taskRef)
    }
    return this.exclusive(async () => {
      const state = await this.state(userId)
      const task = allTasks(state).find(value => value.taskRef === taskRef)
      if (!task) throw fail('file-task-missing', '发送任务不存在')
      await this.assertUser(userId)
      if (task.state === 'uncertain') throw fail('file-send-uncertain', '发送结果待确认，请先核对原会话，不能自动重复发送')
      if (task.state !== 'failed') return this.publicTask(task)
      if (task.retryable === false) throw fail(task.errorCode ?? 'file-send-rejected', task.error ?? '该发送已被拒绝，不能重试')
      task.state = 'queued'; delete task.error; delete task.errorCode
      task.retryAttempts = 0; delete task.nextRetryAtMillis; delete task.retryAfterMillis
      for (const file of task.files) {
        if (!file.asset) file.progress = { phase: 'preparing', sentBytes: 0, totalBytes: file.size }
      }
      await this.saveTask(userId, state, task); this.schedule(userId, state, task)
      this.recoveryUser = userId; this.armRecovery(userId, state)
      return this.publicTask(task)
    })
  }
  private contentDigest(content: ArkmeFileSendInput['content']): string {
    return createHash('sha256').update(JSON.stringify(content)).digest('hex')
  }

  /** Confirmed text receipts keep identity for idempotency; visibility belongs to the timeline. */
  private compactTextReceipt(task: StoredSendTask): boolean {
    if (task.fileRefs.length || task.contentDigest !== undefined) return false
    task.contentDigest = this.contentDigest(task.content)
    const { sendAtMillis } = task.content
    task.content = sendAtMillis === undefined ? {} : { sendAtMillis }
    if (task.result) {
      const { messageActionRef: _action, recordTopicAssignmentRef: _topic, ...receipt } = task.result
      task.result = receipt
    }
    return true
  }
  private publicTask({ completions: _completions, retryAfterMillis: _retryAfterMillis, sourceKey: _sourceKey, contentDigest: _contentDigest, inlinePhotoPreviewSupported: _inlinePhotoPreviewSupported, photoThumbnailSupported: _photoThumbnailSupported, photoThumbnails: _photoThumbnails, ...task }: StoredSendTask, sourceRef = task.sourceRef): ArkmeFileSendTask {
    return clone({ ...task, sourceRef, ...(task.result ? { result: { ...task.result, sourceRef } } : {}) })
  }

  private resumePhotoThumbnails(userId: number, state: FileState): void {
    const upload = this.ports.progressive?.uploadPhotoThumbnail
    if (!upload || this.closed || (this.photoThumbnailDrain && !this.photoThumbnailDrain.signal.aborted)
      || !state.tasks.some(task => task.photoThumbnails)) return
    const controller = new AbortController()
    this.photoThumbnailDrain = controller
    this.controllers.add(controller)
    this.photoThumbnailQueue = this.photoThumbnailQueue.then(async () => {
      const attempted = new Set<ProgressiveTarget>()
      for (;;) {
        await this.assertUser(userId, controller.signal)
        const isPending = ([ref, target]: [string, ProgressiveTarget]) => state.files[ref] && !attempted.has(target)
        const task = state.tasks.find(task => task.photoThumbnails &&
          Date.now() - task.createdAtMillis < 7 * 24 * 3600_000 &&
          Object.entries(task.photoThumbnails).some(isPending))
        if (!task?.photoThumbnails) return
        const [ref, target] = Object.entries(task.photoThumbnails).find(isPending)!
        attempted.add(target)
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)])
        try {
          await upload(this.path(userId, ref), target, userId, signal)
          delete task.photoThumbnails![ref]
          if (Object.keys(task.photoThumbnails!).length === 0) delete task.photoThumbnails
          await this.save(userId, state)
        } catch {
          // Reconnect or the next launch can retry without touching the sent message.
        }
      }
    }).catch(() => {}).finally(() => {
      this.controllers.delete(controller)
      if (this.photoThumbnailDrain === controller) this.photoThumbnailDrain = undefined
    })
  }

  private observeUpload(userId: number, task: StoredSendTask, file: StoredSendTask['files'][number]) {
    let lastUpdate = 0
    return (progress: ArkmeFileProgress) => {
      const changedPhase = file.progress.phase !== progress.phase
      file.progress = progress
      const now = Date.now()
      if (changedPhase || now - lastUpdate >= 250) {
        lastUpdate = now
        this.ports.onProgressChange?.(userId, task.taskRef)
      }
    }
  }

  private async deliverProgressive(userId: number, state: FileState, task: StoredSendTask, controller: AbortController): Promise<boolean> {
    const signal = controller.signal
    const ports = this.ports.progressive
    if (!ports) throw fail('attachment-protocol-unavailable', '附件补传需要更新插件')
    const background = new Set(task.backgroundSound?.fileRefs ?? [])
    const order = new Map((task.attachmentOrder ?? [...(task.content.assets ?? []).map(asset => asset.fileAssetUid), ...task.fileRefs]).map((ref, index) => [ref, index]))
    const pending: PendingAttachment[] = task.files.map(({ inlinePhotoPreview, ...file }, index) => ({ ...publicFile(file),
      ...(task.inlinePhotoPreviewSupported && inlinePhotoPreview ? { inlinePhotoPreview } : {}),
      attachmentUid: progressiveAttachmentUid(task.recordUid, file.fileRef),
      generation: 1, sortOrder: order.get(file.fileRef) ?? index,
      ...(background.has(file.fileRef) ? { backgroundSound: true, fileKind: 2 as const } : {}),
    }))
    for (const [index, file] of task.files.entries()) file.attachmentUid = pending[index]!.attachmentUid
    if (!task.result) {
      task.state = 'sending'; await this.save(userId, state)
      let outcome: FileTransferSendOutcome
      try { outcome = await this.ports.send(task, [], undefined, userId, signal, pending) }
      catch { outcome = { kind: 'owner_outcome_unknown' } }
      if (outcome.kind !== 'owner_accepted') {
        task.state = outcome.kind === 'owner_not_accepted' ? 'failed' : 'uncertain'
        task.error = outcome.message ?? '发送结果待确认，请先核对会话，避免重复发送'
        if (outcome.code) task.errorCode = outcome.code
        else delete task.errorCode
        if (outcome.kind === 'owner_not_accepted' && outcome.retryable !== undefined) task.retryable = outcome.retryable
        else delete task.retryable
        if (outcome.retryAfterMillis === undefined) delete task.retryAfterMillis
        else task.retryAfterMillis = outcome.retryAfterMillis
        return false
      }
      task.result = outcome.result
      delete task.location
    }
    task.state = 'uploading'; delete task.error; delete task.errorCode
    // Persist the message receipt before any bytes leave the Host. Retries never resend it.
    await this.save(userId, state)
    const recordUid = task.result.itemUid
    // A slow file must not hold the admission queue for later message bodies.
    this.uploadQueue = this.uploadQueue.catch(() => {}).then(async () => {
      await this.assertUser(userId, signal)
      let receipts = await ports.reconcile(recordUid, userId, signal)
      for (const descriptor of pending) {
        await this.assertUser(userId, signal)
        const file = task.files.find(file => file.fileRef === descriptor.fileRef)!
        let receipt = receipts.find(value => value.attachmentUid === descriptor.attachmentUid)
        if (!receipt) continue // Server removal is authoritative; never recreate a detached slot.
        let target = { record_uid: recordUid, attachment_uid: receipt.attachmentUid, generation: receipt.generation }
        if (receipt.state === 'failed') {
          receipts = await ports.retry(target, userId, signal)
          receipt = receipts.find(value => value.attachmentUid === descriptor.attachmentUid)
          if (!receipt) continue
          target = { ...target, generation: receipt.generation }
          delete task.completions?.[file.fileRef]
        }
        if (receipt.state !== 'ready') {
          const stored = state.files[file.fileRef]
          if (!stored) throw fail('file-local-missing', '消息已发送，本地附件已不存在')
          file.asset = await ports.upload(this.path(userId, file.fileRef), { ...stored, fileKind: descriptor.fileKind },
            this.observeUpload(userId, task, file), userId, signal, target, {
              read: () => task.completions?.[file.fileRef]?.generation === target.generation ? task.completions[file.fileRef]!.completion : undefined,
              save: async completion => {
                task.completions ??= {}; task.completions[file.fileRef] = { generation: target.generation, completion }
                await this.save(userId, state)
              },
            })
          await this.assertUser(userId, signal)
          receipts = await ports.reconcile(recordUid, userId, signal)
          receipt = receipts.find(value => value.attachmentUid === descriptor.attachmentUid)
          if (receipt && receipt.state !== 'ready') throw new ArkmePluginError('attachment-completion-pending', '消息已发送，附件完成状态待确认，请重试补传', true, 409)
          const dimensions = descriptor.imageDimensions
          if (task.photoThumbnailSupported && receipt?.state === 'ready' && descriptor.fileKind === 1
            && ['image/jpeg', 'image/png'].includes(descriptor.mimeType) && dimensions
            && Math.max(dimensions.width, dimensions.height) > 720 && file.size > 128 * 1024 && file.size <= 20 * 1024 * 1024) {
            task.photoThumbnails ??= {}
            task.photoThumbnails[file.fileRef] = target
          }
        }
        if (receipt?.fileAssetUid) {
          file.asset = { fileAssetUid: receipt.fileAssetUid, fileName: file.fileName, mimeType: file.mimeType, size: file.size, fileKind: descriptor.fileKind }
          const stored = state.files[file.fileRef]
          if (stored) stored.asset = file.asset
        }
        file.progress = { phase: 'ready', sentBytes: file.size, totalBytes: file.size }
        delete task.completions?.[file.fileRef]
        await this.save(userId, state)
      }
      task.state = 'sent'; delete task.error; delete task.errorCode; delete task.completions
    }).catch(error => {
      task.state = 'failed'
      task.error = error instanceof ArkmePluginError ? error.message : '附件补传中断，请重试'
      if (error instanceof ArkmePluginError) {
        task.errorCode = error.code; task.retryable = error.retryable
        if (error.retryAfterMillis !== undefined) task.retryAfterMillis = error.retryAfterMillis
      } else if (signal.aborted) task.retryable = true
      else delete task.retryable
    }).finally(async () => {
      this.controllers.delete(controller)
      this.planRecovery(task)
      await this.save(userId, state)
      if (!signal.aborted) this.ports.onProgressChange?.(userId, task.taskRef)
      this.armRecovery(userId, state)
      if (!signal.aborted && task.photoThumbnails) this.resumePhotoThumbnails(userId, state)
    }).catch(() => { task.state = 'failed'; task.error = '附件状态保存失败，请重试补传' })
    return true
  }

  private schedule(userId: number, state: FileState, task: StoredSendTask): void {
    const key = `${userId}:${task.taskRef}`
    if (this.closed || this.scheduled.has(key)) return
    const controller = new AbortController(); this.controllers.add(controller)
    let ownerOutcome: FileTransferSendOutcome | undefined
    let deferred = false
    const lane = task.fileRefs.length > 0 && task.delivery !== 'progressive' ? 'legacyFileQueue' : 'queue'
    this[lane] = this[lane].catch(() => {}).then(async () => {
      try {
        await this.assertUser(userId, controller.signal)
        if (task.delivery === undefined || task.delivery === 'negotiating') {
          const capability = await this.ports.progressive?.supported(userId, controller.signal)
          task.delivery = capability ? 'progressive' : 'legacy'
          if (capability === 'inline-photo-preview' || capability === 'photo-thumbnail') task.inlinePhotoPreviewSupported = true
          if (capability === 'photo-thumbnail') task.photoThumbnailSupported = true
          await this.saveTask(userId, state, task)
        }
        if (task.delivery === 'progressive') {
          deferred = await this.deliverProgressive(userId, state, task, controller)
          return
        }
        if (task.files.length) { task.state = 'uploading'; await this.saveTask(userId, state, task) }
        const backgroundRefs = new Set(task.backgroundSound?.fileRefs ?? [])
        for (const file of task.files) {
          await this.assertUser(userId, controller.signal)
          const stored = state.files[file.fileRef]
          if (!stored) throw fail('file-local-missing', '本地附件已不存在')
          if (!file.asset) {
            // Local audio remains a generic file. Only its explicit background role
            // selects the provider audio kind, so ordinary audio is never recast implicitly.
            const uploadFileKind = backgroundRefs.has(file.fileRef) ? 2 : stored.fileKind
            const cached = stored.asset?.fileKind === uploadFileKind
              ? stored.asset
              : Object.values(state.files).find(other => other.sha256 === stored.sha256
                && other.asset?.fileKind === uploadFileKind)?.asset
            if (cached) file.asset = cached
            if (!file.asset) file.asset = await this.ports.upload(
              this.path(userId, file.fileRef),
              { ...stored, fileKind: uploadFileKind },
              this.observeUpload(userId, task, file),
              userId,
              controller.signal,
            )
            // A reused blob retains this attachment's display name and original ordering.
            file.asset = { ...file.asset, fileName: file.fileName }
            stored.asset = file.asset
            file.progress = { phase: 'ready', sentBytes: file.size, totalBytes: file.size }
            await this.saveTask(userId, state, task)
          }
        }
        await this.assertUser(userId, controller.signal)
        task.state = 'sending'; await this.saveTask(userId, state, task)
        const assets = task.files.map(file => file.asset!)
        const assetByRef = new Map(task.fileRefs.map((ref, index) => [ref, assets[index]!]))
        const backgroundSound = task.backgroundSound === undefined ? undefined : {
          assets: task.backgroundSound.fileRefs.map(ref => assetByRef.get(ref)!),
          amplitudes: [...task.backgroundSound.amplitudes],
        }
        try {
          ownerOutcome = await this.ports.send(task, assets, backgroundSound, userId, controller.signal)
        } catch {
          // A port contract violation must fail closed because the owner may have accepted the write.
          ownerOutcome = { kind: 'owner_outcome_unknown' }
        }
        if (ownerOutcome.kind === 'owner_accepted') {
          task.result = ownerOutcome.result
          delete task.location
          task.state = 'sent'; delete task.error; delete task.errorCode
          this.compactTextReceipt(task)
        } else if (ownerOutcome.kind === 'owner_not_accepted') {
          task.state = 'failed'; task.error = ownerOutcome.message
          if (ownerOutcome.retryable !== undefined) task.retryable = ownerOutcome.retryable
          else delete task.retryable
          if (ownerOutcome.code === undefined) delete task.errorCode
          else task.errorCode = ownerOutcome.code
          if (ownerOutcome.retryAfterMillis === undefined) delete task.retryAfterMillis
          else task.retryAfterMillis = ownerOutcome.retryAfterMillis
        } else {
          task.state = 'uncertain'
          task.error = ownerOutcome.message ?? '发送结果待确认，请先核对会话，避免重复发送'
          if (ownerOutcome.code === undefined) delete task.errorCode
          else task.errorCode = ownerOutcome.code
          if (ownerOutcome.retryAfterMillis === undefined) delete task.retryAfterMillis
          else task.retryAfterMillis = ownerOutcome.retryAfterMillis
        }
      } catch (error) {
        task.state = 'failed'
        task.error = error instanceof ArkmePluginError ? error.message : '文件传输中断，请重试'
        if (error instanceof ArkmePluginError) task.errorCode = error.code
        else delete task.errorCode
        if (controller.signal.aborted) task.retryable = true
        else if (error instanceof ArkmePluginError) task.retryable = error.retryable
        else delete task.retryable
      } finally {
        if (!deferred) {
          this.controllers.delete(controller)
          this.planRecovery(task)
          await this.saveTask(userId, state, task)
          if (task.fileRefs.length && !controller.signal.aborted) this.ports.onProgressChange?.(userId, task.taskRef)
        }
      }
    }).catch(() => {
      if (task.delivery === 'progressive' && task.state === 'uncertain') return
      if (ownerOutcome?.kind === 'owner_accepted') {
        task.state = 'sent'; delete task.error; delete task.errorCode
      } else if (ownerOutcome?.kind === 'owner_outcome_unknown') {
        task.state = 'uncertain'
        task.error = ownerOutcome.message ?? '发送结果待确认，请先核对会话，避免重复发送'
        if (ownerOutcome.code === undefined) delete task.errorCode
        else task.errorCode = ownerOutcome.code
      } else {
        task.state = 'failed'
        task.error ??= '本地发送状态保存失败，请重试'
      }
    }).finally(() => { this.scheduled.delete(key); this.armRecovery(userId, state) })
    this.scheduled.set(key, this[lane])
  }

  async reception(mediaRef: string, start = false): Promise<ArkmeFileReception> {
    const userId = await this.ports.currentUser()
    const ordinary=mediaRef.startsWith('arkme-media-v1.')&&mediaRef.length<=100
    const team=mediaRef.startsWith('team-app-media.')&&mediaRef.length<=16_384
    if(!ordinary&&!team)throw fail('media-ref-invalid','原文件引用无效')
    const state = await this.state(userId)
    const key = `${userId}:${mediaRef}`
    const localRef = state.originals[mediaRef]
    if (localRef) {
      try { const { file } = await this.readLocal(localRef); return { state: 'ready', receivedBytes: file.size, totalBytes: file.size, file } }
      catch { delete state.originals[mediaRef] }
    }
    const existing = this.receptions.get(key)
    if (existing?.state === 'receiving' || !start) return clone(existing ?? { state: 'missing', receivedBytes: 0, totalBytes: 0 })
    if ([...this.receptions.values()].filter(value => value.state === 'receiving').length >= 2) throw fail('file-download-busy', '已有两个文件正在接收，请稍后重试')
    const progress: ArkmeFileReception = { state: 'receiving', receivedBytes: 0, totalBytes: 0 }
    this.receptions.set(key, progress)
    const controller = new AbortController(); this.controllers.add(controller)
    const temporary = join(this.root(userId), `${randomUUID()}.download`)
    const job = (async () => {
      try {
        const { response, descriptor } = await this.ports.fetchMedia(mediaRef, controller.signal)
        if (!response.ok || !response.body) throw fail('file-download-failed', '原文件接收失败')
        const declared = Number(response.headers.get('content-length')) || descriptor.size
        if (declared > this.policy.maxFileBytes) throw fail('file-download-too-large', '原文件超出本地文件大小限制')
        progress.totalBytes = Math.max(0, declared)
        const handle = await open(temporary, 'wx', 0o600)
        try {
          for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
            await this.assertUser(userId, controller.signal)
            progress.receivedBytes += chunk.length
            if (progress.receivedBytes > this.policy.maxFileBytes) throw fail('file-download-too-large', '原文件超出本地文件大小限制')
            await handle.write(chunk)
          }
        } finally { await handle.close() }
        if (!progress.receivedBytes || (declared > 0 && progress.receivedBytes !== declared) || (descriptor.size > 0 && progress.receivedBytes !== descriptor.size)) throw fail('file-download-incomplete', '原文件接收不完整，请重试')
        await this.assertUser(userId, controller.signal)
        const file = await this.stageLocal(temporary, { fileName: descriptor.fileName, mimeType: descriptor.mimeType, size: progress.receivedBytes }, userId, undefined, false, 'received')
        state.originals[mediaRef] = file.fileRef
        await this.save(userId, state)
        progress.file = file; progress.state = 'ready'
      } catch (error) { progress.state = 'failed'; progress.error = error instanceof ArkmePluginError ? error.message : '文件接收失败，请重试' }
      finally { await unlink(temporary).catch(() => {}); this.controllers.delete(controller) }
    })()
    this.jobs.add(job); void job.finally(() => this.jobs.delete(job))
    return clone(progress)
  }
}
