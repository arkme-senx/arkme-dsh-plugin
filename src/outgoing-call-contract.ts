export type JotmoOutgoingCallMediaType = 'audio' | 'video'

export type JotmoOutgoingCallFailureCode =
  | 'call-ui-unavailable'
  | 'call-active'
  | 'call-source-invalid'
  | 'call-peer-unavailable'
  | 'call-permission-denied'
  | 'call-bootstrap-failed'
  | 'call-engine-failed'
  | 'call-cancelled'

export interface JotmoOutgoingCallIntentClaim {
  intentId: string
  claimToken: string
  callRequestId: string
  sourceRef: string
  displayName: string
  mediaType: JotmoOutgoingCallMediaType
  expiresAtMillis: number
}

export interface JotmoOutgoingCallToolResult {
  status: 'calling'
  displayName: string
  mediaType: JotmoOutgoingCallMediaType
}

export interface JotmoOutgoingCallIntentResolutionInput {
  userId: number
  intentId: string
  claimToken: string
  outcome:
    | { status: 'calling' }
    | { status: 'failed'; code: JotmoOutgoingCallFailureCode; message: string }
}

export interface JotmoOutgoingCallPrepareResult {
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
    mediaType: JotmoOutgoingCallMediaType
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

export class JotmoOutgoingCallError extends Error {
  readonly retryable = false

  constructor(
    readonly code: JotmoOutgoingCallFailureCode,
    message: string,
  ) {
    super(message)
    this.name = 'JotmoOutgoingCallError'
  }
}
