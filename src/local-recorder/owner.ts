import { randomUUID, createHash } from 'node:crypto'
import { copyFile, mkdir, open, readFile, readdir, rename, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { ArkmeService } from '../arkme-service.js'
import { ArkmePluginError } from '../services/service.js'
import { recordingCreateRequestUID } from '../recording-import-identity.js'
import { MAX_RECORDING_IMPORT_BYTES, MAX_RECORDING_IMPORT_DURATION_MILLIS, validRecordingImportTaskId } from '../recording-import-contract.js'
import type { LocalRecorderAudio, LocalRecorderDevice, LocalRecorderSnapshot } from './contract.js'
import { recorderCatalog } from './catalog.js'
import { RecorderProtocol } from './protocol.js'
import { recorderSerialProvider, isRecorderPort, type RecorderPort, type RecorderSerialProvider } from './serial.js'
import { atomicWrite, decodeRecorderAudio, digest, readRecorderBlock, recorderBlockPages, syncRecorderVolume, type RecorderManifest } from './volume.js'

interface Account { scope: string; userId: number }
interface StoredDevice { version: 1; device: LocalRecorderDevice; manifest?: RecorderManifest; archives?: RecorderManifest[] }
interface Media extends LocalRecorderAudio { path: string; scope: string; hash: string }
interface Job { scope: string; controller: AbortController; promise: Promise<void> }
const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id)
const fail = (message: string, status = 409) => new ArkmePluginError('local-recorder-unavailable', message, true, status)

export class LocalRecorderOwner {
  private readonly ports = new Map<string, RecorderPort>()
  private readonly jobs = new Map<string, Job>()
  private readonly busyPorts = new Set<string>()
  private readonly preparing = new Map<string, Promise<Media>>()
  private readonly media = new Map<string, Media>()
  private mediaLifetime = new AbortController()
  private currentScope = ''
  private readonly importing = new Map<string, Promise<unknown>>()
  private discovering = false
  private closed = false
  constructor(private readonly directory: string,
    private readonly service: Pick<ArkmeService, 'recordingImportUserId' | 'acceptRecordingImport' | 'recordingImportReceipt'>,
    private readonly serial: RecorderSerialProvider = recorderSerialProvider,
    private readonly supported = ['darwin', 'win32'].includes(process.platform),
    private readonly namespace = 'local') {}

  private async account(): Promise<Account> {
    if (this.closed) throw fail('设备服务已关闭')
    const userId = await this.service.recordingImportUserId(), scope = digest(`${this.namespace}:${userId}`)
    if (this.currentScope && this.currentScope !== scope) this.cancelActive()
    this.currentScope = scope
    for (const job of this.jobs.values()) if (job.scope !== scope) job.controller.abort()
    return { userId, scope }
  }
  private async guard(account: Account) {
    const current = await this.account()
    if (current.scope !== account.scope) throw fail('账号已切换，设备操作已停止')
  }
  private deviceDirectory(account: Account, id: string) {
    if (!validId(id)) throw fail('设备标识无效', 400)
    return join(this.directory, account.scope, id)
  }
  private async load(account: Account, id: string): Promise<StoredDevice> {
    const row = JSON.parse(await readFile(join(this.deviceDirectory(account, id), 'device.json'), 'utf8')) as StoredDevice
    if (row.version !== 1 || row.device.id !== id || !Array.isArray(row.device.recordings)) throw fail('本机设备索引无效')
    return row
  }
  private async save(account: Account, row: StoredDevice) {
    await this.guard(account)
    const directory = this.deviceDirectory(account, row.device.id)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await atomicWrite(join(directory, 'device.json'), JSON.stringify(row))
  }
  async snapshot(): Promise<LocalRecorderSnapshot> {
    const account = await this.account(), devices: LocalRecorderDevice[] = []
    let supported = this.supported, reason = supported ? '' : '本地设备目前支持 Windows 和 macOS 桌面端'
    if (this.supported) {
      try {
        const paths = new Set((await this.serial.list()).map(port => port.path))
        for (const [id, port] of this.ports) if (!paths.has(port.path)) this.ports.delete(id)
      } catch { supported = false; reason = '串口组件暂不可用，请更新桌面运行环境或检查驱动后重试。已缓存录音仍可播放。' }
    }
    let names: string[] = []
    try { names = await readdir(join(this.directory, account.scope)) } catch { /* First use. */ }
    for (const id of names.filter(validId)) {
      try {
        const row = await this.load(account, id)
        const job = row.device.job?.state === 'syncing' && !this.jobs.has(`${account.scope}:${id}`)
          ? { ...row.device.job, state: 'stopped' as const, detail: '上次同步已停止，可继续读取' } : row.device.job
        devices.push({ ...row.device, recordings: row.device.recordings.slice(0, 100), recordingCount: row.device.recordings.length, connected: this.ports.has(id), job })
      } catch { /* A damaged local index must not expose another account's state. */ }
    }
    await this.guard(account)
    return { supported, ...(reason ? { reason } : {}), devices }
  }
  async discover(signal: AbortSignal): Promise<LocalRecorderSnapshot> {
    if (!this.supported) return this.snapshot()
    if (this.discovering) throw fail('正在查找设备，请稍候')
    const account = await this.account()
    this.discovering = true
    try {
      const candidates = (await this.serial.list()).filter(isRecorderPort).slice(0, 16)
      const visible = new Set(candidates.map(port => port.path))
      for (const [id, port] of this.ports) if (!visible.has(port.path)) this.ports.delete(id)
      for (const candidate of candidates) {
        signal.throwIfAborted(); await this.guard(account)
        if (this.busyPorts.has(candidate.path)) continue
        this.busyPorts.add(candidate.path)
        let connection
        try {
          connection = await this.serial.open(candidate)
          const protocol = new RecorderProtocol(connection)
          const probeSignal = AbortSignal.any([signal, AbortSignal.timeout(3000)])
          await protocol.info(probeSignal)
          const id = digest(`arkme-recorder:${candidate.serialNumber || candidate.path}`)
          let row: StoredDevice
          try { row = await this.load(account, id) } catch {
            row = { version: 1, device: { id, name: 'Arkme Recorder', serialNumber: candidate.serialNumber ?? null,
              connected: true, storage: null, recordings: [], recordingCount: 0, updatedAtMillis: 0, job: null } }
          }
          try { row.device.storage = await protocol.storage(probeSignal) } catch (error) {
            signal.throwIfAborted()
            // Older firmware can still sync; capacity remains explicitly unavailable.
            row.device.storage = null
          }
          this.ports.set(id, candidate)
          row.device.updatedAtMillis = Date.now(); await this.save(account, row)
        } catch (error) {
          signal.throwIfAborted()
          for (const [id, port] of this.ports) if (port.path === candidate.path) this.ports.delete(id)
        } finally { await connection?.close(); this.busyPorts.delete(candidate.path) }
      }
      return await this.snapshot()
    } finally { this.discovering = false }
  }
  async sync(id: string): Promise<LocalRecorderSnapshot> {
    const account = await this.account(), key = `${account.scope}:${id}`, candidate = this.ports.get(id)
    if (!this.supported || !candidate) throw fail('请先查找并连接录音器')
    if (this.jobs.has(key) || this.busyPorts.has(candidate.path)) throw fail('此录音器正在使用中')
    const row = await this.load(account, id), controller = new AbortController()
    if (this.busyPorts.has(candidate.path)) throw fail('此录音器正在使用中')
    this.busyPorts.add(candidate.path)
    row.device.job = { state: 'syncing', blocks: 0, detail: '正在读取录音卷' }
    try { await this.save(account, row) } catch (error) { this.busyPorts.delete(candidate.path); throw error }
    const promise = this.runSync(account, candidate, row, controller.signal).finally(() => {
      this.jobs.delete(key); this.busyPorts.delete(candidate.path)
    })
    this.jobs.set(key, { scope: account.scope, controller, promise })
    return this.snapshot()
  }
  private async runSync(account: Account, candidate: RecorderPort, row: StoredDevice, signal: AbortSignal) {
    let connection
    try {
      connection = await this.serial.open(candidate)
      const protocol = new RecorderProtocol(connection)
      await protocol.info(signal)
      await syncRecorderVolume(protocol, this.deviceDirectory(account, row.device.id), signal, async (manifest, detail) => {
        if (row.manifest && row.manifest.volume !== manifest.volume) {
          row.archives ??= []
          if (!row.archives.some(old => old.volume === row.manifest!.volume)) row.archives.push(row.manifest)
        }
        row.manifest = manifest; row.device.job = { state: 'syncing', blocks: manifest.blocks.length, detail }
        await this.save(account, row)
      }, () => this.guard(account))
      try { row.device.storage = await protocol.storage(signal) } catch { signal.throwIfAborted() }
      row.device.job = { state: 'completed', blocks: row.manifest?.blocks.length ?? 0, detail: '同步完成' }
    } catch (error) {
      row.device.job = { state: signal.aborted ? 'stopped' : 'failed', blocks: row.manifest?.blocks.length ?? 0,
        detail: signal.aborted ? '已停止，已读取内容保留，可继续同步' : '读取中断，已保留进度。请检查设备连接后继续同步。' }
    } finally {
      await connection?.close()
      try {
        if (row.manifest) {
          const current = await recorderCatalog(this.deviceDirectory(account, row.device.id), row.manifest)
          row.device.recordings = [...row.device.recordings.filter(recording => !recording.id.startsWith(`${row.manifest!.volume}.`)), ...current]
        }
        row.device.updatedAtMillis = Date.now(); await this.save(account, row)
      } catch { /* Account switch or invalid cache: retain the last committed index. */ }
    }
  }
  async stop(id: string) {
    const account = await this.account()
    if (!validId(id)) throw fail('设备标识无效', 400)
    this.jobs.get(`${account.scope}:${id}`)?.controller.abort()
    return this.snapshot()
  }
  async recordings(id: string, offset: number, revision: number) {
    const account = await this.account(), row = await this.load(account, id)
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > row.device.recordings.length) throw fail('录音分页参数无效', 400)
    if (revision !== row.device.updatedAtMillis) throw fail('录音列表已变化，请重新选择设备后继续')
    await this.guard(account)
    return { items: row.device.recordings.slice(offset, offset + 100), total: row.device.recordings.length, revision }
  }
  async prepare(id: string, recordingId: string): Promise<LocalRecorderAudio> {
    const account = await this.account(), key = `${account.scope}:${id}:${recordingId}`
    let promise = this.preparing.get(key)
    if (!promise) {
      if (this.preparing.size >= 2) throw fail('正在准备其他音频，请稍候')
      promise = this.buildAudio(account, id, recordingId).finally(() => this.preparing.delete(key))
      this.preparing.set(key, promise)
    }
    const { path, scope, hash, ...result } = await promise
    await this.guard(account)
    return result
  }
  private async buildAudio(account: Account, id: string, recordingId: string): Promise<Media> {
    const lifetime = this.mediaLifetime.signal
    const row = await this.load(account, id), recording = row.device.recordings.find(item => item.id === recordingId)
    const manifest = [row.manifest, ...(row.archives ?? [])].find(value => value && recordingId.startsWith(`${value.volume}.`))
    if (!manifest || !recording || recording.id !== `${manifest.volume}.${recording.sessionId}`) throw fail('请先同步这条录音')
    const directory = this.deviceDirectory(account, id), temporary = join(directory, `${randomUUID()}.wav.part`)
    const handle = await open(temporary, 'wx', 0o600)
    let bytes = 0
    try {
      await handle.writeFile(Buffer.alloc(44))
      for (const block of manifest.blocks) {
        lifetime.throwIfAborted(); await this.guard(account)
        for (const page of recorderBlockPages(await readRecorderBlock(directory, manifest, block))) {
          if (page.type !== 4 || page.sessionId !== recording.sessionId) continue
          const pcm = decodeRecorderAudio(page); bytes += pcm.length
          if (bytes + 44 > MAX_RECORDING_IMPORT_BYTES) throw fail('这条录音超过 1 GB，请使用原客户端分段导出')
          await handle.writeFile(pcm)
        }
      }
      if (!bytes) throw fail('这条录音没有已缓存的音频')
      const header = Buffer.alloc(44)
      header.write('RIFF'); header.writeUInt32LE(bytes + 36, 4); header.write('WAVEfmt ', 8)
      header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22)
      header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34)
      header.write('data', 36); header.writeUInt32LE(bytes, 40)
      await handle.write(header, 0, 44, 0); await handle.sync(); await handle.close()
      // Includes the header so import's SHA256 is the exact file identity.
      const sha = createHash('sha256'); const file = await open(temporary, 'r')
      try { for await (const chunk of file.createReadStream()) sha.update(chunk) } finally { await file.close() }
      const fileHash = sha.digest('hex'), ref = digest(`${account.scope}:${id}:${recordingId}:${fileHash}`)
      const path = join(directory, `${ref}.wav`)
      lifetime.throwIfAborted(); await this.guard(account)
      // Windows cannot replace a WAV held open by the player. Content-addressed
      // output is immutable; verify and reuse an existing copy instead.
      let existing = false
      try {
        if ((await stat(path)).size === bytes + 44) {
          const oldHash = createHash('sha256'), old = await open(path, 'r')
          try { for await (const chunk of old.createReadStream()) oldHash.update(chunk) } finally { await old.close() }
          existing = oldHash.digest('hex') === fileHash
        }
      } catch { /* No verified output yet. */ }
      if (existing) await unlink(temporary)
      else await rename(temporary, path)
      const media: Media = { ref, path, scope: account.scope, hash: fileHash,
        fileName: `Arkme-${row.device.serialNumber?.replace(/[^a-zA-Z0-9_-]/g, '_') || id.slice(0, 8)}-${manifest.volume.slice(0, 8)}-${recording.sessionId}-${fileHash.slice(0, 8)}.wav`,
        durationMillis: Math.floor(bytes / 32), size: bytes + 44 }
      this.media.set(ref, media)
      // Bounded handles; audio files remain durable and can be prepared again.
      if (this.media.size > 256) this.media.delete(this.media.keys().next().value!)
      return media
    } finally { await handle.close().catch(() => undefined); await unlink(temporary).catch(() => undefined) }
  }
  async resolveAudio(ref: string): Promise<Media & { signal: AbortSignal }> {
    const account = await this.account(), media = this.media.get(ref)
    if (!validId(ref) || !media || media.scope !== account.scope) throw fail('音频引用已失效，请重新点击播放', 404)
    if ((await stat(media.path)).size !== media.size) throw fail('本机音频文件已变化，请重新同步')
    await this.guard(account)
    return { ...media, signal: this.mediaLifetime.signal }
  }
  async importAudio(id: string, recordingId: string, startAtMillis: number, ownership: string): Promise<unknown> {
    const account = await this.account(), key = `${account.scope}:${id}:${recordingId}:${startAtMillis}:${ownership}`
    let promise = this.importing.get(key)
    if (!promise) {
      promise = this.admitAudio(id, recordingId, startAtMillis, ownership).finally(() => this.importing.delete(key))
      this.importing.set(key, promise)
    }
    return await promise
  }
  private async admitAudio(id: string, recordingId: string, startAtMillis: number, ownership: string) {
    const account = await this.account(), row = await this.load(account, id)
    if (!row.device.recordings.find(item => item.id === recordingId)?.complete) throw fail('录音尚未结束，请完成同步后再导入')
    if (!Number.isSafeInteger(startAtMillis) || startAtMillis <= 0 || startAtMillis > Date.now()
      || !['self', 'other'].includes(ownership)) throw fail('请核对真实录音时间及归属', 400)
    const prepared = await this.prepare(id, recordingId)
    const audio = await this.resolveAudio(prepared.ref)
    if (audio.durationMillis > MAX_RECORDING_IMPORT_DURATION_MILLIS) throw fail('导入单条录音最长支持 10 小时，请先分段导出')
    const receiptPath = join(this.deviceDirectory(account, id), `import-${digest(`${audio.hash}:${startAtMillis}:${ownership}`)}.json`)
    let taskId = ''
    try { taskId = JSON.parse(await readFile(receiptPath, 'utf8')).taskId as string } catch { /* New admission. */ }
    if (taskId && validRecordingImportTaskId(taskId)) {
      const receipt = await this.service.recordingImportReceipt(taskId, account.userId)
      if (receipt) { await this.guard(account); return receipt }
    } else if (taskId) throw fail('此导入已超过续传期限，请在导入记录中核对后处理')
    else { taskId = recordingCreateRequestUID(); await atomicWrite(receiptPath, JSON.stringify({ taskId })) }
    const temporary = join(this.deviceDirectory(account, id), `${randomUUID()}.upload`)
    let accepted = false
    try {
      await copyFile(audio.path, temporary); await this.guard(account)
      if (await this.service.recordingImportUserId() !== account.userId) throw fail('账号已切换，导入已停止')
      const job = await this.service.acceptRecordingImport(temporary, { clientTaskId: taskId, fileName: audio.fileName,
        mimeType: 'audio/wav', fileSize: audio.size, sha256: audio.hash, startAtMillis,
        belongUserId: ownership === 'self' ? account.userId : 0, recordingKind: 0 }, account.userId)
      accepted = true; await this.guard(account); return job
    } finally { if (!accepted) await unlink(temporary).catch(() => undefined) }
  }
  async dispose() {
    this.closed = true
    this.cancelActive()
    await Promise.allSettled([...this.jobs.values()].map(job => job.promise))
    await Promise.allSettled([...this.preparing.values(), ...this.importing.values()])
  }
  cancelActive() {
    this.mediaLifetime.abort(); this.mediaLifetime = new AbortController()
    for (const job of this.jobs.values()) job.controller.abort()
    this.media.clear()
  }
}
