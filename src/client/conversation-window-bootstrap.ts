import { arkmeAvatarImages } from './avatar-image-runtime.js'
import type { ArkmeAvatarImageSnapshot } from './avatar-image-store.js'
import type { ArkmeSourceItem, ArkmeAuthSnapshot, ArkmeClientConfig, ArkmeInterwovenMention, ArkmeInterwovenState } from '../types.js'
import type { ArkmeConversationMemoryCache, ArkmeConversationTimelineSnapshot, ArkmeConversationViewportSnapshot } from './conversation-memory-cache.js'
import { arkmeAuthStore } from './auth-store.js'

export interface ConversationWindowContentSnapshot {
  timeline: ArkmeConversationTimelineSnapshot
  avatars?: ArkmeAvatarImageSnapshot[]
  selfAvatarRef?: string
  viewport?: ArkmeConversationViewportSnapshot
  moments?: ArkmeInterwovenMention[]
  interwovenState?: ArkmeInterwovenState
}
export interface ConversationWindowBootstrap {
  version: 1
  accountKey: string
  sourceKey: string
  auth: { status: 'authenticated'; environment: ArkmeAuthSnapshot['environment']; userId: number }
  config?: ArkmeClientConfig
  content?: ConversationWindowContentSnapshot
}
let provider: { accountKey: string; read(sourceKey: string): ConversationWindowContentSnapshot | undefined } | undefined

/** The surface remains the cache owner; opening a window only copies its current projection. */
export function registerConversationWindowContent(accountKey: string, read: NonNullable<typeof provider>['read']): () => void {
  const entry = { accountKey, read }
  provider = entry
  return () => { if (provider === entry) provider = undefined }
}
export function readConversationWindowBootstrap(accountKey: string, sourceKey: string, source?: ArkmeSourceItem): ConversationWindowBootstrap | undefined {
  const { auth, config } = arkmeAuthStore.getSnapshot()
  if (auth?.status !== 'authenticated' || auth.userId === undefined || `${auth.environment}:${auth.userId}` !== accountKey) return
  let content: ConversationWindowContentSnapshot | undefined
  try { content = provider?.accountKey === accountKey ? provider.read(sourceKey) : undefined } catch { /* Optional warm cache; keep the local-session fallback. */ }
  if (content) {
    const refs = [source?.avatarRef, ...(source?.avatarRefs ?? []), ...(source?.groupAvatar?.slots.map(slot => slot.avatarRef) ?? []),
      content.selfAvatarRef, ...content.timeline.items.flatMap(item => [item.avatarRef, item.selfRole?.avatarRef])]
      .filter((ref): ref is string => typeof ref === 'string' && ref.trim() !== '').map(ref => ref.trim())
    const avatars = arkmeAvatarImages.snapshot?.(accountKey, refs) ?? []
    if (avatars.length) content = {...content, avatars}
  }
  const value: ConversationWindowBootstrap = {
    version: 1, accountKey, sourceKey,
    // Do not copy QR attempts or any future credential fields from the auth object.
    auth: { status: 'authenticated', environment: auth.environment, userId: auth.userId },
    ...(config?.environment === auth.environment ? { config } : {}),
    ...(content ? { content } : {}),
  }
  // Match the desktop broker limit. Oversized projections fall back to the existing local Host cache.
  try {
    const encoded = JSON.stringify(value)
    if (new TextEncoder().encode(encoded).byteLength <= 2_000_000) return JSON.parse(encoded) as ConversationWindowBootstrap
    // Prefer preserving all messages over transferring large optional image bytes.
    if (value.content?.avatars) {
      const {avatars: _avatars, ...withoutAvatars} = value.content
      const messagesOnly = {...value, content: withoutAvatars}
      const smaller = JSON.stringify(messagesOnly)
      if (new TextEncoder().encode(smaller).byteLength <= 2_000_000) return JSON.parse(smaller) as ConversationWindowBootstrap
    }
    const { content: _content, ...sessionOnly } = value
    return JSON.parse(JSON.stringify(sessionOnly)) as ConversationWindowBootstrap
  } catch { return undefined }
}
export function readConversationWindowContent(cache: ArkmeConversationMemoryCache, sourceKey: string): ConversationWindowContentSnapshot | undefined {
  const timeline = cache.getTimeline(sourceKey)
  if (!timeline) return
  const viewport = cache.getViewport(sourceKey)
  const moments = cache.getInterwovenMoments(sourceKey)
  const interwovenState = cache.getInterwovenState(sourceKey)
  return { timeline, ...(viewport ? { viewport } : {}), ...(moments ? { moments } : {}),
    ...(interwovenState ? { interwovenState } : {}) }
}
export function restoreConversationWindowContent(cache: ArkmeConversationMemoryCache, sourceKey: string, content: ConversationWindowContentSnapshot): void {
  // Transferring a projection does not make it a new authoritative read.
  cache.storeTimeline(sourceKey, { ...content.timeline, fetchedAtMillis: 0 })
  if (content.viewport) cache.storeViewport(sourceKey, content.viewport)
  if (content.moments) cache.storeInterwovenMoments(sourceKey, content.moments)
  if (content.interwovenState) cache.storeInterwovenState(sourceKey, content.interwovenState)
}
export function validConversationWindowBootstrap(value: ConversationWindowBootstrap | undefined, accountKey: string, sourceKey: string): value is ConversationWindowBootstrap {
  return value?.version === 1 && value.accountKey === accountKey && value.sourceKey === sourceKey
    && value.auth?.status === 'authenticated' && Number.isSafeInteger(value.auth.userId) && value.auth.userId > 0
    && `${value.auth.environment}:${value.auth.userId}` === accountKey
    && (value.config === undefined || value.config.environment === value.auth.environment)
}
