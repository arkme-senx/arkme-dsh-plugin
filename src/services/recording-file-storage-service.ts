import { recordingStorageSessionRefs, type RecordingFileStoragePage } from '../recording-file-storage.js'
import { ArkmePluginError, objectValue, type ServiceRuntime } from './service.js'

/** Account/ref boundary shared by UI, Tools and SDK. Audio alone owns which
 * physical objects count; this adapter never interprets quota or upload sizes. */
export class RecordingFileStorageService {
  constructor(private readonly runtime: ServiceRuntime, private readonly openSession: (ref: string) => Promise<{ sessionId: string }>) {}

  async query(input: { sessionRefs: string[] }, signal?: AbortSignal): Promise<RecordingFileStoragePage> {
    let sessionRefs: string[]
    try { sessionRefs = recordingStorageSessionRefs(input.sessionRefs) }
    catch { throw new ArkmePluginError('recording-storage-invalid', '录音存储查询参数无效', false, 400) }
    signal?.throwIfAborted()
    const session = await this.runtime.requireSession()
    const owners = await Promise.all(sessionRefs.map(ref => this.openSession(ref)))
    const ids = owners.map(owner => owner.sessionId)
    if (new Set(ids).size !== ids.length) throw new ArkmePluginError('recording-storage-invalid', '录音存储查询包含重复文件', false, 400)
    const assertAccount = async () => {
      signal?.throwIfAborted()
      if ((await this.runtime.requireSession()).userId !== session.userId) throw new ArkmePluginError('recording-storage-account-changed', '账号已变化，请重新查看录音', false, 409)
    }
    await assertAccount()
    const raw = objectValue(await this.runtime.authenticatedAudioPost('/api/v1/audio/files/storage', { session_ids: ids }, session, signal, { bypassCache: true }))
    await assertAccount()
    const invalid = (): never => { throw new ArkmePluginError('recording-storage-invalid', '录音存储返回数据无效，请重试', true, 502) }
    if (!Array.isArray(raw.items) || raw.items.length !== ids.length) invalid()
    const rows = new Map<string, Record<string, unknown>>()
    for (const value of raw.items as unknown[]) {
      const row = objectValue(value)
      if (typeof row.session_id !== 'string' || !ids.includes(row.session_id) || rows.has(row.session_id)) invalid()
      rows.set(row.session_id as string, row)
    }
    return { items: sessionRefs.map((sessionRef, i) => {
      const row = rows.get(ids[i]!)!
      if (!row || typeof row.checked_at !== 'number' || !Number.isSafeInteger(row.checked_at) || row.checked_at <= 0
        || typeof row.bytes !== 'number' || !Number.isSafeInteger(row.bytes) || row.bytes < 0) invalid()
      return { sessionRef, bytes: row.bytes as number, checkedAtMillis: row.checked_at as number }
    }) }
  }
}
