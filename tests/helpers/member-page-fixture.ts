import type { ArkmeConversationMemberItem, ArkmeConversationMemberFacts, ArkmeConversationMemberList } from '../../src/types.js'

export function memberFacts(member: ArkmeConversationMemberItem): ArkmeConversationMemberFacts {
  const { memberRef, role, status, isSelf, isOwner, joinedAtMillis, memberName } = member
  return { memberRef, role, status, isSelf, isOwner, joinedAtMillis, ...(memberName === undefined ? {} : { memberName }) }
}

/** UI fixtures supply business rows; the two requests still exercise the production paging pipeline. */
export function memberPageFixture(call: (operation: string, params?: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>) {
  const lists = new Map<string, ArkmeConversationMemberList>()
  return async (operation: string, ...args: [params?: Record<string, unknown>, signal?: AbortSignal]) => {
    const [params, signal] = args
    if (operation === 'source.members.cached') return null
    if (operation === 'source.members.page') {
      if (params?.cursor === undefined) {
        const result = await call('source.members', { sourceRef: params?.sourceRef, activeOnly: true }, signal) as ArkmeConversationMemberList
        lists.set(String(params?.sourceRef), result)
      }
      const result = lists.get(String(params?.sourceRef))!
      const offset = params?.cursor === undefined ? 0 : Number(String(params.cursor).split(':')[1])
      const items = result.items.slice(offset, offset + 50)
      const hasMore = offset + 50 < result.items.length
      return { kind: 'membership', selfRole: result.items.find(member => member.isSelf)?.role ?? 'member', source: result.source, items: items.map(memberFacts), joinEvents: offset === 0 ? result.joinEvents ?? [] : [],
        hasMore, ...(hasMore ? { nextCursor: `fixture:${offset + 50}` } : {}), removedMemberRefs: [] }
    }
    if (operation === 'source.members.presentation') {
      const list = lists.get(String(params?.sourceRef))!
      const refs = params?.memberRefs as string[]
      return { kind: 'presentation', source: list.source, items: list.items.filter(item => refs.includes(item.memberRef)),
        removedMemberRefs: refs.filter(ref => !list.items.some(item => item.memberRef === ref)), unavailableProfileMemberRefs: [] }
    }
    return await call(operation, ...args)
  }
}
