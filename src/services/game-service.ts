import { ServiceRuntime, ArkmePluginError, ArkmeUpstreamResponseError, objectValue, stringValue } from './service.js'
import type { DeviceRegistrationService } from './device-registration-service.js'
import type { ProfileService } from './profile-service.js'

export class GameService {
  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly deviceRegistration: DeviceRegistrationService,
    private readonly profile: ProfileService,
  ) {}

  async execute(action: string, body: Record<string, unknown>, expectedAccount: string) {
    const session = await this.runtime.requireSession()
    const account = `${session.userId}:${this.runtime.config.webrtcBaseUrl}`
    if (action === 'bootstrap') return { path: `${this.runtime.config.routePath}/game/index.html`, account }
    if (account !== expectedAccount) throw new ArkmePluginError('game-account-changed', '游戏账号已变化，请关闭窗口后重试', false)
    if (action === 'prepare') {
      this.deviceRegistration.start(session)
      const credentials = await this.runtime.authenticatedWebrtcPost<Record<string, unknown>>('/api/v1/trtc/credentials', {}, session)
      return {credentials: {...credentials, expires_at: Date.now() + 3600000}}
    }
    if (action === 'ready') {
      const expected = await this.runtime.authenticatedWebrtcPost<Record<string, unknown>>('/api/v1/trtc/credentials', {}, session)
      if (body.registration_id !== expected.user_id) throw new ArkmePluginError('game-identity-mismatch', '设备 IM 身份不匹配，请关闭窗口后重新进入', false)
      try { await this.deviceRegistration.waitUntilReady(session.userId, String(body.registration_id ?? '')) }
      catch { throw new ArkmePluginError('game-device-not-ready', '设备 IM 登记尚未完成，请重试', true) }
      return {ok: true}
    }
    if (action === 'profiles') {
      // Resolve only members of a room visible to this authenticated device.
      const reply = await this.runtime.authenticatedWebrtcPost<import('../client/game/contracts.js').Reply>('/api/v1/game/room/get', body, session)
      const profiles = await this.profile.publicProfileSummariesByUserIds(reply.room.members.map(m => m.user_id), session)
      return {profiles: reply.room.members.map(m => {
        const p = profiles.get(m.user_id)
        return {membershipId: m.membership_id, registrationId: m.registration_id, userId: m.user_id,
          name: p?.nickname || p?.displayName || String(m.user_id), avatarUrl: p?.avatarUrl}
      })}
    }
    if (!['create','activate','get','join','credentials','invite/rotate','heartbeat','leave','close'].includes(action)) throw new Error('未知游戏操作')
    try { return await this.runtime.authenticatedWebrtcPost(`/api/v1/game/room/${action}`, body, session) }
    catch (error) {
      const reason = error instanceof ArkmeUpstreamResponseError ? stringValue(objectValue(error.responseData).reason) : ''
      const messages: Record<string,string> = {game_disabled:'游戏灰度尚未开启',game_host_room_busy:'上一个房间仍在使用或清理中，请先退出旧房间，稍后重试',game_room_full:'房间人数已满',game_invite_invalid:'房间钥匙无效或已过期',game_room_closed:'房间已结束',game_device_binding_required:'设备 IM 登记已失效，请重新进入',game_room_unavailable:'房间或成员身份已失效，请退出后重新进入'}
      throw new ArkmePluginError('game-request-failed', messages[reason] ?? '游戏连接失败，请稍后重试', true)
    }
  }
}
