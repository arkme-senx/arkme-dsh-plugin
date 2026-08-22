import type { ArkmeContactAddResult, ArkmeContactSearchResult } from '../../types.js'

export interface ArkmeContactToolPort {
  searchContact(identifier: string, options?: { signal?: AbortSignal }): Promise<ArkmeContactSearchResult>
  addContact(
    contactRef: string,
    options?: { remark?: string; requestUid?: string; signal?: AbortSignal },
  ): Promise<ArkmeContactAddResult>
}
