import type {
  ArkmeGroupMemberAddResult, ArkmeGroupMemberCandidateList, ArkmeGroupProjectionResult, ArkmeSourceItem,
} from '../../types.js'

export interface ArkmeGroupToolPort {
  createGroup(
    title: string,
    clientMutationId: string,
    options?: { signal?: AbortSignal },
  ): Promise<ArkmeSourceItem>
  renameGroup(
    sourceRef: string,
    title: string,
    signal?: AbortSignal,
  ): Promise<ArkmeGroupProjectionResult>
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
