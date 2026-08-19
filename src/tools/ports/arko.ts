import type {
  ArkmeArkoAskResult,
  ArkmeArkoCancelResult,
  ArkmeArkoHistoryPage,
  ArkmeArkoProfile,
  ArkmeArkoRunStatus,
  ArkmeArkoSession,
} from '../../types.js'

export interface ArkmeArkoToolPort {
  arkoProfile(signal?: AbortSignal): Promise<ArkmeArkoProfile>
  arkoEnsureSession(signal?: AbortSignal): Promise<ArkmeArkoSession>
  arkoAsk(
    text: string,
    options: {
      sessionId?: number
      clientTurnUid?: string
      waitMillis?: number
      modelRouteKey?: string
      replyToRunUid?: string
      replyToAssistantMsgId?: number
      signal?: AbortSignal
    },
  ): Promise<ArkmeArkoAskResult>
  arkoRunStatus(sessionId: number, runUid: string, signal?: AbortSignal): Promise<ArkmeArkoRunStatus>
  arkoHistoryPage(limit?: number, offset?: number, signal?: AbortSignal): Promise<ArkmeArkoHistoryPage>
  arkoCancel(
    sessionId: number,
    assistantMsgId: number,
    runUid: string,
    signal?: AbortSignal,
  ): Promise<ArkmeArkoCancelResult>
}
