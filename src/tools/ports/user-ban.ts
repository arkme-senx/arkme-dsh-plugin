import type { ArkmeUserBanOwnerRecord, ArkmeUserBanOwnerSnapshot } from '../../types.js'

export interface ArkmeUserBanToolPort {
  userBanStatus(sourceRef: string, signal?: AbortSignal): Promise<ArkmeUserBanOwnerSnapshot>
  banPrivateChatUser(sourceRef: string, remark?: string, signal?: AbortSignal): Promise<ArkmeUserBanOwnerRecord>
  unbanPrivateChatUser(sourceRef: string, remark?: string, signal?: AbortSignal): Promise<ArkmeUserBanOwnerRecord>
}
