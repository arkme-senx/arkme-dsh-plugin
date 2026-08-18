import type {
  ArkmeOutgoingCallMediaType,
  ArkmeOutgoingCallToolResult,
} from '../../outgoing-call-contract.js'

export interface ArkmeOutgoingCallToolPort {
  requestOutgoingCall(
    sourceRef: string,
    mediaType: ArkmeOutgoingCallMediaType,
    signal?: AbortSignal,
  ): Promise<ArkmeOutgoingCallToolResult>
}
