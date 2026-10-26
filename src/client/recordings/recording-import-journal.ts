import type { RecordingImportBatch } from '../../recording-workflow-contract.js'

export interface RecordingFileHandle {
  name: string
  kind: 'file'
  getFile(): Promise<File>
  queryPermission(options: { mode: 'read' }): Promise<PermissionState>
  requestPermission(options: { mode: 'read' }): Promise<PermissionState>
}
export type ImportFileSource = { kind: 'handle'; handle: RecordingFileHandle }
  | { kind: 'file'; file: File }
  | { kind: 'desktop'; token: string }

export interface ImportQueueRecord {
  id: string
  accountKey: string
  fileName: string
  fileSize: number
  lastModified: number
  mimeType: string
  source: ImportFileSource
  selected: boolean
  startAt: string
  strategy?: import('../../recording-strategy-contract.js').RecordingStrategy
  ownership: 'self' | 'other'
  /** Absent means a candidate, never permission to upload it automatically. */
  submission?: string
  batch?: RecordingImportBatch
  error: string
  needsAccess?: boolean
}

export interface ImportJournal {
  list(accountKey: string): Promise<ImportQueueRecord[]>
  change(upserts: ImportQueueRecord[], removals: string[]): Promise<void>
}

export interface DesktopImportBridge {
  version: 1
  list(accountKey: string): Promise<ImportQueueRecord[]>
  change(accountKey: string, upserts: ImportQueueRecord[], removals: string[]): Promise<void>
  pick(): Promise<Array<{ token: string; name: string; size: number; lastModified: number }>>
  capture(files: File[]): Promise<Array<{ token: string; name: string; size: number; lastModified: number }>>
  read(token: string, start: number, end: number): Promise<Uint8Array>
  stat(token: string): Promise<{ name: string; size: number; lastModified: number }>
  upload(token: string, request: { id: string; path: string; headers: Record<string, string> }): Promise<unknown>
  cancel(id: string): Promise<void>
}

export function desktopImportBridge(): DesktopImportBridge | undefined {
  if (typeof window === 'undefined') return undefined
  const bridge = (window as unknown as { arkmeDesktop?: { recordingImports?: DesktopImportBridge } }).arkmeDesktop?.recordingImports
  return bridge?.version === 1 ? bridge : undefined
}

export class IndexedImportJournal implements ImportJournal {
  private database: Promise<IDBDatabase> | undefined
  constructor(private readonly factory: IDBFactory = indexedDB) {}
  private open(): Promise<IDBDatabase> {
    return this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory.open('arkme.recording-import-queue.v1', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('queue', { keyPath: 'id' }).createIndex('account', 'accountKey')
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('队列存储被旧窗口占用，请关闭旧窗口后重试'))
      request.onsuccess = () => {
        request.result.onversionchange = () => { request.result.close(); this.database = undefined }
        resolve(request.result)
      }
    }).catch(error => { this.database = undefined; throw error })
  }
  private async transaction<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore, done: (value: T) => void) => void): Promise<T> {
    const db = await this.open()
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('queue', mode)
      let value: T
      tx.oncomplete = () => resolve(value)
      tx.onabort = () => reject(tx.error ?? new Error('导入队列保存失败，请检查可用空间'))
      tx.onerror = () => { /* Only transaction completion acknowledges durable storage. */ }
      try { work(tx.objectStore('queue'), result => { value = result }) }
      catch (error) { tx.abort(); reject(error) }
    })
  }
  async list(accountKey: string): Promise<ImportQueueRecord[]> {
    return await this.transaction('readonly', (store, done) => {
      const request = store.index('account').getAll(accountKey)
      request.onsuccess = () => done(request.result as ImportQueueRecord[])
    })
  }
  async change(upserts: ImportQueueRecord[], removals: string[]): Promise<void> {
    await this.transaction<void>('readwrite', store => {
      for (const id of removals) store.delete(id)
      for (const row of upserts) store.put(row)
    })
  }
}

export function createImportJournal(accountKey: string): ImportJournal {
  const bridge = desktopImportBridge()
  if (bridge) return { list: async () => await bridge.list(accountKey), change: async (upserts, removals) => await bridge.change(accountKey, upserts, removals) }
  return new IndexedImportJournal()
}

export class ImportFileAccessError extends Error {}

/** Metadata placeholder only. Never read or upload it before resolveImportFile. */
export function importFilePlaceholder(record: Pick<ImportQueueRecord, 'fileName' | 'fileSize' | 'lastModified' | 'mimeType'>): File {
  const file = new File([], record.fileName, { lastModified: record.lastModified, type: record.mimeType })
  Object.defineProperty(file, 'size', { value: record.fileSize })
  return file
}

export async function resolveImportFile(record: ImportQueueRecord, requestAccess = false): Promise<File> {
  const source = record.source
  let file: File
  try {
    if (source.kind === 'desktop') {
      const bridge = desktopImportBridge()
      if (!bridge) throw new ImportFileAccessError('请在原桌面客户端恢复此文件的访问')
      const metadata = await bridge.stat(source.token)
      file = importFilePlaceholder({ ...record, fileName: metadata.name, fileSize: metadata.size, lastModified: metadata.lastModified })
    } else if (source.kind === 'handle') {
      // requestPermission must be invoked from the click before any disk awaits.
      const permission = await (requestAccess ? source.handle.requestPermission({ mode: 'read' }) : source.handle.queryPermission({ mode: 'read' }))
      if (permission !== 'granted') throw new ImportFileAccessError('需要恢复文件访问')
      file = await source.handle.getFile()
    } else file = source.file
  } catch (error) {
    if (error instanceof ImportFileAccessError) throw error
    throw new ImportFileAccessError('文件暂时无法访问，请确认原文件仍在原位置并恢复访问')
  }
  const awaitingMetadata = source.kind === 'handle' && record.fileSize === 0 && record.lastModified === 0
  if (file.name !== record.fileName || (!awaitingMetadata && (file.size !== record.fileSize || file.lastModified !== record.lastModified))) {
    throw new ImportFileAccessError('原文件已改变，已暂停导入；请移除此项后重新选择文件')
  }
  return file
}

/** One owner per account/origin. The lock is released automatically on document death. */
export async function ownImportQueue(accountKey: string, signal: AbortSignal, work: () => Promise<void>, waiting: () => void): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.locks) throw new Error('当前浏览器无法安全恢复导入队列，请使用最新版桌面端或 Chrome / Edge')
  waiting()
  await navigator.locks.request(`arkme.recording-import:${accountKey}`, { signal }, async () => {
    signal.throwIfAborted()
    await work()
    if (!signal.aborted) await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
  })
}
