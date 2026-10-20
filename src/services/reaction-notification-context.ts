import type { ReactionNotificationContext } from '../reaction-contract.js'
import type { ChatService } from './chat-service.js'
import type { ProfileService } from './profile-service.js'
import type { SourceService } from './source-service.js'
import type { ServiceRuntime } from './service.js'

/** Resolve notification identities in batches, independently of the Browser's loaded directory page. */
export async function readReactionNotificationContext(
  services: {
    runtime: Pick<ServiceRuntime, 'requireSession'>
    source: Pick<SourceService, 'chatSourcesBySessionUids'>
    profile: Pick<ProfileService, 'publicProfileSummariesByUserIds'>
    chat: Pick<ChatService, 'reactionActorLabels'>
  },
  items: readonly { sessionUID: string; actorUserId: number }[],
  signal?: AbortSignal,
): Promise<ReactionNotificationContext[]> {
  const session = await services.runtime.requireSession()
  const optional = async <T>(read: () => Promise<T>, fallback: NoInfer<T>): Promise<T> => {
    try { return await read() }
    catch { signal?.throwIfAborted(); return fallback }
  }
  const [sources, profiles] = await Promise.all([
    optional(() => services.source.chatSourcesBySessionUids([...new Set(items.map(item => item.sessionUID))], signal), new Map()),
    optional(() => services.profile.publicProfileSummariesByUserIds([...new Set(items.map(item => item.actorUserId))], session, signal, 5_000), new Map()),
  ])
  const usersBySource = new Map<string, Set<number>>()
  for (const item of items) {
    const source = sources.get(item.sessionUID)
    if (!source) continue
    const users = usersBySource.get(source.sourceRef) ?? new Set<number>()
    users.add(item.actorUserId)
    usersBySource.set(source.sourceRef, users)
  }
  const labelsBySource = new Map(await Promise.all([...usersBySource].map(async ([sourceRef, users]) => [sourceRef,
    await optional(() => services.chat.reactionActorLabels(sourceRef, [...users], signal), new Map()),
  ] as const)))
  return items.map(item => {
    const source = sources.get(item.sessionUID)
    const label = source && labelsBySource.get(source.sourceRef)?.get(item.actorUserId)
    const privateName = source?.kind === 'private_chat' && source.peerUserId === item.actorUserId ? source.displayName : ''
    const actorName = label?.remark?.trim() || privateName?.trim() || label?.groupNickname?.trim() || profiles.get(item.actorUserId)?.displayName?.trim()
    return { ...(actorName ? { actorName } : {}), ...(source ? { source } : {}) }
  })
}
