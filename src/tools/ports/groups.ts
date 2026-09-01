import type {
  ArkmeGroupJoinRestrictionMutationResult, ArkmeGroupJoinRestrictionPage,
  ArkmeGroupMemberAddResult, ArkmeGroupMemberCandidateList, ArkmeGroupMemberRemoveResult,
  ArkmeGroupProjectionResult, ArkmeSourceItem,
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
  removeGroupMember(
    sourceRef: string,
    memberRef: string,
    options?: { preventRejoin?: boolean; signal?: AbortSignal },
  ): Promise<ArkmeGroupMemberRemoveResult>
  listGroupJoinRestrictions(
    sourceRef: string,
    options?: { cursor?: string; limit?: number; signal?: AbortSignal },
  ): Promise<ArkmeGroupJoinRestrictionPage>
  setGroupJoinRestriction(
    sourceRef: string,
    memberRef: string,
    restricted: boolean,
    options?: { signal?: AbortSignal },
  ): Promise<ArkmeGroupJoinRestrictionMutationResult>
}
