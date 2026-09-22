import type { TeamConversation, TeamPage, TeamSide } from '../team-app-contract.js'

// A badge must not disappear just because an older unread conversation is on
// another page. Stop at the first unread result, and cancel obsolete refreshes.
export async function hasUnreadTeamMessages(read: (side: TeamSide, cursor?: string) => Promise<TeamPage<TeamConversation>>, signal: AbortSignal): Promise<boolean> {
  for (const side of ['team', 'external'] as const) {
    let cursor: string | undefined
    do {
      signal.throwIfAborted()
      const page = await read(side, cursor)
      signal.throwIfAborted()
      if (page.items.some(item => item.unread > 0)) return true
      if (!page.hasMore || !page.nextCursor) break
      cursor = page.nextCursor
    } while (cursor)
  }
  return false
}
