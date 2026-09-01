import type { OpenClawProvisionResult } from '../../services/bot-service.js'

export interface ArkmeOpenClawToolPort {
  connectOpenClawBot(botRef: string, options?: { signal?: AbortSignal }): Promise<OpenClawProvisionResult>
}
