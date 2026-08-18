export type ArkmeOutgoingCallMediaType = 'audio' | 'video'

export type ArkmeOutgoingCallFailureCode =
  | 'call-ui-unavailable'
  | 'call-active'
  | 'call-source-invalid'
  | 'call-peer-unavailable'
  | 'call-permission-denied'
  | 'call-bootstrap-failed'
  | 'call-engine-failed'
  | 'call-cancelled'

export interface ArkmeOutgoingCallIntentClaim {
  intentId: string
  claimToken: string
  callRequestId: string
  sourceRef: string
  displayName: string
  mediaType: ArkmeOutgoingCallMediaType
  expiresAtMillis: number
}

export interface ArkmeOutgoingCallToolResult {
  status: 'calling'
  displayName: string
  mediaType: ArkmeOutgoingCallMediaType
}

export interface ArkmeOutgoingCallIntentResolutionInput {
  userId: number
  intentId: string
  claimToken: string
  outcome:
    | { status: 'calling' }
    | { status: 'failed'; code: ArkmeOutgoingCallFailureCode; message: string }
}

export interface ArkmeOutgoingCallPrepareResult {
  callRequestId: string
  displayName: string
  peerAvatarRef?: string
  bootstrap: {
    sdkAppId: number
    userId: string
    userSig: string
    nickName: string
    avatar: ''
    outgoingOnly: true
  }
  call: {
    roomId: string
    mediaType: ArkmeOutgoingCallMediaType
    calleeAccounts: string[]
    calleeName: string
    calleeAvatar: ''
    callerName: string
    callerAvatar: ''
    timeoutSec: 30
    userData: string
    offlinePushInfo: {
      title: string
      description: string
      extension: string
      ignoreIOSBadge: true
      iOSPushType: 1
    }
  }
}

export class ArkmeOutgoingCallError extends Error {
  readonly retryable = false

  constructor(
    readonly code: ArkmeOutgoingCallFailureCode,
    message: string,
  ) {
    super(message)
    this.name = 'ArkmeOutgoingCallError'
  }
}
