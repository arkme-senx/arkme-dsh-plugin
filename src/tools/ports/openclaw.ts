import type { OpenClawProvisionResult } from '../../openclaw/index.js'

export interface ArkmeOpenClawToolPort {
  connectOpenClawBot(botRef: string, options?: { signal?: AbortSignal }): Promise<OpenClawProvisionResult>
}
