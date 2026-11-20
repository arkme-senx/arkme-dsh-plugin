import type { ArkmeAgentArrangementCreateInput, ArkmeAgentArrangementCreateResult } from '../../types.js'

export interface ArkmeArrangementToolPort {
  createAgentArrangement(input: ArkmeAgentArrangementCreateInput, signal?: AbortSignal): Promise<ArkmeAgentArrangementCreateResult>
}
