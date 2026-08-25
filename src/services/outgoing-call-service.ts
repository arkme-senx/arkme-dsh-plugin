import { ArkmeOutgoingCallBroker } from '../outgoing-call-broker.js'
import type {
  ArkmeOutgoingCallIntentClaim,
  ArkmeOutgoingCallIntentResolutionInput,
  ArkmeOutgoingCallMediaType,
  ArkmeOutgoingCallPrepareResult,
  ArkmeOutgoingCallToolResult,
} from '../outgoing-call-contract.js'
import { ProfileService } from './profile-service.js'
import { SourceService } from './source-service.js'
import { ArkmePluginError, ServiceRuntime, objectValue, stringValue } from './service.js'

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function listValue(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }

function callDiag(label: string, detail: Record<string, unknown>): void {
  try { console.info(`dsh-arkme: call_diag service ${label}`, detail) } catch { console.info(`dsh-arkme: call_diag service ${label}`) }
}

export class OutgoingCallService {
  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly source: SourceService,
    private readonly profile: ProfileService,
    private readonly broker = new ArkmeOutgoingCallBroker(),
  ) {}

  clearUser(userId: number, reason: string): void {
    callDiag('clear_user', { userId, reason })
    this.broker.clearUser(userId, reason)
  }

  dispose(): void {
    callDiag('dispose', {})
    this.broker.dispose()
  }

  async requestOutgoingCall(
    sourceRef: string,
    mediaType: ArkmeOutgoingCallMediaType,
    signal?: AbortSignal,
  ): Promise<ArkmeOutgoingCallToolResult> {
    const session = await this.runtime.requireSession()
    const source = await this.source.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'private_chat') {
      throw new ArkmePluginError('call-source-invalid', '仅支持向私聊用户发起通话', false)
    }
    callDiag('request_outgoing_call', {
      userId: session.userId,
      sourceRef,
      displayName: source.displayName,
      mediaType,
    })
    return await this.broker.request({
      userId: session.userId,
      sourceRef,
      displayName: source.displayName,
      mediaType,
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async claimOutgoingCallIntent(): Promise<ArkmeOutgoingCallIntentClaim | null> {
    const session = await this.runtime.requireSession()
    const claim = this.broker.claim(session.userId)
    if (claim !== null) callDiag('claim_intent', {
      userId: session.userId,
      intentId: claim.intentId,
      callRequestId: claim.callRequestId,
      mediaType: claim.mediaType,
      displayName: claim.displayName,
    })
    return claim
  }

  async resolveOutgoingCallIntent(
    input: Omit<ArkmeOutgoingCallIntentResolutionInput, 'userId'>,
  ): Promise<void> {
    const session = await this.runtime.requireSession()
    callDiag('resolve_intent', {
      userId: session.userId,
      intentId: input.intentId,
      status: input.outcome.status,
      code: input.outcome.status === 'failed' ? input.outcome.code : undefined,
    })
    this.broker.resolveIntent({ ...input, userId: session.userId })
  }

  async prepareOutgoingCall(input: {
    sourceRef: string
    mediaType: ArkmeOutgoingCallMediaType
    callRequestId: string
    signal?: AbortSignal
  }): Promise<ArkmeOutgoingCallPrepareResult> {
    const session = await this.runtime.requireSession()
    const source = await this.source.openSourceRef(input.sourceRef, session.userId)
    if (source.kind !== 'private_chat') {
      throw new ArkmePluginError('call-source-invalid', '仅支持向私聊用户发起通话', false)
    }
    callDiag('prepare_start', {
      userId: session.userId,
      sourceRef: input.sourceRef,
      mediaType: input.mediaType,
      callRequestId: input.callRequestId,
    })
    this.broker.acquireLease(session.userId, input.callRequestId)
    try {
      const detail = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/chats/detail',
        { chat_session_uid: source.ownerRef },
        session,
        input.signal,
      )
      const chatSession = objectValue(detail.session)
      const sessionUid = stringValue(chatSession.chat_session_uid).trim()
      const sessionKind = numberValue(chatSession.session_kind)
      if (sessionUid !== source.ownerRef || (sessionKind !== 1 && sessionKind !== 3)) {
        throw new ArkmePluginError('call-source-invalid', '当前私聊会话不可用，请刷新后重试', false, 409)
      }
      const counterpart = objectValue(detail.private_counterpart)
      const supplement = objectValue(detail.private_supplement)
      const counterpartUserId = numberValue(counterpart.user_id)
      if (!Number.isSafeInteger(counterpartUserId) || counterpartUserId <= 0 || counterpartUserId === session.userId) {
        throw new ArkmePluginError('call-peer-unavailable', '当前私聊用户不可用，请刷新后重试', false, 409)
      }
      callDiag('prepare_peer_resolved', {
        userId: session.userId,
        callRequestId: input.callRequestId,
        counterpartUserId,
        mediaType: input.mediaType,
      })
      const detailDisplayName = stringValue(
        supplement.remark ?? supplement.counterpart_name_snapshot ?? counterpart.display_name_snapshot
        ?? supplement.pending_name ?? counterpart.visible_phone,
      ).trim()
      const callerProfile = (await this.profile.refreshProfile()).profile
      if (callerProfile === null) {
        throw new ArkmePluginError('profile-contract-invalid', 'Arkme 个人资料响应不完整', false, 502)
      }
      const publicProfiles = await this.profile.publicProfilesByUserIds([counterpartUserId], session, input.signal)
      const peerProfile = publicProfiles.get(counterpartUserId)
      const displayName = detailDisplayName || peerProfile?.displayName || source.displayName || 'Arkme 用户'
      const credentials = await this.runtime.authenticatedWebrtcPost<Record<string, unknown>>(
        '/api/v1/trtc/credentials',
        {},
        session,
        input.signal,
      )
      const sdkAppId = numberValue(credentials.sdk_app_id)
      const trtcUserId = stringValue(credentials.user_id).trim()
      const userSig = stringValue(credentials.user_sig).trim()
      if (!Number.isSafeInteger(sdkAppId) || sdkAppId <= 0 || trtcUserId === '' || userSig === '') {
        throw new ArkmePluginError('call-credentials-invalid', '桌面通话初始化失败', true, 502)
      }
      const callerName = callerProfile.displayName.trim() || 'Arkme 用户'
      const callerAvatarRef = callerProfile.avatarRef.trim()
      const room = await this.runtime.authenticatedWebrtcPost<Record<string, unknown>>(
        '/api/v1/trtc/create-room',
        {
          shared_topic_id: 0,
          chat_session_uid: source.ownerRef,
          callee_user_ids: [counterpartUserId],
          call_media_type: input.mediaType === 'video' ? 1 : 0,
          caller_name: callerName,
          ...(callerAvatarRef === '' ? {} : {
            sender_avatar_url: callerAvatarRef,
            caller_avatar_url: callerAvatarRef,
          }),
        },
        session,
        input.signal,
      )
      const roomId = stringValue(room.room_id).trim()
      const calleeAccounts = [...new Set(listValue(room.callee_accounts)
        .map(value => stringValue(value).trim())
        .filter(value => value !== ''))]
      if (roomId === '') {
        throw new ArkmePluginError('call-room-invalid', '呼叫房间创建失败，请重试', true, 502)
      }
      if (calleeAccounts.length === 0) {
        throw new ArkmePluginError('call-peer-unavailable', '对方未开通通话，请对方先登录后再试', false, 409)
      }
      callDiag('prepare_room_created', {
        userId: session.userId,
        callRequestId: input.callRequestId,
        roomId,
        mediaType: input.mediaType,
        calleeCount: calleeAccounts.length,
      })
      const sharedTopicId = numberValue(room.shared_topic_id)
      const userData = JSON.stringify({
        sharedTopicId: sharedTopicId > 0 ? sharedTopicId : 0,
        sourceTag: 'arkme-private-chat-header',
        callerName,
        callerAvatar: '',
      })
      const description = input.mediaType === 'video' ? '邀请你进行视频通话' : '邀请你进行语音通话'
      return {
        callRequestId: input.callRequestId,
        displayName,
        ...(peerProfile === undefined ? {} : {
          peerAvatarRef: await this.profile.sealProfileImageRef(session.userId, counterpartUserId),
        }),
        bootstrap: {
          sdkAppId,
          userId: trtcUserId,
          userSig,
          nickName: callerName,
          avatar: '',
          outgoingOnly: true,
        },
        call: {
          roomId,
          mediaType: input.mediaType,
          calleeAccounts,
          calleeName: displayName,
          calleeAvatar: '',
          callerName,
          callerAvatar: '',
          timeoutSec: 30,
          userData,
          offlinePushInfo: {
            title: callerName,
            description,
            extension: userData,
            ignoreIOSBadge: true,
            iOSPushType: 1,
          },
        },
      }
    } catch (error) {
      callDiag('prepare_failed_release', {
        userId: session.userId,
        callRequestId: input.callRequestId,
        error: error instanceof Error ? error.message : String(error),
      })
      this.broker.releaseLease(session.userId, input.callRequestId)
      throw error
    }
  }

  async heartbeatOutgoingCall(callRequestId: string): Promise<{ expiresAtMillis: number }> {
    const session = await this.runtime.requireSession()
    const expiresAtMillis = this.broker.heartbeatLease(session.userId, callRequestId)
    callDiag('heartbeat', { userId: session.userId, callRequestId, expiresAtMillis })
    return { expiresAtMillis }
  }

  async releaseOutgoingCall(callRequestId: string): Promise<void> {
    const session = await this.runtime.requireSession()
    callDiag('release', { userId: session.userId, callRequestId })
    this.broker.releaseLease(session.userId, callRequestId)
  }
}
