import type { ArkmeGroupMemberAddResult, ArkmeGroupMemberCandidateList } from '../../types.js'

export interface ArkmeGroupToolPort {
  listGroupMemberCandidates(
    sourceRef: string,
    options?: { query?: string; limit?: number; groupSourceRefs?: readonly string[]; signal?: AbortSignal },
  ): Promise<ArkmeGroupMemberCandidateList>
  addGroupMembers(
    sourceRef: string,
    candidateRefs: readonly string[],
    signal?: AbortSignal,
  ): Promise<ArkmeGroupMemberAddResult>
}
