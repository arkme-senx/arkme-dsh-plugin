import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, copyFile, link, mkdir, open, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { arkmeNormalizedFileMimeType, arkmePickedFileKind, type ArkmeFileOpenResult, type ArkmeFilePolicy, type ArkmeFileProgress, type ArkmeFileReception, type ArkmeFileSendInput, type ArkmeFileSendTask, type ArkmeLocalFile } from '../file-transfer-contract.js'
import type { ArkmeUploadedAsset, ArkmeSourceSendResult } from '../types.js'
import { ArkmePluginError } from './service.js'
import { ARKME_TOOL_FILE_MAX_BYTES } from '../file-transfer-contract.js'

type Metadata = Pick<ArkmeLocalFile, 'fileName' | 'mimeType' | 'size'>
interface StoredFile extends ArkmeLocalFile { sha256: string; createdAtMillis: number; asset?: ArkmeUploadedAsset }
interface FileState { version: 1; files: Record<string, StoredFile>; tasks: ArkmeFileSendTask[]; originals: Record<string, string> }
export interface FileTransferPorts {
  currentUser(): Promise<number>
  validateSource(sourceRef: string): Promise<void>
  upload(path: string, metadata: StoredFile, progress: (value: ArkmeFileProgress) => void, userId: number, signal: AbortSignal): Promise<ArkmeUploadedAsset>
  send(input: ArkmeFileSendInput, assets: ArkmeUploadedAsset[], userId: number, signal: AbortSignal): Promise<ArkmeSourceSendResult>
  fetchMedia(ref: string, signal: AbortSignal): Promise<{ response: Response; descriptor: Metadata }>
  openPath?(path: string, signal: AbortSignal): Promise<void>
  reconcile?(input: ArkmeFileSendInput, signal: AbortSignal): Promise<ArkmeSourceSendResult | undefined>
}
const REF = /^arkme-file-v1\.[0-9a-f-]{36}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const fail = (code: string, message: string) => new ArkmePluginError(code, message, false, 400)
const clone = <T>(value: T): T => structuredClone(value)
const publicFile = (file: ArkmeLocalFile): ArkmeLocalFile => ({ fileRef: file.fileRef, fileName: file.fileName, mimeType: file.mimeType, size: file.size, fileKind: file.fileKind })
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
  private mutations: Promise<unknown> = Promise.resolve()
  private queue: Promise<void> = Promise.resolve()
  private readonly jobs = new Set<Promise<void>>()
  private readonly controllers = new Set<AbortController>()
  private readonly receptions = new Map<string, ArkmeFileReception>()
  private readonly policy: ArkmeFilePolicy

  constructor(private readonly directory: string, private readonly ports: FileTransferPorts, maxBytes: number) {
    this.policy = { version: 1, maxFileBytes: maxBytes, maxImageBytes: Math.min(maxBytes, 50 * 1024 * 1024), maxAttachments: 9 }
  }

  capabilities(): ArkmeFilePolicy { return { ...this.policy } }
  cancelActive(): void { for (const controller of this.controllers) controller.abort(); this.receptions.clear() }
  async settled(): Promise<void> { await this.queue; await Promise.all(this.jobs); await this.writes }

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
    try {
      await link(source, target)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const info = await stat(target).catch(() => undefined)
      if (!info?.isFile() || info.size !== file.size) {
        await unlink(target).catch(() => {})
        await link(source, target)
      }
    }
    await chmod(target, 0o600)
    return target
  }
  private async assertUser(userId: number, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    if (await this.ports.currentUser() !== userId) throw fail('file-account-changed', '账号已切换，请在原账号中重试')
    signal?.throwIfAborted()
  }
  private state(userId: number): Promise<FileState> {
    let loaded = this.states.get(userId)
    if (loaded === undefined) {
      loaded = (async () => {
        await mkdir(this.root(userId), { recursive: true, mode: 0o700 })
        let state: FileState
        try { state = JSON.parse(await readFile(join(this.root(userId), 'state.json'), 'utf8')) as FileState }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw fail('file-state-invalid', '本地文件状态无法读取，请勿重复发送')
          return { version: 1 as const, files: {}, tasks: [], originals: {} }
        }
        if (state.version !== 1 || !state.files || !Array.isArray(state.tasks) || !state.originals) throw fail('file-state-invalid', '本地文件状态版本无效')
        for (const task of state.tasks) {
          if (task.state === 'sending') { task.state = 'uncertain'; task.error = '发送结果待确认，请先核对会话，避免重复发送' }
          else if (task.state === 'queued' || task.state === 'uploading') { task.state = 'failed'; task.error = '上次传输已中断，请重试' }
        }
        return state
      })()
      this.states.set(userId, loaded)
    }
    return loaded
  }
  private save(userId: number, state: FileState): Promise<void> {
    const data = JSON.stringify(state)
    const write = this.writes.catch(() => {}).then(async () => {
      const target = join(this.root(userId), 'state.json')
      const temporary = `${target}.${randomUUID()}.tmp`
      try { await writeFile(temporary, data, { mode: 0o600 }); await rename(temporary, target) }
      finally { await unlink(temporary).catch(() => {}) }
    })
    this.writes = write
    return write
  }
  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const work = this.mutations.catch(() => {}).then(action)
    this.mutations = work
    return work
  }
  private validateMetadata(metadata: Metadata): void {
    const limit = metadata.mimeType.startsWith('image/') ? this.policy.maxImageBytes : this.policy.maxFileBytes
    if (!metadata.fileName.trim() || metadata.fileName.length > 255 || /[\u0000-\u001f]/.test(metadata.fileName)
      || metadata.mimeType.length > 200 || !/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(metadata.mimeType)
      || !Number.isSafeInteger(metadata.size) || metadata.size <= 0 || metadata.size > limit) {
      throw fail('file-input-invalid', `文件为空或超出限制（${Math.floor(limit / 1024 / 1024)} MiB）`)
    }
  }

  async stage(temporaryPath: string, metadata: Metadata, expectedUserId?: number): Promise<ArkmeLocalFile> {
    const userId = await this.ports.currentUser()
    if (expectedUserId !== undefined && expectedUserId !== userId) throw fail('file-account-changed', '账号已切换，本次文件导入已取消')
    const normalizedMetadata = { ...metadata, mimeType: arkmeNormalizedFileMimeType(metadata.mimeType, metadata.fileName) }
    this.validateMetadata(normalizedMetadata)
    return this.exclusive(async () => {
      const state = await this.state(userId)
      await this.prune(userId, state)
      const used = Object.values(state.files).reduce((sum, file) => sum + file.size, 0)
      if (used + metadata.size > Math.max(this.policy.maxFileBytes, 1024 * 1024 * 1024) || Object.keys(state.files).length >= 256) {
        throw fail('file-cache-full', '本地附件空间不足，请移除不再需要的草稿或失败任务')
      }
      const info = await stat(temporaryPath)
      if (!info.isFile() || info.size !== metadata.size) throw fail('file-size-mismatch', '本地文件不完整')
      const hash = createHash('sha256')
      for await (const chunk of createReadStream(temporaryPath)) hash.update(chunk)
      await this.assertUser(userId)
      const ref = `arkme-file-v1.${randomUUID()}`
      const file: StoredFile = { ...normalizedMetadata, fileRef: ref, fileKind: arkmePickedFileKind(normalizedMetadata.mimeType, normalizedMetadata.fileName), sha256: hash.digest('hex'), createdAtMillis: Date.now() }
      await copyFile(temporaryPath, this.path(userId, ref))
      await chmod(this.path(userId, ref), 0o600)
      state.files[ref] = file
      try { await this.save(userId, state) }
      catch (error) { delete state.files[ref]; await unlink(this.path(userId, ref)).catch(() => {}); throw error }
      return publicFile(file)
    })
  }
  private async prune(userId: number, state: FileState): Promise<void> {
    const retained = new Set(state.tasks.filter(task => task.state !== 'sent').flatMap(task => task.fileRefs))
    const completed = new Set(state.tasks.filter(task => task.state === 'sent').flatMap(task => task.fileRefs))
    for (const file of Object.values(state.files)) {
      if (Date.now() - file.createdAtMillis < 7 * 24 * 3600_000 || retained.has(file.fileRef) || !completed.has(file.fileRef)) continue
      // Unsent drafts are never evicted by cache cleanup.
      delete state.files[file.fileRef]
      await unlink(this.path(userId, file.fileRef)).catch(() => {})
      await rm(this.openDirectory(userId, file.fileRef), { recursive: true, force: true })
    }
    state.tasks = state.tasks.filter(task => task.state !== 'sent' || Date.now() - task.createdAtMillis < 7 * 24 * 3600_000)
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
  async openLocal(ref: string): Promise<ArkmeFileOpenResult> {
    if (this.ports.openPath === undefined) throw fail('file-open-unavailable', '当前宿主不能使用本机应用打开文件')
    const controller = new AbortController()
    this.controllers.add(controller)
    try {
      const userId = await this.ports.currentUser()
      const { file } = await this.readLocal(ref)
      await this.assertUser(userId, controller.signal)
      const path = await this.nativeOpenPath(userId, ref, file)
      await this.assertUser(userId, controller.signal)
      await this.ports.openPath(path, controller.signal)
      await this.assertUser(userId, controller.signal)
      return { opened: true, file }
    } catch (error) {
      if (error instanceof ArkmePluginError) throw error
      throw fail('file-open-failed', '文件打开失败，请重试')
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
      if (state.tasks.some(task => task.fileRefs.includes(ref))) throw fail('file-in-use', '文件仍被本地发送任务引用，请先移除该任务')
      if (!state.files[ref]) return
      delete state.files[ref]; await this.save(userId, state)
      await unlink(this.path(userId, ref)).catch(() => {})
      await rm(this.openDirectory(userId, ref), { recursive: true, force: true })
    })
  }
  async tasks(sourceRef?: string): Promise<ArkmeFileSendTask[]> {
    const state = await this.state(await this.ports.currentUser())
    return clone(state.tasks.filter(task => !sourceRef || task.sourceRef === sourceRef))
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
      const task = state.tasks.find(value => value.taskRef === taskRef)
      if (!task) return
      if (['queued', 'uploading', 'sending'].includes(task.state)) throw fail('file-task-active', '任务仍在进行中，不能移除')
      // Removing a local task never deletes a remote record, or files still used by drafts.
      state.tasks = state.tasks.filter(value => value !== task); await this.save(userId, state)
    })
  }
  async reconcile(taskRef: string): Promise<ArkmeFileSendTask> {
    const userId = await this.ports.currentUser()
    return this.exclusive(async () => {
      const state = await this.state(userId)
      const task = state.tasks.find(value => value.taskRef === taskRef)
      if (!task) throw fail('file-task-missing', '发送任务不存在')
      if (task.state !== 'uncertain') return clone(task)
      const controller = new AbortController(); this.controllers.add(controller)
      try {
        await this.assertUser(userId, controller.signal)
        const result = await this.ports.reconcile?.(task, controller.signal)
        await this.assertUser(userId, controller.signal)
        if (result) { task.result = result; task.state = 'sent'; delete task.error; await this.save(userId, state) }
        // Absence from a recent page is not proof that the send was rejected.
        return clone(task)
      } finally { this.controllers.delete(controller) }
    })
  }
  async enqueue(input: ArkmeFileSendInput): Promise<ArkmeFileSendTask> {
    const userId = await this.ports.currentUser()
    if (!UUID.test(input.recordUid) || !UUID.test(input.relationUid) || !input.sourceRef.trim()
      || input.fileRefs.length < 1 || input.fileRefs.length > this.policy.maxAttachments
      || new Set(input.fileRefs).size !== input.fileRefs.length || (input.content.textContent?.length ?? 0) > 20_000) {
      throw fail('file-send-invalid', '发送标识、正文或附件数量无效')
    }
    await this.ports.validateSource(input.sourceRef)
    return this.exclusive(async () => {
      await this.assertUser(userId)
      const state = await this.state(userId)
      const prior = state.tasks.find(task => task.recordUid === input.recordUid)
      if (prior) {
        if (prior.sourceRef !== input.sourceRef || prior.relationUid !== input.relationUid || JSON.stringify(prior.fileRefs) !== JSON.stringify(input.fileRefs)
          || JSON.stringify(prior.content) !== JSON.stringify(input.content)) throw fail('file-send-conflict', '发送标识已用于另一份内容')
        return clone(prior)
      }
      if (state.tasks.filter(task => task.state !== 'sent').length >= 100) throw fail('file-queue-full', '待发送文件过多，请先处理失败任务')
      const files: ArkmeFileSendTask['files'] = []
      for (const ref of input.fileRefs) {
        const { file } = await this.readLocal(ref)
        files.push({ ...file, progress: { phase: 'preparing', sentBytes: 0, totalBytes: file.size } })
      }
      await this.assertUser(userId)
      const task: ArkmeFileSendTask = { ...clone(input), taskRef: `arkme-send-v1.${randomUUID()}`, createdAtMillis: Date.now(), state: 'queued', files }
      state.tasks.push(task)
      try { await this.save(userId, state) } catch (error) { state.tasks = state.tasks.filter(value => value !== task); throw error }
      this.schedule(userId, state, task)
      return clone(task)
    })
  }
  async uploadRefs(fileRefs: readonly string[], signal?: AbortSignal): Promise<ArkmeUploadedAsset[]> {
    const userId = await this.ports.currentUser()
    if (fileRefs.length < 1 || fileRefs.length > this.policy.maxAttachments
      || new Set(fileRefs).size !== fileRefs.length || fileRefs.some(ref => !REF.test(ref))) {
      throw fail('file-upload-invalid', '请选择 1 至 9 个有效附件')
    }
    return await this.exclusive(async () => {
      await this.assertUser(userId, signal)
      const state = await this.state(userId)
      const controller = new AbortController()
      const abort = () => { controller.abort(signal?.reason) }
      signal?.addEventListener('abort', abort, { once: true })
      this.controllers.add(controller)
      try {
        const assets: ArkmeUploadedAsset[] = []
        for (const fileRef of fileRefs) {
          await this.assertUser(userId, controller.signal)
          const stored = state.files[fileRef]
          if (stored === undefined) throw fail('file-local-missing', '本地附件已不存在')
          let asset = stored.asset
            ?? Object.values(state.files).find(other => other.sha256 === stored.sha256 && other.fileKind === stored.fileKind && other.asset)?.asset
          if (asset === undefined) {
            asset = await this.ports.upload(
              this.path(userId, fileRef), stored, () => {}, userId, controller.signal,
            )
          }
          asset = { ...asset, fileName: stored.fileName }
          stored.asset = asset
          await this.save(userId, state)
          assets.push(asset)
        }
        await this.assertUser(userId, controller.signal)
        return clone(assets)
      } finally {
        signal?.removeEventListener('abort', abort)
        this.controllers.delete(controller)
      }
    })
  }
  async retry(taskRef: string): Promise<ArkmeFileSendTask> {
    const userId = await this.ports.currentUser()
    return this.exclusive(async () => {
      const state = await this.state(userId)
      const task = state.tasks.find(value => value.taskRef === taskRef)
      if (!task) throw fail('file-task-missing', '发送任务不存在')
      await this.assertUser(userId)
      if (task.state === 'uncertain') throw fail('file-send-uncertain', '发送结果待确认，请先核对原会话，不能自动重复发送')
      if (task.state !== 'failed') return clone(task)
      task.state = 'queued'; delete task.error
      for (const file of task.files) {
        if (!file.asset) file.progress = { phase: 'preparing', sentBytes: 0, totalBytes: file.size }
      }
      await this.save(userId, state); this.schedule(userId, state, task)
      return clone(task)
    })
  }
  private schedule(userId: number, state: FileState, task: ArkmeFileSendTask): void {
    const controller = new AbortController(); this.controllers.add(controller)
    this.queue = this.queue.catch(() => {}).then(async () => {
      try {
        await this.assertUser(userId, controller.signal)
        task.state = 'uploading'; await this.save(userId, state)
        for (const file of task.files) {
          await this.assertUser(userId, controller.signal)
          const stored = state.files[file.fileRef]
          if (!stored) throw fail('file-local-missing', '本地附件已不存在')
          if (!file.asset) {
            const cached = stored.asset ?? Object.values(state.files).find(other => other.sha256 === stored.sha256 && other.fileKind === stored.fileKind && other.asset)?.asset
            if (cached) file.asset = cached
            if (!file.asset) file.asset = await this.ports.upload(this.path(userId, file.fileRef), stored, progress => { file.progress = progress }, userId, controller.signal)
            // A reused blob retains this attachment's display name and original ordering.
            file.asset = { ...file.asset, fileName: file.fileName }
            stored.asset = file.asset
            file.progress = { phase: 'ready', sentBytes: file.size, totalBytes: file.size }
            await this.save(userId, state)
          }
        }
        await this.assertUser(userId, controller.signal)
        task.state = 'sending'; await this.save(userId, state)
        task.result = await this.ports.send(task, task.files.map(file => file.asset!), userId, controller.signal)
        task.state = 'sent'; delete task.error
      } catch (error) {
        const sending = task.state === 'sending'
        task.state = sending ? 'uncertain' : 'failed'
        task.error = sending ? '发送结果待确认，请先核对会话，避免重复发送' : error instanceof ArkmePluginError ? error.message : '文件传输中断，请重试'
      } finally {
        this.controllers.delete(controller)
        await this.save(userId, state)
      }
    }).catch(() => { task.state = 'uncertain'; task.error = '本地发送状态保存失败，请先核对会话' })
  }

  async reception(mediaRef: string, start = false): Promise<ArkmeFileReception> {
    const userId = await this.ports.currentUser()
    if (!mediaRef.startsWith('arkme-media-v1.') || mediaRef.length > 100) throw fail('media-ref-invalid', '原文件引用无效')
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
        const file = await this.stage(temporary, { fileName: descriptor.fileName, mimeType: descriptor.mimeType, size: progress.receivedBytes }, userId)
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
