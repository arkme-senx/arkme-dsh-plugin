import type { ArkmeUserBanOwnerRecord, ArkmeUserBanOwnerSnapshot } from '../types.js'
import { ArkmePluginError, ServiceRuntime, objectValue, stringValue } from './service.js'

interface PrivateChatPeer {
  userId: number
  displayName: string
}

export interface PrivateChatPeerResolver {
  resolvePrivateChatPeer(sourceRef: string, signal?: AbortSignal): Promise<PrivateChatPeer>
}

function integer(value: unknown): number {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  return 0
}

function optionalRecord(
  raw: unknown,
  sourceRef: string,
  peer: PrivateChatPeer,
): ArkmeUserBanOwnerRecord | undefined {
  const item = objectValue(raw)
  if (Object.keys(item).length === 0) return undefined
  const userId = integer(item.user_id)
  const status = integer(item.status)
  const operatorId = integer(item.operator_id)
  const bannedAtMillis = integer(item.banned_at)
  const unbannedAtMillis = integer(item.unbanned_at)
  const updatedAtMillis = integer(item.updated_at)
  if (userId !== peer.userId || (status !== 1 && status !== 2) || operatorId <= 0
    || bannedAtMillis < 0 || unbannedAtMillis < 0 || updatedAtMillis <= 0
    || (status === 1 && bannedAtMillis <= 0) || (status === 2 && unbannedAtMillis <= 0)) {
    throw new ArkmePluginError('user-ban-contract-invalid', '封禁服务返回的数据不完整', true, 502)
  }
  return {
    sourceRef,
    targetUserId: userId,
    displayName: peer.displayName,
    status: status === 1 ? 'banned' : 'unbanned',
    operatorUserId: operatorId,
    remark: stringValue(item.remark).trim(),
    bannedAtMillis,
    unbannedAtMillis,
    updatedAtMillis,
  }
}

/** Owns employee-only user-ban behavior; Browser, SDK and Tools share this one path. */
export class UserBanService {
  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly peers: PrivateChatPeerResolver,
  ) {}

  async status(sourceRef: string, signal?: AbortSignal): Promise<ArkmeUserBanOwnerSnapshot> {
    const peer = await this.peers.resolvePrivateChatPeer(sourceRef, signal)
    const data = await this.runtime.authenticatedAuthReadPost<Record<string, unknown>>(
      '/api/v1/user-ban/status', { user_id: peer.userId }, undefined, signal,
      { bypassCache: true },
    )
    const exists = data.exists === true
    const record = optionalRecord(data.item, sourceRef, peer)
    if (exists !== (record !== undefined) || data.banned !== (record?.status === 'banned')) {
      throw new ArkmePluginError('user-ban-contract-invalid', '封禁服务返回的数据不完整', true, 502)
    }
    return {
      sourceRef,
      targetUserId: peer.userId,
      displayName: peer.displayName,
      exists,
      banned: record?.status === 'banned',
      ...(record === undefined ? {} : { record }),
    }
  }

  async ban(sourceRef: string, remark = '', signal?: AbortSignal): Promise<ArkmeUserBanOwnerRecord> {
    return await this.setStatus(sourceRef, true, remark, signal)
  }

  async unban(sourceRef: string, remark = '', signal?: AbortSignal): Promise<ArkmeUserBanOwnerRecord> {
    return await this.setStatus(sourceRef, false, remark, signal)
  }

  private async setStatus(
    sourceRef: string,
    banned: boolean,
    remarkInput: string,
    signal?: AbortSignal,
  ): Promise<ArkmeUserBanOwnerRecord> {
    const remark = remarkInput.trim()
    if (Array.from(remark).length > 255) {
      throw new ArkmePluginError('user-ban-remark-invalid', '封禁备注最多 255 个字符', false)
    }
    const peer = await this.peers.resolvePrivateChatPeer(sourceRef, signal)
    const data = await this.runtime.authenticatedAuthPost<Record<string, unknown>>(
      banned ? '/api/v1/user-ban/ban' : '/api/v1/user-ban/unban',
      { user_id: peer.userId, remark },
      undefined,
      signal,
      { bypassCache: true, trackWriteOutcome: true },
    )
    const record = optionalRecord(data, sourceRef, peer)
    if (record === undefined || record.status !== (banned ? 'banned' : 'unbanned')) {
      throw new ArkmePluginError('user-ban-contract-invalid', '封禁服务返回的数据不完整', true, 502)
    }
    return record
  }
}
