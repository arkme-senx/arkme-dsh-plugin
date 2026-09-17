/** Origin-local, account-partitioned PCM journal. A committed chunk and its index are atomic. */
export interface LocalMicrophoneRecording {
  id: string
  accountKey: string
  userId: number
  startedAt: number
  sampleRate: number
  bytes: number
  chunks: number
  finished: boolean
  fileName: string
}

export interface MicrophoneJournal {
  list(accountKey: string): Promise<LocalMicrophoneRecording[]>
  create(record: LocalMicrophoneRecording): Promise<void>
  append(id: string, pcm: ArrayBuffer): Promise<void>
  finish(id: string): Promise<void>
  file(id: string, tail?: readonly ArrayBuffer[]): Promise<File>
  remove(id: string): Promise<void>
}

export function pcmWaveHeader(bytes: number, sampleRate: number): ArrayBuffer {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes % 2 !== 0 || bytes > 0xffffffff - 36
    || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error('录音数据无效')
  const header = new ArrayBuffer(44)
  const view = new DataView(header)
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)) }
  text(0, 'RIFF'); view.setUint32(4, bytes + 36, true); text(8, 'WAVE'); text(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, bytes, true)
  return header
}

export class IndexedMicrophoneJournal implements MicrophoneJournal {
  private database: Promise<IDBDatabase> | undefined
  private open(): Promise<IDBDatabase> {
    if (!this.database) this.database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('arkme.microphone-recordings.v1', 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('recordings', { keyPath: 'id' }).createIndex('account', 'accountKey')
        request.result.createObjectStore('chunks', { keyPath: ['id', 'sequence'] }).createIndex('recording', 'id')
      }
      request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result) }
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('本地录音存储被其他页面占用，请关闭旧预览后重试'))
    }).catch(error => { this.database = undefined; throw error })
    return this.database
  }
  private async transaction<T>(mode: IDBTransactionMode, action: (tx: IDBTransaction, done: (value: T) => void) => void): Promise<T> {
    const db = await this.open()
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(['recordings', 'chunks'], mode)
      let result: T
      tx.oncomplete = () => resolve(result)
      tx.onabort = () => reject(tx.error ?? new Error('本地录音保存失败，请检查磁盘空间'))
      tx.onerror = () => { /* onabort owns the failure; never report success before commit. */ }
      try { action(tx, value => { result = value }) } catch (error) { tx.abort(); reject(error) }
    })
  }
  async list(accountKey: string): Promise<LocalMicrophoneRecording[]> {
    return await this.transaction('readonly', (tx, done) => {
      const request = tx.objectStore('recordings').index('account').getAll(accountKey)
      request.onsuccess = () => done((request.result as LocalMicrophoneRecording[]).sort((a, b) => b.startedAt - a.startedAt))
    })
  }
  async create(record: LocalMicrophoneRecording): Promise<void> {
    await this.transaction<void>('readwrite', tx => { tx.objectStore('recordings').add(record) })
  }
  async append(id: string, pcm: ArrayBuffer): Promise<void> {
    await this.transaction<void>('readwrite', tx => {
      const records = tx.objectStore('recordings')
      const request = records.get(id)
      request.onsuccess = () => {
        const record = request.result as LocalMicrophoneRecording | undefined
        if (!record || record.finished) { tx.abort(); return }
        tx.objectStore('chunks').add({ id, sequence: record.chunks, pcm })
        records.put({ ...record, bytes: record.bytes + pcm.byteLength, chunks: record.chunks + 1 })
      }
    })
  }
  async finish(id: string): Promise<void> {
    await this.transaction<void>('readwrite', tx => {
      const store = tx.objectStore('recordings'); const request = store.get(id)
      request.onsuccess = () => { if (request.result) store.put({ ...request.result, finished: true }) }
    })
  }
  async file(id: string, tail: readonly ArrayBuffer[] = []): Promise<File> {
    const { record, chunks } = await this.transaction<{ record: LocalMicrophoneRecording; chunks: ArrayBuffer[] }>('readonly', (tx, done) => {
      const records = tx.objectStore('recordings').get(id)
      const chunks = tx.objectStore('chunks').index('recording').getAll(id)
      let record: LocalMicrophoneRecording
      let parts: ArrayBuffer[]
      const finish = () => { if (record && parts) done({ record, chunks: parts }) }
      records.onsuccess = () => { record = records.result; if (!record) tx.abort(); else finish() }
      chunks.onsuccess = () => { parts = (chunks.result as { sequence: number; pcm: ArrayBuffer }[]).sort((a, b) => a.sequence - b.sequence).map(row => row.pcm); finish() }
    })
    const all = [...chunks, ...tail]
    const bytes = all.reduce((sum, part) => sum + part.byteLength, 0)
    if (!bytes) throw new Error('尚未录到音频，请重新开始录音')
    return new File([pcmWaveHeader(bytes, record.sampleRate), ...all], record.fileName, { type: 'audio/wav' })
  }
  async remove(id: string): Promise<void> {
    await this.transaction<void>('readwrite', tx => {
      tx.objectStore('recordings').delete(id)
      const cursor = tx.objectStore('chunks').index('recording').openCursor(id)
      cursor.onsuccess = () => { const value = cursor.result; if (value) { value.delete(); value.continue() } }
    })
  }
}
