import { ArkmePluginError, type ServiceRuntime } from './service.js'
import type { ArkmeLocalFile } from '../file-transfer-contract.js'

/** Internal metadata; only the durable file owner constructs send placeholders. */
export interface PendingAttachment extends ArkmeLocalFile {
  attachmentUid: string
  generation: number
  backgroundSound?: boolean
  sortOrder: number
}
export interface AttachmentReceipt {
  attachmentUid: string
  generation: number
  state: 'pending' | 'failed' | 'ready' | 'removed'
  fileAssetUid?: string
}
export interface ProgressiveTarget { record_uid: string; attachment_uid: string; generation: number }

export class ProgressiveAttachments {
  constructor(private readonly runtime: ServiceRuntime) {}

  async supported(userId: number, signal: AbortSignal): Promise<boolean> {
    const session = await this.session(userId, signal)
    try {
      const record = await this.runtime.authenticatedPost<Record<string, unknown>>('/api/v1/records/attachments/capability', {}, session, signal)
      const chat = await this.runtime.authenticatedChatPost<Record<string, unknown>>('/api/v1/chats/attachments/capability', {}, session, signal)
      await this.session(userId, signal)
      return record.version === 1 && chat.version === 1 && record.metadata_first_version === 2 && chat.metadata_first_version === 2
    } catch (error) {
      await this.session(userId, signal)
      if (error instanceof ArkmePluginError && [404, 501].includes(error.upstreamStatus ?? error.httpStatus)) return false
      throw error
    }
  }

  async reconcile(recordUid: string, userId: number, signal: AbortSignal): Promise<AttachmentReceipt[]> {
    return this.request('/api/v1/records/attachments/reconcile', { record_uid: recordUid }, userId, signal)
  }

  async retry(target: ProgressiveTarget, userId: number, signal: AbortSignal): Promise<AttachmentReceipt[]> {
    return this.request('/api/v1/records/attachments/change', { ...target, action: 'retry' }, userId, signal)
  }

  private async session(userId: number, signal: AbortSignal) {
    signal.throwIfAborted()
    const session = await this.runtime.requireSession()
    if (session.userId !== userId) throw new ArkmePluginError('file-account-changed', '账号已切换', false, 403)
    return session
  }

  private async request(path: string, body: Record<string, unknown>, userId: number, signal: AbortSignal): Promise<AttachmentReceipt[]> {
    const session = await this.session(userId, signal)
    const result = await this.runtime.authenticatedPost<Record<string, unknown>>(path, body, session, signal)
    await this.session(userId, signal)
    if (result.state === 'removed' || result.content_payload === null) return []
    const payload = result.content_payload as { schema_version?: number; payload_kind?: number; media_refs?: Array<{ file_asset_uid?: string; upload?: { attachment_uid: string; generation: number; state: string } }> } | undefined
    // The Record owner omits media_refs when editing removes the last attachment.
    if (payload?.media_refs === undefined && payload?.schema_version === 1 && Number.isInteger(payload.payload_kind)) return []
    if (!payload || !Array.isArray(payload.media_refs) || payload.media_refs.length > 20) throw new ArkmePluginError('attachment-receipt-invalid', '附件状态响应无效，请重试', true, 502)
    return payload.media_refs.flatMap(ref => {
      const upload = ref.upload
      if (!upload) return []
      if (typeof upload.attachment_uid !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(upload.attachment_uid) || !Number.isSafeInteger(upload.generation) || upload.generation <= 0
        || !['pending', 'failed', 'ready'].includes(upload.state) || (upload.state === 'ready' && (typeof ref.file_asset_uid !== 'string' || !ref.file_asset_uid.trim()))) {
        throw new ArkmePluginError('attachment-receipt-invalid', '附件状态响应无效，请重试', true, 502)
      }
      return [{ attachmentUid: upload.attachment_uid, generation: upload.generation, state: upload.state as AttachmentReceipt['state'], ...(ref.file_asset_uid ? { fileAssetUid: ref.file_asset_uid } : {}) }]
    })
  }
}
