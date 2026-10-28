import type {
  ArkmeGroupJoinRestrictionMutationResult, ArkmeGroupJoinRestrictionPage,
  ArkmeGroupMemberAddResult, ArkmeGroupMemberCandidateList, ArkmeGroupMemberRemoveResult,
  ArkmeGroupProjectionResult, ArkmeSourceItem, ArkmeGroupSelfNickname,
} from '../../types.js'

export interface ArkmeGroupToolPort {
  listCommonGroups(sourceRef: string, options?: { cursor?: string; signal?: AbortSignal }): Promise<import('../../common-groups.js').ArkmeCommonGroupPage>
  syncCommonGroups(sourceRef: string, signal?: AbortSignal): Promise<import('../../common-groups.js').ArkmeCommonGroupPage>
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
  groupSelfNickname(sourceRef: string, signal?: AbortSignal): Promise<ArkmeGroupSelfNickname>
  setGroupSelfNickname(sourceRef: string, nickname: string, signal?: AbortSignal): Promise<ArkmeGroupSelfNickname>
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
