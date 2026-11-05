import { ArkmeCloseButton } from './ArkmeCloseButton.js'
import { TeamWorldActivity } from './TeamWorldActivity.js'
import { WorldTeamBadge } from './WorldTeamBadge.js'
import { WorldPublishIdentityDialog } from './WorldPublishIdentityDialog.js'
import { ArkmeActionMenu } from './ArkmeDshMenu.js'
import { DotsThree } from '@phosphor-icons/react/dist/icons/DotsThree'
import { ArkmeSelfRoleMenu } from './ArkmeSelfRoleMenu.js'
import type { TeamWorldContext } from '../team-world-contract.js'
import { IdentityCopyLinkButton } from './IdentityCopyLinkButton.js'
import { worldPublishSourceLabel } from '../world-publish-source.js'
import { WorldPublishGuide } from './WorldPublishGuide.js'
import { PublicSocialDirectory, PublicWorldGroups } from './PublicSocialDirectory.js'
import { ArkmeGroupCreateDialog } from './ArkmeQuickAdd.js'
import type { PublicSocialTab } from '../public-social-contract.js'
import { loadWorldCommentPage, type WorldCommentContinuation } from './world-comment-page.js'
import { cachedWorldImageDataUrl, loadWorldImageDataUrl, invalidateWorldImages, subscribeWorldImageInvalidation } from './world-image-cache.js'
export { cachedWorldImageDataUrl, loadWorldImageDataUrl, invalidateWorldImages, subscribeWorldImageInvalidation } from './world-image-cache.js'
import { TeamPublicCardDialog } from './TeamPublicCardDialog.js'
import { tr, useArkmeLocale, arkmeIntlLocale } from './locale.js'
import { createContext, useContext, memo, useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type RefObject, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ArrowClockwise } from '@phosphor-icons/react/dist/icons/ArrowClockwise'
import { ArrowLeft } from '@phosphor-icons/react/dist/icons/ArrowLeft'
import { ChatCircleDots } from '@phosphor-icons/react/dist/icons/ChatCircleDots'
import { Microphone } from '@phosphor-icons/react/dist/icons/Microphone'
import { Plus } from '@phosphor-icons/react/dist/icons/Plus'
import { SpeakerHigh } from '@phosphor-icons/react/dist/icons/SpeakerHigh'
import { SpinnerGap } from '@phosphor-icons/react/dist/icons/SpinnerGap'
import type {
  ArkmeImagePayload,
  ArkmeOpenPrivateChatResult,
  ArkmeUploadedAsset,
  ArkmeWorldPublishResult,
  ArkmeWorldFeedItem,
  ArkmeWorldFeedPage,
  ArkmeWorldNotificationTarget,
  ArkmeWorldAuthorLabel,
  ArkmeWorldInteractionCreateResult,
  ArkmeWorldInteractionItem,
  ArkmeWorldRepliesPage,
  ArkmeWorldVoiceprintAvailability,
  ArkmeWorldVoiceprintInviteResult,
  ArkmeWorldVoiceprintPlaybackChunk,
  ArkmeWorldVoiceprintSocialContext,
  ArkmeTeam,
} from '../types.js'
import type { TeamWorldReceipt, TeamWorldAsset, TeamWorldRequest } from '../team-world-contract.js'
import { TeamWorldPublisherPicker, useTeamWorldPublisher } from './TeamWorldPublisher.js'
import { ArkmePublishComposer } from './ArkmePublishComposer.js'
import { WorldPublishAttachments, worldPublishAttachmentBlocked, type WorldPublishAttachment } from './WorldPublishAttachments.js'
import type { WorldPublishOrigin, WorldPublishSourceDraft } from '../world-publish-source.js'
import type { ArkmeExtensionCatalogItem, ArkmeExtensionCatalogPage } from '../extensions/types.js'
import { ARKME_WORLD_PUBLISH_MAX_IMAGE_BYTES, ARKME_WORLD_PUBLISH_MAX_IMAGES } from '../types.js'
import { createArkmeSdk } from '../sdk/index.js'
import { callArkme, ArkmeClientError } from './api.js'
import { withArkmeReadDeadline } from './read-deadline.js'
import { requirePhoneForSocialAction, isSocialBindingRequired } from './social-action-guard.js'
import { arkmeAuthStore } from './auth-store.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { ArkmeTeamAvatar } from './ArkmeTeamAvatar.js'
import { ArkmeExtensionAvatar } from './ArkmeExtensionAvatar.js'
import { ARKME_LINK_FALLBACK_LABEL, ArkmeTextLink, type ArkmeLinkRenderer } from './ArkmeLinkText.js'
import { ArkmeWorldEmptyNotice } from './ArkmeWorldEmptyNotice.js'
import { ArkmeWorldReactions } from './ArkmeWorldReactions.js'
import { ArkmeWorldShareActions } from './ArkmeWorldShareActions.js'
import { ArkmeWorldRecordDetail } from './ArkmeWorldRecordDetail.js'
import { ArkmeMembershipBadge } from './ArkmeMembershipBadge.js'
import { ArkmeMemberProfileCard, type ArkmeMemberProfileIdentity } from './ArkmeChatMemberActions.js'
import { arkmeEmojiPlainText } from './arkme-emoji.js'
import { ArkmeRichText } from './ArkmeRichText.js'
import { arkmeTheme } from './arkme-theme.js'
import { arkmeUi, type ArkmeWorldViewTarget } from './ui-controller.js'
import { resolveWorldVoiceprintExpectationCopy } from './world-voiceprint-expectation-copy.js'
import { downloadWorldVoiceprintAudio, playPreparedWorldVoiceprintAudio, playWorldVoiceprintChunkQueue } from './world-voiceprint-playback.js'

type WorldScope = 'all' | 'mine'

export function worldScopeScrollTransition(
  positions: Readonly<Record<WorldScope, number>>,
  currentScope: WorldScope,
  nextScope: WorldScope,
  currentScrollTop: number,
): { positions: Record<WorldScope, number>; restoreTop: number } {
  const normalizedScrollTop = Number.isFinite(currentScrollTop) ? Math.max(0, currentScrollTop) : 0
  const nextPositions = { ...positions, [currentScope]: normalizedScrollTop }
  const savedNextScrollTop = nextPositions[nextScope]
  return {
    positions: nextPositions,
    restoreTop: Number.isFinite(savedNextScrollTop) ? Math.max(0, savedNextScrollTop) : 0,
  }
}

const worldSdk = createArkmeSdk()
const WORLD_FEED_IMAGE_LIMIT = 9

export type ArkmeWorldViewState = {
  status: 'loading' | 'error' | 'empty' | 'success'
  items: ArkmeWorldFeedItem[]
  message?: string
  refreshing?: boolean
  loadingMore?: boolean
  hasMore?: boolean
  nextOffset?: number
  nextCursor?: string
}

export function updateWorldViewItem(
  view: ArkmeWorldViewState,
  recordRef: string,
  update: (item: ArkmeWorldFeedItem) => ArkmeWorldFeedItem,
): ArkmeWorldViewState {
  const index = view.items.findIndex(item => item.recordRef === recordRef)
  if (index < 0) return view
  const current = view.items[index]!
  const next = update(current)
  if (next === current) return view
  const items = [...view.items]
  items[index] = next
  return { ...view, items }
}

export function applyWorldAuthorLabels(
  view: ArkmeWorldViewState,
  labelsByRef: ReadonlyMap<string, string>,
  memberships?: ReadonlyMap<string, ArkmeWorldFeedItem['memberType']>,
): ArkmeWorldViewState {
  let changed = false
  const items = view.items.map(item => {
    if (item.teamAuthor) return item
    const ref = item.authorRef ?? item.recordRef
    const authorName = labelsByRef.get(ref) ?? item.authorName
    const memberType = memberships?.get(ref) ?? item.memberType
    if (authorName === item.authorName && memberType === item.memberType) return item
    changed = true
    return { ...item, authorName, ...(memberType === undefined ? {} : { memberType }) }
  })
  return changed ? { ...view, items } : view
}

export function applyWorldInteractionAuthorLabels(items: readonly ArkmeWorldInteractionItem[], labels: readonly ArkmeWorldAuthorLabel[]): ArkmeWorldInteractionItem[] {
  const byRef = new Map(labels.map(label => [label.authorRef, label]))
  return items.map(item => {
    if (item.teamAuthor) return item
    const label = byRef.get(item.authorRef ?? item.interactionRef)
    return label ? { ...item, authorName: label.authorName, ...(label.memberType === undefined ? {} : { memberType: label.memberType }) } : item
  })
}

async function hydrateWorldAuthorLabels(refs: readonly string[], signal: AbortSignal | undefined, apply: (labels: ArkmeWorldAuthorLabel[]) => void) {
  const unique = [...new Set(refs)]
  for (let offset = 0; offset < unique.length; offset += 20) {
    const labels = await callArkme<ArkmeWorldAuthorLabel[]>('world.author-labels', { authorRefs: unique.slice(offset, offset + 20) }, signal)
    if (signal?.aborted) return
    apply(labels)
  }
}

function WorldMembershipBadge({ memberType }: { memberType: ArkmeWorldFeedItem['memberType'] }) {
  if (memberType !== 'vip' && memberType !== 'svip') return null
  // Keep hover/focus available above the compact comment preview's click target.
  return <span style={{ display: 'inline-flex', position: 'relative', zIndex: 1, verticalAlign: 'middle' }}><ArkmeMembershipBadge memberType={memberType} /></span>
}

function appendWorldFeedItems(
  current: readonly ArkmeWorldFeedItem[],
  incoming: readonly ArkmeWorldFeedItem[],
): ArkmeWorldFeedItem[] {
  const byRef = new Map(current.map(item => [item.recordRef, item]))
  for (const item of incoming) byRef.set(item.recordRef, item)
  return [...byRef.values()]
}

const styles: Record<string, CSSProperties> = {
  root: { position: 'relative', flex: 1, width: '100%', height: '100%', minWidth: 0, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: arkmeTheme.base, color: arkmeTheme.text },
  header: { width: '100%', minHeight: 90, margin: 0, padding: '28px 20px 0', boxSizing: 'border-box', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24 },
  heading: { margin: 0, fontSize: 26, lineHeight: '34px', fontWeight: 650, letterSpacing: '-.035em' },
  subtitle: { margin: '2px 0 0', color: arkmeTheme.secondary, fontSize: 11 },
  headerActions: { display: 'flex', alignItems: 'center', gap: 8 },
  targetHeading: { display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 },
  targetTitle: { minWidth: 0, display: 'grid', gap: 1 },
  backButton: { width: 34, height: 34, padding: 0, display: 'grid', placeItems: 'center', border: 0, borderRadius: 10, background: 'transparent', color: arkmeTheme.secondary, cursor: 'pointer' },
  button: { minHeight: 36, padding: '0 13px', border: `1px solid ${arkmeTheme.border}`, borderRadius: 10, background: arkmeTheme.elevated, color: arkmeTheme.text, cursor: 'pointer', font: 'inherit', fontSize: 11 },
  iconButton: { width: 32, height: 32, padding: 0, display: 'grid', placeItems: 'center', border: 0, borderRadius: 9, background: 'transparent', color: arkmeTheme.secondary, cursor: 'pointer' },
  primaryButton: { minHeight: 34, padding: '0 12px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, borderColor: arkmeTheme.primaryAction, background: arkmeTheme.primaryAction, color: arkmeTheme.onPrimaryAction },
  worldToolbar: { width: '100%', minHeight: 38, margin: '0 0 4px', padding: '0 20px', boxSizing: 'border-box', display: 'flex', alignItems: 'stretch' },
  tabs: { minWidth: 0, height: 38, padding: 0, display: 'flex', alignItems: 'stretch', gap: 23 },
  tab: { position: 'relative', padding: 0, border: 0, borderBottom: '2px solid transparent', background: 'transparent', color: arkmeTheme.secondary, cursor: 'pointer', font: 'inherit', fontSize: 12 },
  tabActive: { borderBottom: `2px solid ${arkmeTheme.accent}`, color: arkmeTheme.text, fontWeight: 600 },
  worldLayout: { flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden', display: 'flex', position: 'relative', background: arkmeTheme.base },
  body: { flex: 1, minWidth: 0, minHeight: 0, overflowX: 'hidden', overflowY: 'auto', overscrollBehavior: 'contain', background: arkmeTheme.base },
  notice: { width: '100%', margin: '22px 0 0', padding: '13px 15px', boxSizing: 'border-box', border: 0, borderRadius: 12, background: arkmeTheme.subtle, color: arkmeTheme.secondary, fontSize: 12 },
  emptyNotice: { width: '100%', margin: '22px 0 0' },
  error: { borderColor: arkmeTheme.danger, background: arkmeTheme.dangerSoft, color: arkmeTheme.danger },
  errorRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 },
  feed: { width: '100%', maxWidth: '100%', minWidth: 0, margin: '10px 0 48px', boxSizing: 'border-box', display: 'grid', gap: 16 },
  card: { minWidth: 0, maxWidth: '100%', padding: '22px 20px 18px', boxSizing: 'border-box', border: `1px dashed ${arkmeTheme.border}`, borderRadius: 14, background: arkmeTheme.layer1 },
  cardHeader: { minWidth: 0, maxWidth: '100%', display: 'grid', gridTemplateColumns: '36px minmax(0,1fr) auto', alignItems: 'center', gap: 10 },
  avatar: { width: 36, height: 36, display: 'grid', placeItems: 'center', overflow: 'hidden', borderRadius: '50%', background: arkmeTheme.accentSoft, color: arkmeTheme.accent, fontSize: 13, fontWeight: 600 },
  avatarButton: { padding: 0, border: 0, borderRadius: '50%', background: 'transparent', cursor: 'pointer', lineHeight: 0 },
  avatarImage: { width: '100%', height: '100%', objectFit: 'cover' },
  authorMeta: { minWidth: 0, display: 'grid', alignItems: 'center' },
  authorRow: { minWidth: 0, display: 'flex', alignItems: 'center', gap: 12 },
  author: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, fontWeight: 600 },
  authorButton: { minWidth: 0, padding: 0, border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit', textAlign: 'left' },
  voiceprintButton: { width: 20, height: 20, padding: 0, display: 'grid', placeItems: 'center', border: 0, borderRadius: '50%', background: 'transparent', cursor: 'pointer', lineHeight: 0 },
  voiceprintPlayable: { color: arkmeTheme.tertiary },
  voiceprintActive: { background: arkmeTheme.hover, color: arkmeTheme.secondary },
  voiceprintInvite: { width: 18, height: 18, marginLeft: 2, color: arkmeTheme.caption },
  time: { whiteSpace: 'nowrap', color: arkmeTheme.tertiary, fontSize: 10 },
  headline: { minWidth: 0, maxWidth: '100%', margin: '12px 0 0', overflowWrap: 'anywhere', fontSize: 15, lineHeight: 1.5, fontWeight: 600 },
  textBlock: { minWidth: 0, maxWidth: '100%' },
  text: { minWidth: 0, maxWidth: '100%', margin: '8px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere', color: arkmeTheme.text, fontSize: 13, lineHeight: 1.62 },
  textCollapsed: { display: '-webkit-box', WebkitBoxOrient: 'vertical', overflow: 'hidden' },
  textToggle: { marginTop: 3, padding: '3px 0', border: 0, background: 'transparent', color: arkmeTheme.accent, cursor: 'pointer', font: 'inherit', fontSize: 11, lineHeight: 1.4 },
  imageGrid: { width: '100%', maxWidth: 620, minWidth: 0, marginTop: 12, boxSizing: 'border-box', display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 6 },
  image: { width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 11, background: arkmeTheme.subtle },
  imageButton: { position: 'relative', minWidth: 0, padding: 0, border: 0, borderRadius: 11, overflow: 'hidden', background: arkmeTheme.subtle, cursor: 'pointer' },
  imageOverflow: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(20,22,28,.52)', color: arkmeTheme.foreground, fontSize: 22, lineHeight: 1, fontWeight: 650, letterSpacing: '.01em', pointerEvents: 'none' },
  cardFooter: { minHeight: 24, marginTop: 9, paddingTop: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12 },
  extensionShelf: { padding: '14px 15px', display: 'grid', gap: 11, border: `1px dashed ${arkmeTheme.border}`, borderRadius: 14, background: arkmeTheme.layer1 },
  extensionShelfHeader: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  extensionShelfTitle: { margin: 0, fontSize: 14, lineHeight: '20px', fontWeight: 650 },
  extensionShelfCount: { color: arkmeTheme.secondary, fontSize: 10 },
  extensionShelfList: { display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8 },
  extensionShelfItem: { minWidth: 0, padding: 10, display: 'grid', gridTemplateColumns: '38px minmax(0,1fr)', alignItems: 'center', gap: 10, border: `1px solid ${arkmeTheme.borderSoft}`, borderRadius: 11, background: arkmeTheme.elevated, color: arkmeTheme.text, cursor: 'pointer', textAlign: 'left', font: 'inherit' },
  extensionShelfItemCopy: { minWidth: 0, display: 'grid', gap: 2 },
  extensionShelfItemName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, fontWeight: 600 },
  extensionShelfItemDescription: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: arkmeTheme.secondary, fontSize: 10 },
  extensionShelfFooter: { display: 'flex', justifyContent: 'flex-end' },
  extensionShelfViewAll: { minHeight: 30, padding: '0 9px', border: 0, borderRadius: 8, background: 'transparent', color: arkmeTheme.accent, cursor: 'pointer', font: 'inherit', fontSize: 11, fontWeight: 600 },
  linkButton: { padding: '5px 7px', border: 0, borderRadius: 7, background: 'transparent', color: arkmeTheme.accent, cursor: 'pointer', font: 'inherit', fontSize: 11 },
  commentButton: { width: 32, height: 32, padding: 0, borderRadius: 6, display: 'grid', placeItems: 'center', border: 0, background: 'transparent', color: arkmeTheme.secondary, cursor: 'pointer' },
  commentButtonActive: { color: arkmeTheme.accent, fontWeight: 600 },
  commentPreview: { position: 'relative', marginTop: 6, padding: '8px 12px', overflow: 'hidden', borderRadius: 10, background: arkmeTheme.subtle },
  commentPreviewHitTarget: { position: 'absolute', inset: 0, width: '100%', padding: 0, border: 0, background: 'transparent', cursor: 'pointer' },
  compactCommentRow: { display: 'block', minWidth: 0, overflow: 'hidden', color: arkmeTheme.secondary, fontSize: 11, lineHeight: 1.72, textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  compactCommentReply: { paddingLeft: 14 },
  compactCommentAuthor: { color: arkmeTheme.accent, fontWeight: 650 },
  feedLoadMore: { minHeight: 42, display: 'flex', alignItems: 'center', justifyContent: 'center', color: arkmeTheme.secondary },
  feedLoadMoreStatus: { width: 30, height: 30, display: 'grid', placeItems: 'center' },
  feedLoadMoreSpinner: { width: 22, height: 22, display: 'block' },
  feedLoadMoreRetry: { minHeight: 30, padding: '0 12px', border: 0, borderRadius: 8, background: 'transparent', color: arkmeTheme.accent, cursor: 'pointer', font: 'inherit', fontSize: 11 },
  modalBackdrop: { position: 'fixed', inset: 0, zIndex: 1200, display: 'grid', placeItems: 'center', padding: 24, background: 'rgba(19,21,27,.38)' },
  modal: { width: 'min(540px, 100%)', maxHeight: 'min(720px, 88vh)', overflowY: 'auto', padding: 22, boxSizing: 'border-box', borderRadius: 18, background: arkmeTheme.menu, boxShadow: arkmeTheme.shadow },
  modalError: { color: arkmeTheme.danger, fontSize: 12 },
  publishClose: { flex: '0 0 auto', width: 36, height: 36, marginTop: -3, padding: 0, display: 'grid', placeItems: 'center', border: 0, borderRadius: 10, background: arkmeTheme.elevated, color: arkmeTheme.secondary, cursor: 'pointer' },
  inviteModal: { width: 'min(420px, 100%)', padding: 0, overflow: 'hidden', borderRadius: 20 },
  inviteContent: { padding: '28px 24px 26px', textAlign: 'center' },
  inviteTitle: { margin: 0, color: arkmeTheme.text, fontSize: 17, lineHeight: 1.35, fontWeight: 700 },
  inviteAction: { margin: '14px 0 0', color: arkmeTheme.secondary, fontSize: 15, lineHeight: 1.45 },
  inviteRelationship: { margin: '16px 0 0', color: arkmeTheme.secondary, fontSize: 14, lineHeight: 1.35, fontWeight: 500 },
  inviteStatus: { minHeight: 18, margin: '12px 0 0', color: arkmeTheme.danger, fontSize: 12, lineHeight: 1.5 },
  inviteActions: { display: 'grid', gridTemplateColumns: '1fr 1fr', borderTop: `1px solid ${arkmeTheme.border}` },
  inviteActionButton: { minHeight: 52, padding: '15px 12px', border: 0, background: 'transparent', color: arkmeTheme.text, cursor: 'pointer', font: 'inherit', fontSize: 16 },
  inviteConfirmButton: { borderLeft: `1px solid ${arkmeTheme.border}`, color: arkmeTheme.accent },
  interactionPanel: { width: 'calc(100% - 4px)', minWidth: 0, margin: '6px 2px 16px', padding: '0 12px 12px', boxSizing: 'border-box', display: 'grid', borderRadius: 12, background: arkmeTheme.layer2 },
  interactionPanelSticky: { position: 'sticky', top: 0, zIndex: 3, padding: '4px 0 10px', borderBottom: `1px solid ${arkmeTheme.border}`, background: arkmeTheme.layer2 },
  interactionPanelHeader: { minHeight: 36, padding: '0 2px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  interactionPanelTitle: { fontSize: 14, fontWeight: 600 },
  interactionPanelClose: { minHeight: 32, padding: '0 2px 0 10px', border: 0, background: 'transparent', color: arkmeTheme.accent, cursor: 'pointer', font: 'inherit', fontSize: 11 },
  interactionPanelBody: { minWidth: 0, padding: '4px 2px 10px' },
  interactionEmpty: { minHeight: 96, display: 'grid', placeItems: 'center', color: arkmeTheme.tertiary, fontSize: 12 },
  interactionList: { display: 'grid', margin: 0 },
  interactionThread: { padding: '12px 0' },
  interactionRoot: { display: 'grid', gridTemplateColumns: '28px minmax(0,1fr)', alignItems: 'start', gap: 8 },
  interactionReplyList: { display: 'grid', margin: '7px 0 0 36px', paddingLeft: 9, borderLeft: `2px solid ${arkmeTheme.border}` },
  interactionReply: { display: 'grid', gridTemplateColumns: '22px minmax(0,1fr)', alignItems: 'start', gap: 7, padding: '7px 0' },
  interactionAvatar: { width: 28, height: 28, display: 'grid', placeItems: 'center', overflow: 'hidden', borderRadius: '50%', background: arkmeTheme.accentSoft, color: arkmeTheme.accent, fontSize: 10, fontWeight: 650 },
  interactionReplyAvatar: { width: 22, height: 22, fontSize: 8 },
  interactionBody: { minWidth: 0 },
  interactionMeta: { minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, color: arkmeTheme.secondary, fontSize: 10 },
  interactionAuthorLine: { minWidth: 0, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 5 },
  interactionAuthor: { color: arkmeTheme.text, fontSize: 12, fontWeight: 650 },
  interactionReplyAuthor: { fontSize: 11 },
  interactionReplyTarget: { color: arkmeTheme.secondary, fontSize: 11 },
  interactionContentRow: { minWidth: 0, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', alignItems: 'end', gap: 10 },
  interactionText: { minWidth: 0, margin: '3px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: arkmeTheme.text, fontSize: 12, lineHeight: 1.55 },
  interactionReplyText: { fontSize: 11, lineHeight: 1.5 },
  interactionAction: { alignSelf: 'end', padding: '2px 0 1px 8px', border: 0, background: 'transparent', color: arkmeTheme.secondary, cursor: 'pointer', font: 'inherit', fontSize: 10, whiteSpace: 'nowrap' },
  interactionComposer: { padding: '2px 2px 0', background: 'transparent' },
  interactionComposerRow: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', alignItems: 'end', gap: 9 },
  interactionInput: { width: '100%', height: 40, minHeight: 40, maxHeight: 96, resize: 'none', overflowY: 'auto', padding: '9px 11px', boxSizing: 'border-box', border: `1px solid ${arkmeTheme.border}`, borderRadius: 10, color: arkmeTheme.text, background: arkmeTheme.input, font: 'inherit', fontSize: 12, lineHeight: 1.65, outline: 0 },
  interactionSend: { minWidth: 54, height: 40, padding: '0 13px', border: 0, borderRadius: 10, background: arkmeTheme.primaryAction, color: arkmeTheme.onPrimaryAction, cursor: 'pointer', font: 'inherit', fontSize: 11 },
  previewBackdrop: { position: 'fixed', inset: 0, zIndex: 1300, display: 'grid', placeItems: 'center', padding: '20px 10px', boxSizing: 'border-box', background: 'rgba(0,0,0,.78)' },
  previewModal: { position: 'relative', width: '100%', height: '100%', minWidth: 0, minHeight: 0 },
  previewStage: { position: 'absolute', top: 30, right: 0, bottom: 20, left: 0, minWidth: 0, minHeight: 0, overflow: 'hidden', borderRadius: 12 },
  previewViewport: { position: 'absolute', inset: 0, minWidth: 0, minHeight: 0, overflow: 'hidden', overscrollBehavior: 'contain' },
  previewMedia: { position: 'relative', width: '100%', height: '100%', minWidth: 0, minHeight: 0 },
  previewImage: { position: 'absolute', inset: 0, display: 'block', width: '100%', height: '100%', objectFit: 'contain', userSelect: 'none' },
  previewClose: { position: 'absolute', top: 0, right: 8, zIndex: 2, width: 28, height: 28, padding: 0, display: 'grid', placeItems: 'center', border: 0, borderRadius: '50%', background: 'rgba(255,255,255,.14)', color: '#fff', cursor: 'pointer' },
  previewNav: { position: 'absolute', top: '50%', zIndex: 2, width: 40, height: 40, marginTop: -20, padding: 0, border: 0, borderRadius: '50%', background: 'rgba(255,255,255,.14)', color: '#fff', cursor: 'pointer', fontSize: 24, lineHeight: 1 },
  previewCounter: { position: 'absolute', left: '50%', bottom: 12, zIndex: 2, transform: 'translateX(-50%)', minWidth: 46, padding: '5px 10px', boxSizing: 'border-box', borderRadius: 999, background: 'rgba(20,22,28,.62)', color: '#fff', fontSize: 11, lineHeight: 1.2, textAlign: 'center', pointerEvents: 'none' },
  replyTarget: { marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: arkmeTheme.accent, fontSize: 12 },
}

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof ArkmeClientError) {
    if (error.body.code === 'world-voiceprint-invite-rate-limited' || /\bHTTP\s*429\b/.test(error.body.message)) {
      return '提醒发送太频繁了，稍后再试。'
    }
    return error.body.message
  }
  return error instanceof Error && error.message.trim() !== '' ? error.message : fallback
}

function dateTimeLabel(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return ''
  return new Intl.DateTimeFormat(arkmeIntlLocale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
}

function worldVoiceprintContent(item: Pick<ArkmeWorldFeedItem, 'headline' | 'textContent'>): string {
  return item.textContent.trim() !== '' ? item.textContent : item.headline
}

const WORLD_VOICEPRINT_AVAILABILITY_CACHE_TTL_MILLIS = 5 * 60 * 1000
const MAX_WORLD_VOICEPRINT_AVAILABILITY_CACHE_ENTRIES = 2048

interface WorldVoiceprintAvailabilityCacheEntry {
  playable: boolean
  expiresAtMillis: number
}

const worldVoiceprintAvailabilityCache = new Map<string, WorldVoiceprintAvailabilityCacheEntry>()

function pruneWorldVoiceprintAvailabilityCache(now = Date.now()): void {
  for (const [recordRef, entry] of worldVoiceprintAvailabilityCache) {
    if (entry.expiresAtMillis <= now) worldVoiceprintAvailabilityCache.delete(recordRef)
  }
  while (worldVoiceprintAvailabilityCache.size > MAX_WORLD_VOICEPRINT_AVAILABILITY_CACHE_ENTRIES) {
    const oldest = worldVoiceprintAvailabilityCache.keys().next().value as string | undefined
    if (oldest === undefined) break
    worldVoiceprintAvailabilityCache.delete(oldest)
  }
}

export function rememberWorldVoiceprintAvailability(availability: ArkmeWorldVoiceprintAvailability): void {
  const expiresAtMillis = Date.now() + WORLD_VOICEPRINT_AVAILABILITY_CACHE_TTL_MILLIS
  for (const item of availability.items) {
    const recordRef = item.recordRef.trim()
    if (recordRef === '') continue
    worldVoiceprintAvailabilityCache.delete(recordRef)
    worldVoiceprintAvailabilityCache.set(recordRef, { playable: item.playable, expiresAtMillis })
  }
  pruneWorldVoiceprintAvailabilityCache()
}

export function cachedWorldVoiceprintResolvedRefs(): Set<string> {
  pruneWorldVoiceprintAvailabilityCache()
  return new Set(worldVoiceprintAvailabilityCache.keys())
}

export function cachedWorldVoiceprintPlayableRefs(): Set<string> {
  pruneWorldVoiceprintAvailabilityCache()
  return new Set([...worldVoiceprintAvailabilityCache]
    .filter(([, entry]) => entry.playable)
    .map(([recordRef]) => recordRef))
}

function invalidateWorldVoiceprintAvailability(recordRefs: readonly string[]): void {
  for (const recordRef of recordRefs) worldVoiceprintAvailabilityCache.delete(recordRef)
}

export function pendingWorldVoiceprintRecordRefs(
  items: readonly Pick<ArkmeWorldFeedItem, 'recordRef' | 'teamAuthor'>[],
  resolvedRefs: ReadonlySet<string>,
): string[] {
  const pending: string[] = []
  const seen = new Set<string>()
  for (const item of items) {
    if (item.teamAuthor) continue
    const recordRef = item.recordRef.trim()
    if (recordRef === '' || resolvedRefs.has(recordRef) || seen.has(recordRef)) continue
    seen.add(recordRef)
    pending.push(recordRef)
  }
  return pending
}

export function mergeWorldVoiceprintPlayableRefs(
  current: ReadonlySet<string>,
  availability: ArkmeWorldVoiceprintAvailability,
): Set<string> {
  const next = new Set(current)
  for (const item of availability.items) {
    if (item.playable) next.add(item.recordRef)
    else next.delete(item.recordRef)
  }
  return next
}

export function voiceprintInvitePromptTitle(item: Pick<ArkmeWorldFeedItem, 'headline' | 'textContent'>, variantIndex = 0): string {
  return resolveWorldVoiceprintExpectationCopy(worldVoiceprintContent(item), variantIndex).prompt
}

function uuid(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `world-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

async function withTimeout<T>(promise: Promise<T>, millis: number, message: string, onTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { onTimeout?.(); reject(new Error(message)) }, millis)
  })
  try { return await Promise.race([promise, timeout]) }
  finally { if (timer !== undefined) clearTimeout(timer) }
}

const WORLD_IMAGE_OPTIMIZE_THRESHOLD_BYTES = 2 * 1024 * 1024
const WORLD_IMAGE_OPTIMIZE_TARGET_BYTES = 1_800 * 1024
const worldImageOptimizeCandidates = [
  { dimension: 2560, quality: .9 },
  { dimension: 2048, quality: .84 },
  { dimension: 1600, quality: .8 },
  { dimension: 1280, quality: .76 },
] as const

function worldImageOptimizedFileName(fileName: string): string {
  const normalized = fileName.trim() || 'world-image'
  return `${normalized.replace(/\.[^.]+$/u, '') || 'world-image'}.webp`
}

/** Shrinks large still images before the local-to-OSS upload while preserving unsupported/animated formats. */
export async function optimizeWorldPublishImage(file: File): Promise<File> {
  if (file.size <= WORLD_IMAGE_OPTIMIZE_THRESHOLD_BYTES || !['image/jpeg', 'image/png'].includes(file.type.toLowerCase())
    || typeof createImageBitmap !== 'function' || typeof document === 'undefined' || typeof File !== 'function') return file
  let bitmap: ImageBitmap
  try { bitmap = await createImageBitmap(file) } catch { return file }
  try {
    let best: Blob | undefined
    for (const candidate of worldImageOptimizeCandidates) {
      const scale = Math.min(1, candidate.dimension / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      const context = canvas.getContext('2d')
      if (context === null) return file
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const encoded = await new Promise<Blob | null>(resolve => { canvas.toBlob(resolve, 'image/webp', candidate.quality) })
      if (encoded === null || encoded.size >= file.size) continue
      if (best === undefined || encoded.size < best.size) best = encoded
      if (encoded.size <= WORLD_IMAGE_OPTIMIZE_TARGET_BYTES) break
    }
    return best === undefined
      ? file
      : new File([best], worldImageOptimizedFileName(file.name), { type: best.type || 'image/webp', lastModified: file.lastModified })
  } catch {
    return file
  } finally {
    bitmap.close()
  }
}

function WorldImage(props: { imageRef: string; alt: string; avatar?: boolean; preview?: boolean }) {
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot).auth
  return <ScopedWorldImage key={`${auth?.environment}:${auth?.status}:${auth?.userId}:${props.imageRef}`} {...props} />
}
function ScopedWorldImage({ imageRef, alt, avatar = false, preview = false }: { imageRef: string; alt: string; avatar?: boolean; preview?: boolean }) {
  useArkmeLocale()
  const [source, setSource] = useState(() => cachedWorldImageDataUrl(imageRef) ?? '')
  const [failed, setFailed] = useState(false)
  const [readyToLoad, setReadyToLoad] = useState(() => avatar || preview || cachedWorldImageDataUrl(imageRef) !== undefined)
  const placeholderRef = useRef<HTMLSpanElement>(null)
  const revoked = useRef(false)
  useEffect(() => {
    revoked.current = false
    return subscribeWorldImageInvalidation(imageRef, () => { revoked.current = true; setSource(''); setFailed(true) })
  }, [imageRef])
  useEffect(() => {
    const cached = cachedWorldImageDataUrl(imageRef)
    setSource(cached ?? '')
    setFailed(false)
    if (cached !== undefined || avatar || preview) {
      setReadyToLoad(true)
      return
    }
    setReadyToLoad(false)
    const target = placeholderRef.current
    if (target === null || typeof IntersectionObserver === 'undefined') {
      setReadyToLoad(true)
      return
    }
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      setReadyToLoad(true)
      observer.disconnect()
    }, { rootMargin: '320px 0px' })
    observer.observe(target)
    return () => { observer.disconnect() }
  }, [avatar, imageRef, preview])
  useEffect(() => {
    if (!readyToLoad || source !== '' || failed) return
    let active = true
    void loadWorldImageDataUrl(imageRef)
      .then(dataUrl => { if (active && !revoked.current) setSource(dataUrl) })
      .catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [failed, imageRef, readyToLoad, source])
  const imageStyle = avatar ? styles.avatarImage : preview ? styles.previewImage : styles.image
  if (failed) return <span style={imageStyle} aria-label={tr("{v0}加载失败", { v0: alt })} />
  if (source === '') return <span ref={placeholderRef} style={imageStyle} aria-hidden data-world-image-loading="true" {...(preview ? { 'data-world-image-preview-loading': 'true' } : {})} />
  return <img src={source} alt={preview ? '' : alt} loading={avatar || preview ? 'eager' : 'lazy'} draggable={preview ? false : undefined} style={imageStyle} />
}

export function WorldImagePreviewMedia({ imageRef, alt, zoomed = false }: { imageRef: string; alt: string; zoomed?: boolean }) {
  return <div role="img" aria-label={alt} style={{ ...styles.previewMedia, ...(zoomed ? { width: '200%', height: '200%' } : {}) }}>
    <WorldImage key={imageRef} imageRef={imageRef} alt={alt} preview />
  </div>
}

const worldImagePreviewSingleClickDelayMillis = 280

export interface WorldImagePreviewDragOrigin {
  pointerId: number
  clientX: number
  clientY: number
  scrollLeft: number
  scrollTop: number
}

export function worldImagePreviewDragPosition(origin: WorldImagePreviewDragOrigin, clientX: number, clientY: number): { left: number; top: number } {
  return {
    left: origin.scrollLeft + origin.clientX - clientX,
    top: origin.scrollTop + origin.clientY - clientY,
  }
}

export function WorldImagePreviewDialog({ item, previewIndex, onClose, onSelect, renderMedia }: {
  item: Pick<ArkmeWorldFeedItem, 'imageRefs' | 'authorName'>
  renderMedia?(imageRef: string, zoomed: boolean): import('react').ReactNode
  previewIndex: number
  onClose(): void
  onSelect(index: number): void
}) {
  useArkmeLocale()
  const imageRef = item.imageRefs[previewIndex]
  const viewportRef = useRef<HTMLDivElement>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const dragOriginRef = useRef<WorldImagePreviewDragOrigin | undefined>(undefined)
  const dragMovedRef = useRef(false)
  const suppressNextClickRef = useRef(false)
  const [zoomed, setZoomed] = useState(false)
  const [dragging, setDragging] = useState(false)

  const cancelScheduledClose = () => {
    if (closeTimerRef.current === undefined) return
    clearTimeout(closeTimerRef.current)
    closeTimerRef.current = undefined
  }

  useEffect(() => {
    cancelScheduledClose()
    setZoomed(false)
    setDragging(false)
    dragOriginRef.current = undefined
    dragMovedRef.current = false
    suppressNextClickRef.current = false
    const viewport = viewportRef.current
    if (viewport !== null) {
      viewport.scrollLeft = 0
      viewport.scrollTop = 0
    }
    return cancelScheduledClose
  }, [previewIndex])

  if (imageRef === undefined) return null
  const multiple = item.imageRefs.length > 1

  const handlePreviewClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false
      cancelScheduledClose()
      return
    }
    if (event.detail > 1) {
      cancelScheduledClose()
      return
    }
    cancelScheduledClose()
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = undefined
      onClose()
    }, worldImagePreviewSingleClickDelayMillis)
  }

  const handlePreviewDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    cancelScheduledClose()
    const viewport = viewportRef.current
    if (viewport === null) return
    if (zoomed) {
      setZoomed(false)
      setDragging(false)
      dragOriginRef.current = undefined
      window.requestAnimationFrame(() => {
        viewport.scrollLeft = 0
        viewport.scrollTop = 0
      })
      return
    }
    const bounds = viewport.getBoundingClientRect()
    const localX = event.clientX - bounds.left
    const localY = event.clientY - bounds.top
    const horizontalRatio = localX / Math.max(1, viewport.clientWidth)
    const verticalRatio = localY / Math.max(1, viewport.clientHeight)
    setZoomed(true)
    window.requestAnimationFrame(() => {
      viewport.scrollLeft = horizontalRatio * viewport.scrollWidth - localX
      viewport.scrollTop = verticalRatio * viewport.scrollHeight - localY
    })
  }

  const beginPreviewDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!zoomed || event.button !== 0 || !event.isPrimary) return
    const viewport = viewportRef.current
    if (viewport === null) return
    cancelScheduledClose()
    dragOriginRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    }
    dragMovedRef.current = false
    suppressNextClickRef.current = false
    viewport.setPointerCapture(event.pointerId)
    setDragging(true)
  }

  const movePreviewDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = dragOriginRef.current
    const viewport = viewportRef.current
    if (origin === undefined || origin.pointerId !== event.pointerId || viewport === null) return
    if (Math.abs(event.clientX - origin.clientX) > 2 || Math.abs(event.clientY - origin.clientY) > 2) dragMovedRef.current = true
    const position = worldImagePreviewDragPosition(origin, event.clientX, event.clientY)
    viewport.scrollLeft = position.left
    viewport.scrollTop = position.top
    event.preventDefault()
  }

  const endPreviewDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = dragOriginRef.current
    if (origin === undefined || origin.pointerId !== event.pointerId) return
    dragOriginRef.current = undefined
    suppressNextClickRef.current = dragMovedRef.current
    dragMovedRef.current = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    setDragging(false)
  }

  const selectImage = (index: number) => {
    cancelScheduledClose()
    setZoomed(false)
    setDragging(false)
    dragOriginRef.current = undefined
    dragMovedRef.current = false
    suppressNextClickRef.current = false
    const viewport = viewportRef.current
    if (viewport !== null) {
      viewport.scrollLeft = 0
      viewport.scrollTop = 0
    }
    onSelect(index)
  }

  return <div role="dialog" aria-modal="true" aria-label={tr("世界图片预览")} style={styles.previewBackdrop} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section style={styles.previewModal}>
      <ArkmeCloseButton data-arkme-feedback="neutral" type="button" style={styles.previewClose} aria-label={tr("关闭图片预览")} title={tr("关闭")} onClick={onClose} />
      <div style={styles.previewStage}>
        <div
          ref={viewportRef}
          style={{ ...styles.previewViewport, overflow: zoomed ? 'auto' : 'hidden', cursor: zoomed ? (dragging ? 'grabbing' : 'grab') : 'default', touchAction: zoomed ? 'none' : 'auto' }}
          data-world-image-preview-zoomed={String(zoomed)}
          onClick={handlePreviewClick}
          onDoubleClick={handlePreviewDoubleClick}
          onPointerDown={beginPreviewDrag}
          onPointerMove={movePreviewDrag}
          onPointerUp={endPreviewDrag}
          onPointerCancel={endPreviewDrag}
        >
          {renderMedia ? renderMedia(imageRef, zoomed) : <WorldImagePreviewMedia imageRef={imageRef} alt={tr("{v0}发布的图片 {v1}", { v0: item.authorName, v1: String(previewIndex + 1) })} zoomed={zoomed} />}
        </div>
        {multiple && <>
          <button data-arkme-feedback="neutral" type="button" style={{ ...styles.previewNav, left: 10, opacity: previewIndex === 0 ? 0.3 : 1 }} aria-label={tr("上一张图片")} disabled={previewIndex === 0} onClick={() => { selectImage(Math.max(0, previewIndex - 1)) }}>‹</button>
          <button data-arkme-feedback="neutral" type="button" style={{ ...styles.previewNav, right: 10, opacity: previewIndex === item.imageRefs.length - 1 ? 0.3 : 1 }} aria-label={tr("下一张图片")} disabled={previewIndex === item.imageRefs.length - 1} onClick={() => { selectImage(Math.min(item.imageRefs.length - 1, previewIndex + 1)) }}>›</button>
          <span style={styles.previewCounter} aria-live="polite" data-world-image-preview-counter>{previewIndex + 1} / {item.imageRefs.length}</span>
        </>}
      </div>
    </section>
  </div>
}

function interactionRegionId(recordRef: string, detail = false): string {
  return `world-comments-${detail ? 'detail-' : ''}${encodeURIComponent(recordRef)}`
}

function worldTextRegionId(recordRef: string): string {
  return `world-text-${encodeURIComponent(recordRef)}`
}

export function worldTextCollapsedLines(hasMedia: boolean): number {
  return hasMedia ? 3 : 5
}

/**
 * Give obviously long posts the correct first-frame presentation. The browser
 * then measures the clamped paragraph so responsive widths are handled exactly.
 */
export function worldTextLikelyNeedsCollapse(value: string, maxLines: number): boolean {
  const normalized = value.trim()
  if (normalized === '') return false
  if (normalized.split(/\r\n|\r|\n/).length > maxLines) return true
  return Array.from(normalized.replace(/\s+/g, ' ')).length > maxLines * 96
}

function sameWorldLinkHref(left: string, right: string | undefined): boolean {
  if (right === undefined || right.trim() === '') return false
  try {
    return new URL(left).href === new URL(right).href
  } catch {
    return left.trim() === right.trim()
  }
}

interface WorldExtensionShareLink {
  url: string
  label: string
}

function worldLinkFallbackLabel(link: Readonly<{ href: string }>, extensionShareLink?: WorldExtensionShareLink): string {
  return sameWorldLinkHref(link.href, extensionShareLink?.url)
    ? extensionShareLink!.label
    : ARKME_LINK_FALLBACK_LABEL
}

function WorldLinkText({ text, extensionShareLink }: { text: string; extensionShareLink?: WorldExtensionShareLink }) {
  const renderLink: ArkmeLinkRenderer = link => {
    return <ArkmeTextLink
      href={link.href}
      text={link.text}
      fallbackLabel={worldLinkFallbackLabel(link, extensionShareLink)}
    />
  }
  return <ArkmeRichText text={text} renderLink={renderLink} />
}

export function WorldCollapsibleText({ recordRef, authorName, textContent, hasMedia, extensionShareLink }: {
  recordRef: string
  authorName: string
  textContent: string
  hasMedia: boolean
  extensionShareLink?: WorldExtensionShareLink
}) {
  useArkmeLocale()
  const content = arkmeEmojiPlainText(textContent)
  const maxLines = worldTextCollapsedLines(hasMedia)
  const paragraphRef = useRef<HTMLParagraphElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [collapsible, setCollapsible] = useState(() => worldTextLikelyNeedsCollapse(content, maxLines))
  const textId = worldTextRegionId(recordRef)

  useEffect(() => {
    setExpanded(false)
    setCollapsible(worldTextLikelyNeedsCollapse(content, maxLines))
  }, [content, maxLines])

  useEffect(() => {
    if (expanded) return
    const paragraph = paragraphRef.current
    if (paragraph === null) return
    const measure = () => {
      if (paragraph.clientHeight <= 0) return
      setCollapsible(paragraph.scrollHeight > paragraph.clientHeight + 1)
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(paragraph)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [content, expanded, maxLines])

  return <div style={styles.textBlock}>
    <p
      ref={paragraphRef}
      id={textId}
      style={{ ...styles.text, ...(!expanded ? styles.textCollapsed : {}), ...(!expanded ? { WebkitLineClamp: maxLines } : {}) }}
      data-world-text-expanded={expanded ? 'true' : 'false'}
    ><WorldLinkText text={textContent} {...(extensionShareLink === undefined ? {} : { extensionShareLink })} /></p>
    {collapsible && <button data-arkme-feedback="neutral"
      type="button"
      style={styles.textToggle}
      aria-expanded={expanded}
      aria-controls={textId}
      aria-label={expanded ? tr("收起{v0}发布的全文", { v0: authorName }) : tr("展开{v0}发布的全文", { v0: authorName })}
      data-world-text-collapsible="true"
      onClick={() => { setExpanded(value => !value) }}
    >{expanded ? tr("收起") : '展开全文'}</button>}
  </div>
}

export interface WorldInteractionReplyPresentation {
  item: ArkmeWorldInteractionItem
  replyToName: string
  replyToMemberType?: ArkmeWorldInteractionItem['memberType']
}

export interface WorldInteractionThread {
  root: ArkmeWorldInteractionItem
  replies: WorldInteractionReplyPresentation[]
}

/** Keep replies visually under the top-level comment while retaining their direct addressee. */
export function worldInteractionThreads(rootRef: string, items: readonly ArkmeWorldInteractionItem[]): WorldInteractionThread[] {
  const byRef = new Map(items.map(item => [item.interactionRef, item]))
  const sourceIndex = new Map(items.map((item, index) => [item.interactionRef, index]))
  const threads = new Map<string, WorldInteractionThread>()

  for (const item of items) {
    let root = item
    let cursor = item
    const visited = new Set<string>()
    while (cursor.parentRef !== rootRef) {
      if (visited.has(cursor.interactionRef)) {
        root = item
        break
      }
      visited.add(cursor.interactionRef)
      const parent = byRef.get(cursor.parentRef)
      if (parent === undefined) break
      root = parent
      cursor = parent
    }
    let thread = threads.get(root.interactionRef)
    if (thread === undefined) {
      thread = { root, replies: [] }
      threads.set(root.interactionRef, thread)
    }
    if (item.interactionRef !== root.interactionRef) {
      thread.replies.push({
        item,
        replyToName: byRef.get(item.parentRef)?.authorName ?? root.authorName,
        ...(byRef.get(item.parentRef)?.memberType === undefined ? {} : { replyToMemberType: byRef.get(item.parentRef)!.memberType }),
      })
    }
  }

  return [...threads.values()].sort((left, right) =>
    (sourceIndex.get(left.root.interactionRef) ?? Number.MAX_SAFE_INTEGER)
      - (sourceIndex.get(right.root.interactionRef) ?? Number.MAX_SAFE_INTEGER))
}

function InteractionAvatar({ item, reply, compact }: { item: ArkmeWorldInteractionItem; reply: boolean; compact: boolean }) {
  const size = compact ? (reply ? 20 : 24) : (reply ? 22 : 28)
  return <span style={{
    ...styles.interactionAvatar,
    ...(reply ? styles.interactionReplyAvatar : {}),
    width: size,
    height: size,
    fontSize: reply ? (compact ? 8 : 9) : (compact ? 9 : 11),
  }}>
    {item.avatarRef === undefined
      ? item.avatarFallback?.label ?? item.authorName.slice(0, 1)
      : <WorldImage imageRef={item.avatarRef} alt={tr("{v0}的头像", { v0: item.authorName })} avatar />}
  </span>
}

function WorldImageThumbnails({ item, detail = false, onSelect }: { item: Pick<ArkmeWorldFeedItem, 'imageRefs' | 'authorName'>; detail?: boolean; onSelect(index: number): void }) {
  const visibleImageRefs = detail ? item.imageRefs : item.imageRefs.slice(0, WORLD_FEED_IMAGE_LIMIT)
  const hiddenImageCount = Math.max(0, item.imageRefs.length - visibleImageRefs.length)
  return <>
    {visibleImageRefs.length > 0 && <div style={styles.imageGrid}>{visibleImageRefs.map((imageRef, index) => {
      const overflowCount = index === visibleImageRefs.length - 1 ? hiddenImageCount : 0
      return <button
        key={imageRef}
        type="button"
        style={styles.imageButton}
        aria-label={`预览${item.authorName}发布的图片 ${String(index + 1)}${overflowCount > 0 ? `，另有 ${String(overflowCount)} 张图片` : ''}`}
        onClick={() => { onSelect(index) }}
      >
        <WorldImage imageRef={imageRef} alt={tr("{v0}发布的图片 {v1}", { v0: item.authorName, v1: String(index + 1) })} />
        {overflowCount > 0 && <span style={styles.imageOverflow} data-world-image-overflow={overflowCount}>+{overflowCount}</span>}
      </button>
    })}</div>}
  </>
}

export const WorldTeamReplyContext = createContext<TeamWorldContext | undefined>(undefined)
export const WorldNotificationFocus = createContext<string | undefined>(undefined)

function InteractionRow({ item, replyToName, replyToMemberType, compact, previewImages = false, replyTargetRef, onReply }: {
  item: ArkmeWorldInteractionItem
  replyToName?: string
  replyToMemberType?: ArkmeWorldInteractionItem['memberType']
  compact: boolean
  previewImages?: boolean
  replyTargetRef?: string
  onReply?(item: ArkmeWorldInteractionItem): void
}) {
  const focused = useContext(WorldNotificationFocus) === item.interactionRef
  const teamContext = useContext(WorldTeamReplyContext)
  const [previewIndex, setPreviewIndex] = useState<number>()
  const media = { imageRefs: item.imageRefs ?? [], authorName: item.authorName }
  useEffect(() => {
    if (previewIndex === undefined) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setPreviewIndex(undefined) } }
    document.addEventListener('keydown', close, true)
    return () => document.removeEventListener('keydown', close, true)
  }, [previewIndex])
  const rowRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (focused) rowRef.current?.scrollIntoView?.({ block: 'center' }) }, [focused])
  const reply = replyToName !== undefined
  const active = replyTargetRef === item.interactionRef
  if (compact) {
    return <div data-world-comment-level={reply ? 'reply' : 'root'} style={{ ...styles.compactCommentRow, ...(reply ? styles.compactCommentReply : {}), ...(previewImages ? { whiteSpace: 'normal', fontSize: 13, padding: '4px 0' } : {}) }}>
      <span style={previewImages ? { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' } : undefined}>
        <strong style={styles.compactCommentAuthor}>{item.authorName}</strong><WorldMembershipBadge memberType={item.memberType} />
        {replyToName !== undefined && <><span> {tr("回复")} </span><strong style={styles.compactCommentAuthor}>{replyToName}</strong><WorldMembershipBadge memberType={replyToMemberType} /></>}
        <span>：<WorldLinkText text={item.textContent} /></span>
      </span>
      {previewImages && media.imageRefs.length > 0 && <div style={{ maxWidth: 360 }}><WorldImageThumbnails item={media} onSelect={setPreviewIndex} /></div>}
      {previewImages && previewIndex !== undefined && <WorldImagePreviewDialog item={media} previewIndex={previewIndex} onClose={() => setPreviewIndex(undefined)} onSelect={setPreviewIndex} />}
    </div>
  }
  return <div ref={rowRef} data-world-notification-focus={focused || undefined} data-world-comment-level={reply ? 'reply' : 'root'} style={{
    ...(reply ? styles.interactionReply : styles.interactionRoot),
    ...(focused ? { background: arkmeTheme.active, borderRadius: 8, outline: `1px solid ${arkmeTheme.border}` } : {}),
  }}>
    <InteractionAvatar item={item} reply={reply} compact={compact} />
    <div style={styles.interactionBody}>
      <header style={styles.interactionMeta}>
        <span style={styles.interactionAuthorLine}>
          <strong style={{ ...styles.interactionAuthor, ...(reply ? styles.interactionReplyAuthor : {}) }}>{item.authorName}</strong>
          {item.teamAuthor ? <WorldTeamBadge /> : <WorldMembershipBadge memberType={item.memberType} />}
          {replyToName !== undefined && <span style={styles.interactionReplyTarget}>{tr("回复 {v0}", { v0: replyToName })}<WorldMembershipBadge memberType={replyToMemberType} /></span>}
        </span>
        <time>{dateTimeLabel(item.publishedAtMillis || item.createdAtMillis)}</time>
      </header>
      <div style={styles.interactionContentRow}>
        <p style={{ ...styles.interactionText, ...(reply ? styles.interactionReplyText : {}) }}><WorldLinkText text={item.textContent} /></p>
        {onReply !== undefined && <button data-arkme-feedback="neutral" type="button" style={styles.interactionAction} aria-label={tr("回复{v0}的评论", { v0: item.authorName })} onClick={() => { onReply(item) }}>{active ? tr("取消回复") : tr("回复")}</button>}
      </div>
      {teamContext && media.imageRefs.length > 0 && <WorldImageThumbnails item={media} onSelect={setPreviewIndex} />}
      {teamContext && previewIndex !== undefined && <WorldImagePreviewDialog item={media} previewIndex={previewIndex} onClose={() => setPreviewIndex(undefined)} onSelect={setPreviewIndex} />}
    </div>
  </div>
}

export function WorldInteractionThreadList({ rootRef, items, maxVisibleItems, compact = false, previewImages = false, replyTargetRef, onReply }: {
  rootRef: string
  items: readonly ArkmeWorldInteractionItem[]
  maxVisibleItems?: number
  compact?: boolean
  previewImages?: boolean
  replyTargetRef?: string
  onReply?(item: ArkmeWorldInteractionItem): void
}) {
  const limit = maxVisibleItems === undefined ? Number.POSITIVE_INFINITY : Math.max(0, Math.trunc(maxVisibleItems))
  let remaining = limit
  const visible: WorldInteractionThread[] = []
  for (const thread of worldInteractionThreads(rootRef, items)) {
    if (remaining <= 0) break
    const replies = thread.replies.slice(0, Math.max(0, remaining - 1))
    visible.push({ root: thread.root, replies })
    remaining -= 1 + replies.length
  }
  return <div style={styles.interactionList} data-world-comment-preview={compact || undefined}>
    {visible.map(thread => <section key={thread.root.interactionRef} style={{ ...styles.interactionThread, ...(compact ? { padding: 0, borderBottom: 0 } : {}) }}>
      <InteractionRow item={thread.root} compact={compact} previewImages={previewImages} {...(replyTargetRef === undefined ? {} : { replyTargetRef })} {...(onReply === undefined ? {} : { onReply })} />
      {thread.replies.length > 0 && <div style={{ ...styles.interactionReplyList, ...(compact ? { margin: 0, paddingLeft: 0, borderLeft: 0 } : {}) }}>
        {thread.replies.map(reply => <InteractionRow key={reply.item.interactionRef} item={reply.item} replyToName={reply.replyToName} {...(reply.replyToMemberType === undefined ? {} : { replyToMemberType: reply.replyToMemberType })} compact={compact} previewImages={previewImages} {...(replyTargetRef === undefined ? {} : { replyTargetRef })} {...(onReply ===undefined ? {} : { onReply })} />)}
      </div>}
    </section>)}
  </div>
}

export function worldInteractionCountLabel(count: number, hasMore = false): string {
  const normalized = Math.max(0, Math.trunc(count))
  if (normalized === 0) return '评论'
  return `评论 ${String(normalized)}${hasMore ? '+' : ''}`
}

export function WorldInteractionPreviewContent({ item, items, onOpen, previewImages = false }: { item: ArkmeWorldFeedItem; items: readonly ArkmeWorldInteractionItem[]; onOpen(): void; previewImages?: boolean }) {
  return <section style={styles.commentPreview} aria-label={tr("{v0}的精选评论", { v0: item.authorName })}
    onClick={previewImages ? event => {
      if (event.defaultPrevented || !(event.target instanceof Element) || event.target.closest('button,a,[role="dialog"],[data-arkme-membership-anchor]') || window.getSelection()?.toString()) return
      event.stopPropagation(); onOpen()
    } : undefined}>
    <WorldInteractionThreadList rootRef={item.recordRef} items={items} maxVisibleItems={3} compact previewImages={previewImages} />
    {!previewImages && <button type="button" style={styles.commentPreviewHitTarget} aria-label={tr("打开{v0}的评论面板，共 {v1} 条评论", { v0: item.authorName, v1: String(item.extendCount) })} title={tr("打开全部评论")} onClick={onOpen} />}
  </section>
}

function WorldInteractionPreview({ item, onOpen, teamPreview = false, refreshVersion = 0 }: { item: ArkmeWorldFeedItem; onOpen(): void; teamPreview?: boolean; refreshVersion?: number }) {
  useArkmeLocale()
  const [items, setItems] = useState<ArkmeWorldInteractionItem[]>([])
  const container = useRef<HTMLDivElement>(null)
  const previous = useRef<ArkmeWorldInteractionItem[]>([])
  // Team publications do not carry a comment count; read only visible cards, never scan history for previews.
  const refreshItem = teamPreview ? item : undefined
  useEffect(() => {
    if (!teamPreview && item.extendCount <= 0) { setItems([]); return }
    let controller: AbortController | undefined
    const read = () => {
      controller = new AbortController()
      const signal = controller.signal
      void withArkmeReadDeadline(readSignal => callArkme<ArkmeWorldRepliesPage>('world.replies', { recordRef: item.recordRef, limit: teamPreview ? 3 : 20 }, readSignal, teamPreview ? { priority: 'background' } : undefined), signal)
        .then(page => {
          if (signal.aborted) return
          const currentImages = new Set(page.items.flatMap(comment => comment.imageRefs ?? []))
          invalidateWorldImages(previous.current.flatMap(comment => comment.imageRefs ?? []).filter(ref => !currentImages.has(ref)))
          previous.current = page.items; setItems(page.items)
          const visible = worldInteractionThreads(item.recordRef, page.items).flatMap(thread => [thread.root, ...thread.replies.map(reply => reply.item)]).slice(0, 3)
          void hydrateWorldAuthorLabels(visible.filter(comment => !comment.teamAuthor).map(comment => comment.authorRef ?? comment.interactionRef), signal,
            labels => { if (!signal.aborted) setItems(current => applyWorldInteractionAuthorLabels(current, labels)) }).catch(() => {})
        })
        .catch(() => {
          if (signal.aborted) return
          invalidateWorldImages(previous.current.flatMap(comment => comment.imageRefs ?? [])); previous.current = []; setItems([])
        })
    }
    if (!teamPreview || typeof IntersectionObserver === 'undefined' || !container.current) { read(); return () => controller?.abort() }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { if (!controller) read() }
      else { controller?.abort(); controller = undefined }
    })
    observer.observe(container.current)
    return () => { observer.disconnect(); controller?.abort() }
  }, [item.extendCount, item.recordRef, teamPreview, refreshItem, refreshVersion])
  const content = items.length > 0 ? <WorldInteractionPreviewContent item={item} items={items} onOpen={onOpen} previewImages={teamPreview} /> : null
  return teamPreview ? <div ref={container} style={{ minHeight: 1 }} data-world-team-comments>{content}</div> : content
}

export function worldExtensionPublicationTextContent(item: ArkmeWorldFeedItem): string {
  const content = item.textContent.trim()
  const share = item.extensionPublication?.share
  if (share === undefined) return content
  const shareUrl = share.url.trim()
  if (shareUrl === '') return content
  if (content.includes(shareUrl)) return content
  if (content === '') return shareUrl
  return `${content}\n${shareUrl}`
}

export const WORLD_EXTENSION_SHELF_PREVIEW_LIMIT = 6

export function worldExtensionShelfPreview(
  items: readonly ArkmeExtensionCatalogItem[],
  limit = WORLD_EXTENSION_SHELF_PREVIEW_LIMIT,
): ArkmeExtensionCatalogItem[] {
  return items.slice(0, Math.max(0, Math.trunc(limit)))
}

function WorldExtensionShelf({ ownerUserId, ownerName, onOpen, onOpenAll }: {
  ownerUserId: number
  ownerName: string
  onOpen(extensionId: string): void
  onOpenAll(ownerUserId: number, ownerName: string): void
}) {
  useArkmeLocale()
  const [state, setState] = useState<{ status: 'loading' | 'error' | 'ready'; items: ArkmeExtensionCatalogItem[]; total: number; message?: string }>({ status: 'loading', items: [], total: 0 })
  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading', items: [], total: 0 })
    void callArkme<ArkmeExtensionCatalogPage>('extensions.catalog.list', { limit: WORLD_EXTENSION_SHELF_PREVIEW_LIMIT, ownerUserId }, controller.signal)
      .then(page => {
        if (controller.signal.aborted) return
        const items = worldExtensionShelfPreview(page.items.filter(item => item.visibility === 'public' && item.status !== 'deleted'))
        setState({ status: 'ready', items, total: Math.max(page.total, items.length) })
      })
      .catch(error => {
        if (!controller.signal.aborted) setState({ status: 'error', items: [], total: 0, message: messageOf(error, '公开插件暂时无法加载') })
      })
    return () => { controller.abort() }
  }, [ownerUserId])
  if (state.status === 'loading') return <section style={styles.extensionShelf} data-world-extension-shelf="loading"><span role="status" style={styles.extensionShelfCount}>{tr("正在加载公开插件…")}</span></section>
  if (state.status === 'error') return <section style={styles.extensionShelf} data-world-extension-shelf="error"><span role="alert" style={styles.extensionShelfCount}>{state.message}</span></section>
  if (state.items.length === 0) return null
  return <section style={styles.extensionShelf} aria-label={tr("当前公开插件")} data-world-extension-shelf="ready">
    <header style={styles.extensionShelfHeader}><h2 style={styles.extensionShelfTitle}>{tr("当前公开插件")}</h2><span style={styles.extensionShelfCount}>{tr("共")} {state.total} {tr("个")}</span></header>
    <div style={styles.extensionShelfList}>{state.items.map(extension => <button key={extension.extension_id} type="button" style={styles.extensionShelfItem} onClick={() => { onOpen(extension.extension_id) }}>
      <ArkmeExtensionAvatar extensionId={extension.extension_id} {...(extension.icon_ref === undefined ? {} : { iconRef: extension.icon_ref })} size={38} />
      <span style={styles.extensionShelfItemCopy}><span style={styles.extensionShelfItemName}>{extension.name}</span><span style={styles.extensionShelfItemDescription}>{extension.description || `v${extension.latest_stable_version ?? extension.version ?? ''}`}</span></span>
    </button>)}</div>
    {state.total > state.items.length && <footer style={styles.extensionShelfFooter}>
      <button data-arkme-feedback="neutral" type="button" style={styles.extensionShelfViewAll} onClick={() => { onOpenAll(ownerUserId, ownerName) }}>{tr("查看全部")} {state.total} {tr("个")}</button>
    </footer>}
  </section>
}



export function WorldPublisherAttribution({ item }: { item: ArkmeWorldFeedItem }) {
  if (!item.teamAuthor || !item.publisher?.name) return null
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, verticalAlign: 'middle', overflowWrap: 'anywhere' }}>
    {item.publisher.avatarRef && <span data-arkme-avatar style={{ width: 14, height: 14, flexShrink: 0, borderRadius: '50%', overflow: 'hidden' }}><WorldImage imageRef={item.publisher.avatarRef} alt={item.publisher.name} avatar /></span>}
    {tr('{v0} 发布', { v0: item.publisher.name })}
  </span>
}

export function WorldAuthorAvatar({ item }: { item: ArkmeWorldFeedItem }) {
  return <span data-arkme-avatar style={styles.avatar}>{item.avatarRef === undefined
    ? item.avatarFallback?.label ?? item.authorName.slice(0, 1)
    : <WorldImage imageRef={item.avatarRef} alt={tr('{v0}的头像', { v0: item.authorName })} avatar />}</span>
}

export function WorldCard({ item, playable, voiceprintActive, voiceprintLoading, interactionsOpen, onOpenInteractions, onInteractionCreated, onToggleVoiceprint, onInviteVoiceprint, onOpenAuthor, onOpenDetail, selected = false, detail = false, commentsRefreshKey, teamCommentPreview = false, commentPreviewVersion }: {
  item: ArkmeWorldFeedItem
  playable: boolean
  voiceprintActive: boolean
  voiceprintLoading: boolean
  interactionsOpen: boolean
  onOpenInteractions(item: ArkmeWorldFeedItem): void
  onInteractionCreated(recordRef: string): void
  onToggleVoiceprint(recordRef: string): void
  onInviteVoiceprint?(item: ArkmeWorldFeedItem): void
  onOpenAuthor?(item: ArkmeWorldFeedItem): void
  onOpenDetail?(item: ArkmeWorldFeedItem): void
  selected?: boolean
  detail?: boolean
  commentsRefreshKey?: object | undefined
  teamCommentPreview?: boolean
  commentPreviewVersion?: number
}) {
  useArkmeLocale()
  const [previewIndex, setPreviewIndex] = useState<number>()
  const [reactionUnavailable, setReactionUnavailable] = useState(false)
  const onReactionUnavailable = useCallback(() => { invalidateWorldImages(item.imageRefs); setReactionUnavailable(true); setPreviewIndex(undefined) }, [item.imageRefs])
  useEffect(() => { setReactionUnavailable(false) }, [item.recordRef, item.publishedAtMillis])
  const commentInputRef = useRef<HTMLTextAreaElement>(null)
  const composeComment = () => {
    if (interactionsOpen) commentInputRef.current?.focus()
    else onOpenInteractions(item)
  }
  const interactionsId = interactionRegionId(item.recordRef, detail)
  const textContent = item.extensionPublication === undefined
    ? item.textContent
    : worldExtensionPublicationTextContent(item)
  const extensionShareUrl = item.extensionPublication?.share?.url.trim() || undefined
  const extensionShareName = item.extensionPublication?.name.trim() || undefined
  const extensionShareLink = extensionShareUrl === undefined
    ? undefined
    : { url: extensionShareUrl, label: extensionShareName ?? ARKME_LINK_FALLBACK_LABEL }
  useEffect(() => {
    if (previewIndex === undefined) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setPreviewIndex(undefined) }
    window.addEventListener('keydown', closeOnEscape)
    return () => { window.removeEventListener('keydown', closeOnEscape) }
  }, [previewIndex])
  if (reactionUnavailable) return <article style={styles.card} data-world-record-ref={item.recordRef}><p role="status" style={styles.subtitle}>{tr('这条内容已更新或不再公开，请刷新世界')}</p></article>
  return <article style={{ ...styles.card, ...(detail ? { padding: 0, border: 0, borderRadius: 0, background: 'transparent' } : {}), ...(selected ? { borderColor: arkmeTheme.accent } : {}) }} data-world-record-ref={item.recordRef}
    data-world-detail-open={selected || undefined} data-world-detail-content={detail || undefined}
    {...(onOpenDetail === undefined ? {} : { tabIndex: 0, 'aria-label': tr('{v0}的世界动态', { v0: item.authorName }),
      onClick: (event: ReactMouseEvent<HTMLElement>) => {
        if (event.defaultPrevented || event.button !== 0 || event.detail > 1 || !(event.target instanceof Element) || !event.currentTarget.contains(event.target)) return
        if (event.target.closest('button,a,input,select,textarea,audio,video,[contenteditable],[role="button"],[role="dialog"],[role="menu"],[data-arkme-membership-anchor]') || window.getSelection()?.toString()) return
        event.currentTarget.focus({ preventScroll: true }); onOpenDetail(item)
      },
      onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
        if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return
        event.preventDefault(); onOpenDetail(item)
      },
    })}>
    {!detail && <header style={{ ...styles.cardHeader, ...(item.teamAuthor ? { gridTemplateColumns: '36px minmax(0,1fr)' } : {}) }}>
      {item.authorRef === undefined && !item.teamAuthor
        ? <WorldAuthorAvatar item={item} />
        : <button type="button" style={styles.avatarButton} aria-label={tr("查看{v0}的用户卡片", { v0: item.authorName })} onClick={() => { onOpenAuthor?.(item) }}><WorldAuthorAvatar item={item} /></button>}
      <span style={styles.authorMeta}>
        <span style={styles.authorRow}>
          {item.authorRef === undefined && !item.teamAuthor
            ? <strong style={styles.author}>{item.authorName}</strong>
            : <button data-arkme-feedback="neutral" type="button" style={styles.authorButton} aria-label={tr("查看{v0}的用户卡片", { v0: item.authorName })} onClick={() => { onOpenAuthor?.(item) }}><strong style={styles.author}>{item.authorName}</strong></button>}
          {item.teamAuthor ? <WorldTeamBadge /> : <WorldMembershipBadge memberType={item.memberType} />}
          {playable
            ? <button data-arkme-feedback="neutral" data-arkme-feedback-selected={voiceprintActive} type="button" style={{ ...styles.voiceprintButton, ...styles.voiceprintPlayable, ...(voiceprintActive ? styles.voiceprintActive : {}) }} title={voiceprintLoading ? '正在生成声纹，点击停止' : voiceprintActive ? '停止播放声纹' : '播放声纹'} aria-label={voiceprintLoading ? tr("正在生成{v0}的声纹，点击停止", { v0: item.authorName }) : voiceprintActive ? tr("停止播放{v0}的声纹", { v0: item.authorName }) : tr("播放{v0}的声纹", { v0: item.authorName })} aria-busy={voiceprintLoading || undefined} onClick={() => { onToggleVoiceprint(item.recordRef) }}>
              {voiceprintLoading
                ? <SpinnerGap className="arkme-icon-spin" size={15} weight="bold" />
                : <SpeakerHigh size={16} weight="light" />}
            </button>
            : onInviteVoiceprint === undefined || item.teamAuthor ? null : <button data-arkme-feedback="neutral" type="button" style={{ ...styles.voiceprintButton, ...styles.voiceprintInvite }} title={tr("邀请开启声纹")} aria-label={tr("邀请{v0}开启声纹", { v0: item.authorName })} data-world-voiceprint-invite-icon="microphone" onClick={() => { onInviteVoiceprint(item) }}>
              <Microphone size={17} weight="light" />
            </button>}
        </span>
        {item.teamAuthor && <span style={{ color: arkmeTheme.tertiary, fontSize: 11, lineHeight: '18px', marginTop: 4 }}>
          <time>{dateTimeLabel(item.publishedAtMillis || item.createdAtMillis)}</time>
          {item.publisher?.name && <> · <WorldPublisherAttribution item={item} /></>}
        </span>}
      </span>
      {!item.teamAuthor && <time style={styles.time}>{dateTimeLabel(item.publishedAtMillis || item.createdAtMillis)}</time>}
    </header>}
    {item.headline !== '' && <h2 style={styles.headline}><ArkmeRichText text={item.headline} presentation="preview" /></h2>}
    {textContent.trim() !== '' && (detail ? <div style={{ ...styles.text, marginTop: 0 }}><WorldLinkText text={textContent} {...(extensionShareLink === undefined ? {} : { extensionShareLink })} /></div> : <WorldCollapsibleText
      recordRef={item.recordRef}
      authorName={item.authorName}
      textContent={textContent}
      hasMedia={item.imageRefs.length > 0 || item.videoCount > 0 || item.voiceCount > 0}
      {...(extensionShareLink === undefined ? {} : { extensionShareLink })}
    />)}
    <WorldImageThumbnails item={item} detail={detail} onSelect={setPreviewIndex} />
    {teamCommentPreview && <h3 data-world-feedback-heading style={{ margin: '14px 0 2px', fontSize: 12, fontWeight: 500, color: arkmeTheme.secondary }}>{tr('共同反馈')}</h3>}
    <footer style={styles.cardFooter}>
      <ArkmeWorldReactions item={item} onUnavailable={onReactionUnavailable}>
      <button data-arkme-feedback="neutral" data-arkme-feedback-selected={interactionsOpen} type="button" style={{ ...styles.commentButton, ...(interactionsOpen ? styles.commentButtonActive : {}) }} title={tr("评论")} aria-label={tr("评论")} aria-expanded={interactionsOpen} aria-controls={interactionsId} onClick={composeComment}>
        <ChatCircleDots size={18} weight="light" aria-hidden />
      </button>
      <ArkmeWorldShareActions item={item} />
      </ArkmeWorldReactions>
    </footer>
    {!interactionsOpen && (teamCommentPreview || item.extendCount > 0) && <WorldInteractionPreview item={item} onOpen={composeComment} teamPreview={teamCommentPreview} refreshVersion={commentPreviewVersion ?? 0} />}
    {interactionsOpen && <InteractionPanel item={item} commentsRefreshKey={commentsRefreshKey} textareaRef={commentInputRef} onClose={() => { onOpenInteractions(item) }} onInteractionCreated={onInteractionCreated} detail={detail} />}
    {previewIndex !== undefined && <WorldImagePreviewDialog item={item} previewIndex={previewIndex} onClose={() => { setPreviewIndex(undefined) }} onSelect={setPreviewIndex} />}
  </article>
}

const MemoizedWorldCard = memo(WorldCard)

export function VoiceprintInviteDialog({ item, variantIndex, socialContext, sending, message, onClose, onConfirm }: {
  item: ArkmeWorldFeedItem
  variantIndex: number
  socialContext?: ArkmeWorldVoiceprintSocialContext
  sending: boolean
  message?: string
  onClose(): void
  onConfirm(item: ArkmeWorldFeedItem): void
}) {
  const author = item.authorName.trim() === '' ? 'TA' : `「${item.authorName.trim()}」`
  const relations = socialContext?.relations ?? []
  const relationship = relations.length === 0 ? undefined : relations[Math.max(0, variantIndex) % relations.length]
  return <div role="dialog" aria-modal="true" aria-label={tr("邀请开启声纹")} style={styles.modalBackdrop} onMouseDown={event => { if (event.target === event.currentTarget && !sending) onClose() }}>
    <section style={{ ...styles.modal, ...styles.inviteModal }}>
      <div style={styles.inviteContent}>
        <h2 style={styles.inviteTitle}>{voiceprintInvitePromptTitle(item, variantIndex)}</h2>
        {relationship !== undefined && <p style={styles.inviteRelationship}>{relationship.displayLine}</p>}
        <p style={{ ...styles.inviteAction, ...(relationship === undefined ? {} : { marginTop: 7 }) }}>{tr("提醒")}{author}{tr("录入声纹后就能听见这条文字")}</p>
        {message !== undefined && <p role="status" style={styles.inviteStatus}>{message}</p>}
      </div>
      <div style={styles.inviteActions}>
        <button data-arkme-feedback="neutral" type="button" style={styles.inviteActionButton} disabled={sending} onClick={onClose}>{tr("再想想")}</button>
        <button data-arkme-feedback="neutral" type="button" style={{ ...styles.inviteActionButton, ...styles.inviteConfirmButton }} disabled={sending} onClick={() => { onConfirm(item) }}>{sending ? '发送中…' : '让TA知道'}</button>
      </div>
    </section>
  </div>
}

function WorldLoadMoreSpinner() {
  return <svg viewBox="0 0 24 24" fill="none" style={styles.feedLoadMoreSpinner} aria-hidden data-world-load-more-spinner="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity=".2" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur=".8s" repeatCount="indefinite" />
    </path>
  </svg>
}

export function WorldInfiniteScrollTrigger({ scrollRootRef, loading, error, onLoadMore }: {
  scrollRootRef: { readonly current: HTMLElement | null }
  loading: boolean
  error: boolean
  onLoadMore(): void
}) {
  useArkmeLocale()
  const sentinelRef = useRef<HTMLDivElement>(null)
  const loadingRef = useRef(loading)
  const requestedForVisitRef = useRef(false)
  const onLoadMoreRef = useRef(onLoadMore)
  loadingRef.current = loading
  onLoadMoreRef.current = onLoadMore

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (sentinel === null || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => {
      const visible = entries.some(entry => entry.isIntersecting)
      if (!visible) {
        requestedForVisitRef.current = false
        return
      }
      if (loadingRef.current || requestedForVisitRef.current) return
      requestedForVisitRef.current = true
      onLoadMoreRef.current()
    }, { root: scrollRootRef.current, rootMargin: '0px 0px 180px 0px', threshold: 0.01 })
    observer.observe(sentinel)
    return () => { observer.disconnect() }
  }, [scrollRootRef])

  const retry = () => {
    if (loadingRef.current) return
    requestedForVisitRef.current = true
    onLoadMoreRef.current()
  }

  return <div ref={sentinelRef} style={styles.feedLoadMore} data-world-load-more-sentinel="true" aria-hidden={!loading && !error}>
    {loading && <span role="status" aria-label={tr("正在加载更多世界动态")} style={styles.feedLoadMoreStatus}><WorldLoadMoreSpinner /></span>}
    {!loading && error && <button data-arkme-feedback="neutral" type="button" style={styles.feedLoadMoreRetry} onClick={retry}>{tr("重试")}</button>}
  </div>
}

export function ArkmeWorldContent({ state, scope, target, catalogOwnerUserId, catalogOwnerName, voiceprintPlayableRefs, voiceprintRecordRef, voiceprintLoadingRecordRef, interactionRecordRef, actionMessage, onRefresh, onBackToWorld, onSelectScope, onOpenComposer, onOpenInteractions, onInteractionCreated, onToggleVoiceprint, onInviteVoiceprint, onOpenAuthor, onOpenExtension, onOpenAllExtensions, onLoadMore, onSelectPublicTab, publicGroupsSlot, publicTab, publicContent }: {
  state: ArkmeWorldViewState
  scope: WorldScope
  onSelectPublicTab?(tab: PublicSocialTab): void
  publicGroupsSlot?: import('react').ReactNode
  publicTab?: PublicSocialTab | undefined
  publicContent?: import('react').ReactNode
  target?: ArkmeWorldViewTarget
  catalogOwnerUserId?: number
  catalogOwnerName?: string
  voiceprintPlayableRefs: ReadonlySet<string>
  voiceprintRecordRef: string | undefined
  voiceprintLoadingRecordRef?: string
  interactionRecordRef?: string
  actionMessage?: string
  onRefresh(): void
  onBackToWorld?(): void
  onSelectScope(scope: WorldScope): void
  onOpenComposer(): void
  onOpenInteractions(item: ArkmeWorldFeedItem): void
  onInteractionCreated?(recordRef: string): void
  onToggleVoiceprint(recordRef: string): void
  onInviteVoiceprint?(item: ArkmeWorldFeedItem): void
  onOpenAuthor?(item: ArkmeWorldFeedItem): void
  onOpenExtension(extensionId: string): void
  onOpenAllExtensions?(ownerUserId: number, ownerName: string): void
  onLoadMore?(): void
}) {
  useArkmeLocale()
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.addEventListener('arkme-world-publications-changed', onRefresh)
    return () => window.removeEventListener('arkme-world-publications-changed', onRefresh)
  }, [onRefresh])
  const [activity, setActivity] = useState(false), [more, setMore] = useState(false)
  const detailContext = `${publicTab ?? scope}:${target?.userId ?? ''}:${target && 'contactRef' in target ? target.contactRef : ''}`
  const [detailSelection, setDetailSelection] = useState<{ context: string; item: ArkmeWorldFeedItem }>()
  const selectedDetail = detailSelection?.context === detailContext ? detailSelection.item : undefined
  const detailItem = selectedDetail ? state.items.find(item => item.recordRef === selectedDetail.recordRef) ?? selectedDetail : undefined
  const closeDetail = useCallback(() => setDetailSelection(undefined), [])
  const openCardDetail = useCallback((item: ArkmeWorldFeedItem) => {
    setDetailSelection(current => current?.context === detailContext && current.item.recordRef === item.recordRef ? undefined : { context: detailContext, item })
  }, [detailContext])
  useEffect(() => { setDetailSelection(undefined) }, [detailContext])
  const interactionItem = interactionRecordRef === undefined
    ? undefined
    : state.items.find(item => item.recordRef === interactionRecordRef)
  const scrollRootRef = useRef<HTMLDivElement | null>(null)
  const scrollPositionsRef = useRef<Record<WorldScope, number> & Record<string, number>>({ all: 0, mine: 0 })
  const scrollKey = target === undefined ? scope : `user:${target.userId}`
  const cardCallbacksRef = useRef({
    onOpenInteractions,
    onInteractionCreated,
    onToggleVoiceprint,
    onInviteVoiceprint,
    onOpenAuthor,
  })
  cardCallbacksRef.current = {
    onOpenInteractions,
    onInteractionCreated,
    onToggleVoiceprint,
    onInviteVoiceprint,
    onOpenAuthor,
  }
  const openCardInteractions = useCallback((item: ArkmeWorldFeedItem) => { cardCallbacksRef.current.onOpenInteractions(item) }, [])
  const recordCardInteraction = useCallback((recordRef: string) => { cardCallbacksRef.current.onInteractionCreated?.(recordRef) }, [])
  const toggleCardVoiceprint = useCallback((recordRef: string) => { cardCallbacksRef.current.onToggleVoiceprint(recordRef) }, [])
  const inviteCardVoiceprint = useCallback((item: ArkmeWorldFeedItem) => { cardCallbacksRef.current.onInviteVoiceprint?.(item) }, [])
  const openCardAuthor = useCallback((item: ArkmeWorldFeedItem) => { cardCallbacksRef.current.onOpenAuthor?.(item) }, [])
  const bindScrollRoot = useCallback((element: HTMLDivElement | null) => {
    if (element === null && scrollRootRef.current) scrollPositionsRef.current[scrollKey] = scrollRootRef.current.scrollTop
    scrollRootRef.current = element
    if (element !== null) element.scrollTop = scrollPositionsRef.current[scrollKey] ?? 0
  }, [scrollKey])
  const notificationFocus = useContext(WorldNotificationFocus)
  const selectScope = (nextScope: WorldScope) => {
    if (nextScope === scope && !notificationFocus) return
    const transition = worldScopeScrollTransition(
      scrollPositionsRef.current,
      scope,
      nextScope,
      scrollRootRef.current?.scrollTop ?? 0,
    )
    scrollPositionsRef.current = transition.positions
    onSelectScope(nextScope)
  }
  return <>
    <style>{`.arkme-world-columns { position:relative; width:100%; max-width:1020px; padding:0 clamp(12px,2vw,24px); margin:0 auto; box-sizing:border-box; flex:1; min-width:0; min-height:0; display:grid; grid-template-columns:minmax(0,min(640px,100%)) minmax(0,1fr); column-gap:clamp(0px,calc(100% - 688px),32px); }
      .arkme-world-primary { min-width:0; min-height:0; display:flex; flex-direction:column; }`}</style>
    <div className="arkme-world-columns" data-world-columns>
    <div className="arkme-world-primary" data-world-primary-column style={publicTab ? { gridColumn: '1 / -1' } : undefined}>
    <header style={{ ...styles.header, maxWidth: 640 }}>
      {target === undefined
        ? <div><h1 style={styles.heading}>{tr("世界")}</h1><p style={styles.subtitle}>{tr("看看大家此刻正在记录什么")}</p></div>
        : <div style={styles.targetHeading}>
          <button data-arkme-feedback="neutral" type="button" style={styles.backButton} aria-label={'contactRef' in target ? '返回联系人' : '返回世界'} onClick={onBackToWorld}><ArrowLeft size={18} weight="bold" /></button>
          <ArkmeUserAvatar
            {...(target.avatarRef === undefined ? {} : { avatarRef: target.avatarRef })}
            {...(target.avatarFallback === undefined ? {} : { fallback: target.avatarFallback })}
            size={40}
            label={tr("{v0}的头像", { v0: target.displayName })}
          />
          <div style={styles.targetTitle}><h1 style={styles.heading}>{target.displayName}{tr("的世界")}</h1><p style={styles.subtitle}>{tr("TA 公开分享的内容")}</p></div>
        </div>}
      <div style={styles.headerActions}>
        {scope === 'mine' && !publicTab && target === undefined && <ArkmeActionMenu open={more} label={tr('我的世界操作')} onClose={() => setMore(false)} align="end"
          anchor={<button type="button" style={styles.iconButton} aria-label={tr('更多世界操作')} onClick={() => setMore(value => !value)}><DotsThree size={20} /></button>}
          actions={[{ id: 'team-activity', label: tr('我的团队操作'), onSelect: () => { setMore(false); setActivity(true) } }]} />}

        <button data-arkme-feedback="neutral" type="button" style={styles.iconButton} disabled={!publicTab && state.refreshing} title={!publicTab && state.refreshing ? tr("刷新中") : tr("刷新")} aria-label={!publicTab && state.refreshing ? tr("刷新中") : tr("刷新")} onClick={onRefresh}>
          <ArrowClockwise size={18} weight="light" />
        </button>
        {target === undefined && <button data-arkme-feedback="primary" type="button" style={{ ...styles.button, ...styles.primaryButton }} aria-label={tr("发世界")} onClick={onOpenComposer}><Plus size={14} weight="regular" aria-hidden />{tr("发布")}</button>}
      </div>
    </header>
    {target === undefined && <div style={styles.worldToolbar}>
      <nav style={styles.tabs} aria-label={tr("世界范围")}>
        <button data-arkme-feedback="neutral" type="button" style={{ ...styles.tab, ...(!publicTab && scope === 'all' ? styles.tabActive : {}) }} aria-current={!publicTab && scope === 'all' ? 'page' : undefined} onClick={() => { if (publicTab) onSelectScope('all'); else selectScope('all') }}>{tr("世界")}</button>
        <button data-arkme-feedback="neutral" type="button" style={{ ...styles.tab, ...(!publicTab && scope === 'mine' ? styles.tabActive : {}) }} aria-current={!publicTab && scope === 'mine' ? 'page' : undefined} onClick={() => { if (publicTab) onSelectScope('mine'); else selectScope('mine') }}>{tr("我的世界")}</button>
        {onSelectPublicTab && <><button data-arkme-feedback="neutral" type="button" style={{ ...styles.tab, ...(publicTab === 'groups' ? styles.tabActive : {}) }} aria-current={publicTab === 'groups' ? 'page' : undefined} onClick={() => onSelectPublicTab('groups')}>{tr('公开群聊')}</button><button data-arkme-feedback="neutral" type="button" style={{ ...styles.tab, ...(publicTab === 'people' ? styles.tabActive : {}) }} aria-current={publicTab === 'people' ? 'page' : undefined} onClick={() => onSelectPublicTab('people')}>{tr('找人聊聊')}</button></>}
      </nav>
    </div>}
    <div style={styles.worldLayout} data-world-layout={interactionItem === undefined ? 'feed' : 'comments-open'}>
      <div key={scope} ref={bindScrollRoot} style={{ ...styles.body, ...(publicTab ? { display: 'none' } : {}) }} data-world-feed-pane="true" data-world-scroll-container="true" data-world-scope={scope}>
        <div style={styles.feed} data-world-content-stack="true">
        {publicGroupsSlot}
        {catalogOwnerUserId !== undefined && <WorldExtensionShelf
          ownerUserId={catalogOwnerUserId}
          ownerName={catalogOwnerName ?? target?.displayName ?? '我'}
          onOpen={onOpenExtension}
          onOpenAll={onOpenAllExtensions ?? (() => {})}
        />}
        {actionMessage !== undefined && <div role="status" style={{ ...styles.notice, ...(actionMessage.startsWith('已') ? {} : styles.error), width: '100%', margin: 0 }}>{actionMessage}</div>}
        {state.status === 'loading' && <div role="status" style={{ ...styles.notice, width: '100%', margin: 0 }}>{target === undefined ? '正在加载世界…' : tr("正在加载 {v0} 的世界…", { v0: target.displayName })}</div>}
        {state.status === 'error' && <div role="alert" style={{ ...styles.notice, ...styles.error, ...styles.errorRow, width: '100%', margin: 0 }}><span>{state.message}</span><button data-arkme-feedback="neutral" type="button" style={styles.button} onClick={onRefresh}>{tr("重试")}</button></div>}
        {state.status === 'empty' && <ArkmeWorldEmptyNotice style={{ ...styles.emptyNotice, width: '100%', margin: 0 }}>
          {target === undefined ? '这里还没有世界动态。你可以先发一条，或者稍后再刷新。' : 'TA 的世界暂无公开内容。'}
        </ArkmeWorldEmptyNotice>}
        {state.status === 'success' && <>
          {state.message !== undefined && <div role="status" style={{ ...styles.notice, ...styles.error, width: '100%', margin: 0 }}>{state.message}</div>}
          {state.items.map(item => <MemoizedWorldCard
            key={item.recordRef}
            item={item}
            playable={voiceprintPlayableRefs.has(item.recordRef)}
            voiceprintActive={voiceprintRecordRef === item.recordRef}
            voiceprintLoading={voiceprintLoadingRecordRef === item.recordRef}
            interactionsOpen={interactionRecordRef === item.recordRef}
            onOpenInteractions={openCardInteractions}
            onInteractionCreated={recordCardInteraction}
            onToggleVoiceprint={toggleCardVoiceprint}
            onInviteVoiceprint={inviteCardVoiceprint}
            onOpenDetail={openCardDetail}
            selected={detailItem?.recordRef === item.recordRef}
            {...(onOpenAuthor === undefined ? {} : { onOpenAuthor: openCardAuthor })}
          />)}
          {state.hasMore && onLoadMore !== undefined && <WorldInfiniteScrollTrigger
            key={`${scope}:${String(state.nextOffset ?? 'more')}:${String(state.items.length)}`}
            scrollRootRef={scrollRootRef}
            loading={state.loadingMore === true}
            error={state.message !== undefined}
            onLoadMore={onLoadMore}
          />}
        </>}
        </div>
      </div>
      {publicContent && <div data-world-directory-pane style={{ display: publicTab ? 'flex' : 'none', flex: 1, minHeight: 0, minWidth: 0 }}>{publicContent}</div>}
    </div>
    </div>
    {!publicTab && <aside className="arkme-world-reserved" aria-hidden="true" data-world-reserved-column />}
    </div>
    {activity && <TeamWorldActivity onClose={() => setActivity(false)} />}
    {detailItem && <ArkmeWorldRecordDetail key={detailItem.recordRef} item={detailItem} onClose={closeDetail}
      renderAvatar={item => <WorldAuthorAvatar item={item} />}
      {...(onOpenAuthor ? { onOpenAuthor: openCardAuthor } : {})}
      renderContent={item => <WorldCard item={item} commentsRefreshKey={item} detail
        playable={voiceprintPlayableRefs.has(detailItem.recordRef)} voiceprintActive={voiceprintRecordRef === detailItem.recordRef}
        voiceprintLoading={voiceprintLoadingRecordRef === detailItem.recordRef} interactionsOpen
        onOpenInteractions={() => {}} onInteractionCreated={() => recordCardInteraction(detailItem.recordRef)}
        onToggleVoiceprint={toggleCardVoiceprint} onInviteVoiceprint={inviteCardVoiceprint}
        {...(onOpenAuthor ? { onOpenAuthor: openCardAuthor } : {})} />} />}
  </>
}

export function appendWorldPublishFiles(current: readonly File[], selected: readonly File[]): File[] {
  return [...current, ...selected].slice(0, ARKME_WORLD_PUBLISH_MAX_IMAGES)
}

export function removeWorldPublishFile(current: readonly File[], index: number): File[] {
  return current.filter((_file, currentIndex) => currentIndex !== index)
}

interface PublishDialogProps {
  onClose(): void; onPublished(result: ArkmeWorldPublishResult): void
  initialTeam?: ArkmeTeam | undefined; actorName?: string | undefined; actorAvatarRef?: string | undefined
  origin?: WorldPublishOrigin
}
export function PublishDialog(props: PublishDialogProps) {
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot).auth
  const accountKey = auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : ''
  return <ScopedPublishDialog key={`${accountKey}:${props.initialTeam?.jotmoId ?? ''}:${props.origin?.sourceRef ?? ''}:${props.origin?.itemUid ?? ''}`} {...props} accountKey={accountKey} />
}
function ScopedPublishDialog({ onClose, onPublished, initialTeam, actorName, actorAvatarRef, accountKey, origin }: PublishDialogProps & { accountKey: string }) {
  useArkmeLocale()
  const publisher = useTeamWorldPublisher(accountKey, initialTeam)
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<WorldPublishAttachment[]>([])
  const [sourceState, setSourceState] = useState<{ loading: boolean; error?: string; snapshot?: WorldPublishSourceDraft }>({ loading: !!origin })
  const [sourceRevision, setSourceRevision] = useState(0)
  const previewUrls = useRef(new Set<string>())
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState('')
  const sendingRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mutationIdRef = useRef(uuid())
  const composerAt = useRef(Date.now())
  const pendingTeamCommand = useRef<TeamWorldRequest>()
  const [teamPending, setTeamPending] = useState(false)
  const requestRef = useRef<AbortController>()
  useEffect(() => () => { requestRef.current?.abort(); for (const url of previewUrls.current) URL.revokeObjectURL(url) }, [])
  useEffect(() => {
    if (!origin) return
    const controller = new AbortController()
    setSourceState({ loading: true })
    const blockedAttachment: import('../record-reedit-contract.js').ArkmeRecordReeditAttachmentView = { selection: { fileAssetUid: 'unsupported-source-attachment' }, asset: { fileAssetUid: 'unsupported-source-attachment', fileName: tr('原消息附件（暂不支持公开）'), mimeType: 'application/octet-stream', fileKind: 4 as const, size: 0 }, unavailable: true }
    const local = origin.kind === 'local'
    const read = (signal: AbortSignal): Promise<WorldPublishSourceDraft> => local ? Promise.resolve({ ...origin, version: 1, title: '', attachments: origin.hasAttachments ? [blockedAttachment] : [] })
      : origin.kind === 'arko' ? callArkme<Omit<WorldPublishSourceDraft, 'sourceRef' | 'itemUid' | 'version' | 'title'>>('world.arko-source-draft', { sessionId: origin.sessionId, messageId: origin.messageId }, signal).then(value => ({ ...value, sourceRef: origin.sourceRef, itemUid: origin.itemUid, version: 1, title: '', sourceLabel: 'Arko' }))
      : origin.kind === 'action' ? callArkme<{ textContent: string; sendAtMillis: number }>('world.message-source-draft', { conversationRef: origin.sourceRef, actionRef: origin.actionRef }, signal).then(value => ({ ...value, sourceRef: origin.sourceRef, itemUid: origin.itemUid, version: 1, title: '', sourceLabel: tr('Bot 对话'), attachments: origin.hasAttachments ? [blockedAttachment] : [] }))
      : callArkme<WorldPublishSourceDraft>('world.source-draft', { ...origin }, signal)
    void withArkmeReadDeadline(read, controller.signal).then(snapshot => {
      if (controller.signal.aborted) return
      if (snapshot.itemUid !== origin.itemUid || snapshot.sourceRef !== origin.sourceRef || !Number.isSafeInteger(snapshot.version) || snapshot.version <= 0 || !Array.isArray(snapshot.attachments)) throw new Error(tr('原内容返回异常，请重试'))
      setText([snapshot.title.trim(), snapshot.textContent].filter(Boolean).join('\n\n'))
      setAttachments(snapshot.attachments.map((item, index) => ({ id: `source:${index}`, ...(item.asset ? { asset: item.asset } : {}), ...(item.block ? { block: item.block } : {}), ...(!item.asset || item.unavailable ? { unavailable: true } : {}) })))
      setSourceState({ loading: false, snapshot })
    }).catch(error => { if (!controller.signal.aborted) setSourceState({ loading: false, error: messageOf(error, '原内容暂时无法读取') }) })
    return () => controller.abort()
  }, [origin?.sourceRef, origin?.itemUid, sourceRevision])
  const resetMutationId = () => {
    mutationIdRef.current = uuid()
  }
  const chooseFiles = (selectedFiles: FileList | readonly File[] | null) => {
    const selected = Array.from(selectedFiles ?? [])
    if (selected.length === 0) return
    if (selected.some(file => !file.type.startsWith('image/') || file.size > ARKME_WORLD_PUBLISH_MAX_IMAGE_BYTES || file.size <= 0)) { setMessage(tr('请选择不超过 20MB 的图片')); return }
    if (selected.length + attachments.length > ARKME_WORLD_PUBLISH_MAX_IMAGES) { setMessage(tr('最多添加 27 张图片')); return }
    const next = selected.map(file => {
      const url = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : undefined
      if (url) previewUrls.current.add(url)
      return { id: uuid(), file, ...(url ? { previewUrl: url } : {}) }
    })
    setAttachments(current => [...current, ...next])
    resetMutationId()
    setMessage('')
  }
  const removeFile = (id: string) => {
    const url = attachments.find(item => item.id === id)?.previewUrl
    if (url) { URL.revokeObjectURL(url); previewUrls.current.delete(url) }
    setAttachments(current => current.filter(item => item.id !== id))
    resetMutationId()
    setMessage('')
  }
  const applyTeamReceipt = (result: TeamWorldReceipt) => {
    if (result.pending || !result.result) { setMessage(tr('团队已接收稿件，正在完成发布；请再次点击发布确认原请求，不会重复发布。')); return }
    pendingTeamCommand.current = undefined; setTeamPending(false)
    if (result.result.visibility === 'rejected') { setMessage(tr('内容审核未通过，团队原件已保存。')); resetMutationId(); return }
    if (!['published','pending'].includes(result.result.visibility)) { setMessage(tr('团队原件已保存，当前未公开。')); resetMutationId(); return }
    resetMutationId()
    window.dispatchEvent(new Event('arkme-world-publications-changed'))
    onPublished({ recordSaved: true, recordState: 'synced', worldPublished: true, visibility: result.result.visibility === 'pending' ? 'pending_review' : 'visible', checkStatus: result.result.visibility === 'pending' ? 1 : 2, retryable: false })
    onClose()
  }
  const retryTeamCommand = async () => {
    if (!pendingTeamCommand.current || sendingRef.current) return
    sendingRef.current = true; setSending(true)
    const c = new AbortController(); requestRef.current = c
    const owner = arkmeAuthStore.getSnapshot().auth
    const stop = arkmeAuthStore.subscribe(() => { const current = arkmeAuthStore.getSnapshot().auth; if (current?.userId !== owner?.userId || current?.environment !== owner?.environment || current?.status !== owner?.status) c.abort() })
    try { const result = await callArkme<TeamWorldReceipt>('team.world', pendingTeamCommand.current, c.signal); c.signal.throwIfAborted(); applyTeamReceipt(result) }
    catch (e) { if (!c.signal.aborted) setMessage(messageOf(e, '结果尚未确认，请再次点击发布确认原请求')) }
    finally { stop(); sendingRef.current = false; if (!c.signal.aborted) setSending(false) }
  }
  const submit = async () => {
    if (sendingRef.current) return
    if (pendingTeamCommand.current) { await retryTeamCommand(); return }
    if (sourceState.loading || sourceState.error) return
    const textContent = text.trim()
    if (textContent === '') { setMessage(attachments.length > 0 ? '图片动态也需要写一点文字' : '请输入要发到世界的内容'); return }
    if (textContent.length > 2000 || attachments.length > ARKME_WORLD_PUBLISH_MAX_IMAGES || attachments.some(worldPublishAttachmentBlocked)) { setMessage(tr('请先调整正文或移除世界暂不支持的附件')); return }
    if (publisher.selected && (publisher.loading || !publisher.team || !accountKey)) {
      setMessage(tr(publisher.loading ? '正在核验团队身份…' : '当前团队身份不可用，请重新选择；草稿已保留。')); return
    }
    const controller = new AbortController()
    requestRef.current = controller
    const owner = arkmeAuthStore.getSnapshot().auth
    const stopAccount = arkmeAuthStore.subscribe(() => {
      const current = arkmeAuthStore.getSnapshot().auth
      if (current?.status !== owner?.status || current?.environment !== owner?.environment || current?.userId !== owner?.userId) controller.abort()
    })
    sendingRef.current = true
    setSending(true)
    try {
      if (publisher.selected) {
        await requirePhoneForSocialAction('代表团队发布到世界', controller.signal)
        setMessage(tr('正在准备团队稿件…'))
        const source = await callArkme<{ sourceRef: string }>('team.world', { action: 'source', accountKey, origin: origin ?? { kind: 'local', sourceRef: 'world-composer', itemUid: mutationIdRef.current, textContent, sourceLabel: '世界编辑器', sendAtMillis: composerAt.current, hasAttachments: false }, version: sourceState.snapshot?.version ?? 1 }, controller.signal)
        const imageRefs: string[] = [], sourceAssetUids: string[] = []
        for (const attachment of attachments) {
          if (attachment.asset) { sourceAssetUids.push(attachment.asset.fileAssetUid); continue }
          const file = await optimizeWorldPublishImage(attachment.file!)
          const contentBase64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('图片读取失败')); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.readAsDataURL(file) })
          controller.signal.throwIfAborted()
          const asset = await callArkme<TeamWorldAsset>('team.world', { action: 'image-upload', accountKey, teamRef: publisher.team!.teamRef, contentUid: mutationIdRef.current, uploadUid: attachment.id, contentBase64, mimeType: file.type }, controller.signal)
          imageRefs.push(asset.imageRef)
        }
        pendingTeamCommand.current = { action: 'submit', accountKey, teamRef: publisher.team!.teamRef, requestUid: mutationIdRef.current, expectedRevision: 0, change: 'publish', draft: { title: '', text: textContent, format: 'plain', sourceRef: source.sourceRef, imageRefs, sourceAssetUids } }
        setTeamPending(true)
        const result = await callArkme<TeamWorldReceipt>('team.world', pendingTeamCommand.current, controller.signal)
        controller.signal.throwIfAborted(); applyTeamReceipt(result); return
      }
      await requirePhoneForSocialAction('发布到世界', controller.signal)
      if (origin && (!origin.kind || origin.kind === 'record')) {
        const result = await callArkme<ArkmeWorldPublishResult>('world.publications', { action: 'publish-source', accountKey, origin, version: sourceState.snapshot?.version }, controller.signal)
        controller.signal.throwIfAborted()
        if (!result.worldPublished) throw new Error(result.error ?? '发布未完成，请重试')
        window.dispatchEvent(new Event('arkme-world-publications-changed'))
        onPublished(result); onClose(); return
      }
      setSending(true)
      setMessage(attachments.length > 0 ? '正在上传图片…' : '正在发布…')
      const assets = await withTimeout(Promise.all(attachments.map(async item => {
        if (item.asset) return item.asset
        setAttachments(current => current.map(value => value.id === item.id ? { ...value, state: 'preparing' } : value))
        try {
          const file = await optimizeWorldPublishImage(item.file!)
          controller.signal.throwIfAborted()
          const asset = await worldSdk.upload(file, { fileName: file.name || 'world-image', signal: controller.signal })
          controller.signal.throwIfAborted()
          setAttachments(current => current.map(value => { if (value.id !== item.id) return value; const { state: _state, error: _error, ...rest } = value; return { ...rest, asset } }))
          return asset
        } catch (error) {
          if (!controller.signal.aborted) setAttachments(current => current.map(value => value.id === item.id ? { ...value, state: 'failed', error: messageOf(error, '图片上传失败') } : value))
          throw error
        }
      })), 60_000, '图片上传等待太久，请检查网络后重试', () => { controller.abort() })
      controller.signal.throwIfAborted()
      setMessage('正在发布…')
      const result = await withTimeout<ArkmeWorldPublishResult>(assets.length > 0
        ? worldSdk.publishWorldFileAssets({
            clientMutationId: mutationIdRef.current,
            textContent,
            fileAssets: assets.map(asset => ({
              fileAssetUid: asset.fileAssetUid,
              fileName: asset.fileName,
              mimeType: asset.mimeType,
              size: asset.size,
              fileKind: 1,
            })),
          }, controller.signal)
        : worldSdk.publishWorldText({
            clientMutationId: mutationIdRef.current,
            textContent,
          }, controller.signal),
      90_000, '发布等待太久，请刷新世界后确认是否已发布', () => { controller.abort() })
      controller.signal.throwIfAborted()
      if (!result.worldPublished) {
        throw new Error(result.error ?? (result.recordSaved ? '内容已保存，但发到世界失败，请重试' : '发布失败，请稍后重试'))
      }
      resetMutationId()
      onPublished(result)
      onClose()
    } catch (error) { if (!isSocialBindingRequired(error)) setMessage(messageOf(error, '发布失败，请稍后重试')) }
    finally {
      stopAccount(); controller.abort(); sendingRef.current = false; setSending(false)
      const current = arkmeAuthStore.getSnapshot().auth
      if (current?.userId === owner?.userId && current?.environment === owner?.environment) setAttachments(items => items.map(item => item.state === 'preparing' ? { ...item, state: 'failed', error: tr('上传中断，请重试') } : item))
    }
  }
  const blocked = text.length > 2000 || attachments.length > ARKME_WORLD_PUBLISH_MAX_IMAGES || attachments.some(worldPublishAttachmentBlocked)
  const disabled = sending || teamPending || sourceState.loading || !!sourceState.error
  const destination = publisher.selected
    ? tr('发布到{v0}的世界 · 由{v1}发布', { v0: publisher.displayTeam?.name ?? tr('团队'), v1: actorName ?? tr('我') })
    : tr('发布到世界')
  if (origin) return <WorldPublishIdentityDialog publisher={publisher} actorName={actorName} actorAvatarRef={actorAvatarRef}
    busy={sending} pending={teamPending} loading={sourceState.loading} error={sourceState.error} message={message}
    blockedReason={attachments.some(worldPublishAttachmentBlocked) ? tr('原消息包含暂不支持公开的附件，当前无法完整发布。')
      : text.length > 2000 || attachments.length > ARKME_WORLD_PUBLISH_MAX_IMAGES ? tr('原消息超出世界发布限制，当前无法完整发布。') : undefined}
    onRetry={() => { setMessage(''); setSourceRevision(value => value + 1) }}
    onSelect={id => { if (sending || teamPending) return; publisher.select(id); resetMutationId(); setMessage('') }}
    onClose={onClose} onPublish={() => { void submit() }} />
  return <div role="dialog" aria-modal="true" aria-label={tr('发世界')} style={styles.modalBackdrop} onMouseDown={event => { if (event.target === event.currentTarget && !sending) onClose() }}>
    <section style={{ ...styles.modal, width: 'min(640px, 100%)', maxHeight: 'calc(100vh - 48px)', padding: 20, borderRadius: 16 }} data-world-publish-dialog="shared-self">
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>{tr('发世界')}</h2>
        <ArkmeCloseButton type="button" style={styles.publishClose} disabled={sending} aria-label={tr('关闭发布窗口')} onClick={onClose} />
      </header>
      {origin && <p style={{ margin: '0 0 8px', fontSize: 11, color: arkmeTheme.secondary }}>{tr('来自{v0} · 发布副本', { v0: sourceState.snapshot?.sourceLabel ?? worldPublishSourceLabel(origin) })}</p>}
      {sourceState.loading && <p role="status">{tr('正在读取原内容…')}</p>}
      {sourceState.error && <p role="alert">{sourceState.error} <button type="button" onClick={() => setSourceRevision(value => value + 1)}>{tr('重试')}</button></p>}
      <input ref={fileInputRef} hidden type="file" accept="image/*" multiple disabled={disabled} aria-label={tr('选择世界图片')}
        onChange={event => { chooseFiles(event.currentTarget.files); event.currentTarget.value = '' }} />
      <ArkmePublishComposer value={text} textFormat={sourceState.snapshot?.textFormat ?? 'plain'} accountKey={accountKey} disabled={disabled} actionDisabled={sending || sourceState.loading || !!sourceState.error}
        onChange={value => { setText(value); resetMutationId(); setMessage('') }} destination={destination}
        canPublish={!blocked && !!text.trim()} onPublish={() => { void submit() }}
        onAdd={files => { if (files) chooseFiles(files); else fileInputRef.current?.click() }}
        attachments={attachments.length > 0 && <WorldPublishAttachments items={attachments} disabled={disabled} onRemove={removeFile}
          onMove={(from, to) => { setAttachments(current => { const next = [...current], item = next.splice(from, 1)[0]; if (item) next.splice(to, 0, item); return next }); resetMutationId() }} onRetry={() => { void submit() }} />}
        identity={<TeamWorldPublisherPicker compact state={publisher} actorName={actorName} actorAvatarRef={actorAvatarRef} disabled={disabled}
          onSelect={id => { publisher.select(id); resetMutationId(); setMessage('') }} />} />
      {blocked && <p role="alert" style={{ fontSize: 12, color: arkmeTheme.danger }}>{text.length > 2000 ? tr('世界正文最多 2000 字，请调整发布副本后继续。') : tr('请从发布副本中移除世界暂不支持或不可用的附件；原快记不受影响。')}</p>}
      <div role="status" style={{ marginTop: 8, fontSize: 12, lineHeight: 1.6, color: arkmeTheme.secondary }}>{message}</div>
    </section>
  </div>
}

interface InteractionPanelProps { item: ArkmeWorldFeedItem; commentsRefreshKey?: object | undefined; textareaRef: RefObject<HTMLTextAreaElement>; onClose(): void; onInteractionCreated(recordRef: string): void; detail?: boolean }
function InteractionPanel(props: InteractionPanelProps) {
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot).auth
  const accountKey = auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : ''
  return <ScopedInteractionPanel key={`${accountKey}:${props.item.recordRef}`} {...props} accountKey={accountKey} />
}
function ScopedInteractionPanel({ item, textareaRef, onClose, onInteractionCreated, detail = false, accountKey, commentsRefreshKey }: InteractionPanelProps & { accountKey: string }) {
  useArkmeLocale()
  const replyTeam = useContext(WorldTeamReplyContext)
  const [asTeam, setAsTeam] = useState(false), [identityOpen, setIdentityOpen] = useState(false)
  const teamCommand = useRef<Extract<TeamWorldRequest, { action: 'submit' }>>()
  const teamOrigin = useRef<import('../world-publish-source.js').WorldPublishOrigin>()
  const pending = useRef<{ targetRef: string; textContent: string; clientMutationId: string }>()
  const [frozen, setFrozen] = useState(false)
  const sendController = useRef<AbortController>()
  useEffect(() => () => sendController.current?.abort(), [])
  const focusRef = useContext(WorldNotificationFocus)
  const [state, setState] = useState<{ status: 'loading' | 'error' | 'ready'; items: ArkmeWorldInteractionItem[]; message?: string; hasMore: boolean; loadingMore?: boolean }>({ status: 'loading', items: [], hasMore: false })
  const continuation = useRef<WorldCommentContinuation[]>([])
  const moreInFlight = useRef(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const sendingRef = useRef(false)
  const [replyTarget, setReplyTarget] = useState<ArkmeWorldInteractionItem>()
  const loadController = useRef<AbortController>()
  const sendDisabled = sending || draft.trim() === ''
  const applyViewerAuthorLabels = useCallback((labels: readonly ArkmeWorldAuthorLabel[]) => {
    const labelsByRef = new Map(labels.map(label => [label.authorRef, label.authorName]))
    if (labelsByRef.size === 0) return
    setState(current => ({
      ...current,
      items: applyWorldInteractionAuthorLabels(current.items, labels),
    }))
    setReplyTarget(current => {
      if (current?.authorRef === undefined) return current
      const authorName = labelsByRef.get(current.authorRef)
      return authorName === undefined || authorName === current.authorName ? current : { ...current, authorName }
    })
  }, [])
  const hydrateViewerAuthorLabels = useCallback((items: readonly ArkmeWorldInteractionItem[], signal?: AbortSignal) => {
    void hydrateWorldAuthorLabels(items.filter(interaction => !interaction.teamAuthor).map(interaction => interaction.authorRef ?? interaction.interactionRef), signal, applyViewerAuthorLabels).catch(() => {})
  }, [applyViewerAuthorLabels])
  const load = useCallback(() => {
    loadController.current?.abort()
    const controller = new AbortController()
    loadController.current = controller
    // Keep the authorized page visible while refreshing; a failed read still clears it.
    setState(current => { const { message: _message, ...rest } = current; return current.items.length ? rest : { status: 'loading', items: [], hasMore: false } })
    continuation.current = []; moreInFlight.current = false
    void (async () => {
      const page = await loadWorldCommentPage([{ parentRef: item.recordRef, path: [item.recordRef] }],
        (recordRef, limit, cursor) => callArkme<ArkmeWorldRepliesPage>('world.replies', { recordRef, limit, ...(cursor ? { cursor } : {}) }, controller.signal), controller.signal)
      if (!focusRef || page.items.some(value => value.interactionRef === focusRef)) return page
      const target = await callArkme<ArkmeWorldNotificationTarget>('world.notification-target', { interactionRef: focusRef }, controller.signal)
      if (target.root.recordRef !== item.recordRef) throw new Error('回复不属于当前帖子')
      return { ...page, items: [...new Map([...page.items, ...target.path].map(value => [value.interactionRef, value])).values()] }
    })()
      .then(page => {
        if (controller.signal.aborted) return
        continuation.current = page.pending
        setState({ status: 'ready', items: page.items, hasMore: page.pending.length > 0, ...(focusRef && !page.items.some(value => value.interactionRef === focusRef) ? { message: tr('未找到这条回复，可能已删除或不可查看') } : {}) })
        hydrateViewerAuthorLabels(page.items, controller.signal)
      })
      .catch(error => { if (!controller.signal.aborted) setState({ status: 'error', items: [], hasMore: false, message: messageOf(error, '评论暂时无法加载') }) })
  }, [focusRef, hydrateViewerAuthorLabels, item.recordRef])
  useEffect(() => {
    load()
    if (!focusRef && !detail) textareaRef.current?.focus()
    return () => { loadController.current?.abort() }
  }, [load, commentsRefreshKey])
  useEffect(() => {
    if (detail) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => { window.removeEventListener('keydown', closeOnEscape) }
  }, [onClose, detail])
  const loadMore = async () => {
    if (moreInFlight.current || !continuation.current.length) return
    const controller = loadController.current
    if (!controller || controller.signal.aborted) return
    moreInFlight.current = true
    setState(current => {
      const { message: _message, ...rest } = current
      return { ...rest, loadingMore: true }
    })
    try {
      const page = await loadWorldCommentPage(continuation.current,
        (recordRef, limit, cursor) => callArkme<ArkmeWorldRepliesPage>('world.replies', { recordRef, limit, ...(cursor ? { cursor } : {}) }, controller.signal), controller.signal)
      if (controller.signal.aborted) return
      continuation.current = page.pending
      setState(current => ({ ...current, status: 'ready', items: [...new Map([...current.items, ...page.items].map(value => [value.interactionRef, value])).values()], hasMore: page.pending.length > 0, loadingMore: false }))
      hydrateViewerAuthorLabels(page.items, controller.signal)
    } catch (error) {
      // A parent may have been withdrawn between pages. Do not retain a stale branch.
      if (!controller.signal.aborted) setState({ status: 'error', items: [], hasMore: false, message: messageOf(error, '更多评论加载失败，请重试') })
    } finally { if (!controller.signal.aborted) moreInFlight.current = false }
  }
  const send = async () => {
    const textContent = draft.trim()
    if (sendingRef.current || (!pending.current && !textContent)) return
    sendingRef.current = true; setSending(true)
    const controller = new AbortController(); sendController.current = controller
    if (asTeam && !teamCommand.current && !replyTeam?.capabilities.reply) { sendingRef.current = false; setSending(false); setState(current => ({ ...current, message: tr('当前团队身份不可用，请重新选择') })); return }
    if (asTeam) teamCommand.current ??= { action: 'submit', accountKey, teamRef: replyTeam!.teamRef, expectedRevision: 0, requestUid: uuid(), change: 'publish', draft: { title: '', text: textContent, format: 'plain', imageRefs: [], parentRef: replyTarget?.interactionRef ?? item.recordRef } }
    else pending.current ??= { targetRef: replyTarget?.interactionRef ?? item.recordRef, textContent, clientMutationId: uuid() }
    setFrozen(true)
    try {
      if (teamCommand.current) {
        if (!teamCommand.current.draft!.sourceRef) {
          teamOrigin.current ??= { kind: 'local', sourceRef: 'world-reply', itemUid: teamCommand.current.requestUid, textContent: teamCommand.current.draft!.text, sourceLabel: '世界评论', sendAtMillis: Date.now(), hasAttachments: false }
          const source = await callArkme<{ sourceRef: string }>('team.world', { action: 'source', accountKey, origin: teamOrigin.current, version: 1 }, controller.signal)
          teamCommand.current.draft!.sourceRef = source.sourceRef
        }
        const receipt = await callArkme<TeamWorldReceipt>('team.world', teamCommand.current, controller.signal)
        if (controller.signal.aborted) return
        if (receipt.pending || !receipt.result) { setState(current => ({ ...current, message: tr('发送结果尚未确认，请重试原请求') })); return }
        teamCommand.current = undefined; teamOrigin.current = undefined; setFrozen(false)
        if (receipt.result.visibility !== 'published') { setState(current => ({ ...current, message: tr(receipt.result!.visibility === 'pending' ? '评论正在审核' : '评论当前未公开') })); return }
        setDraft(''); setReplyTarget(undefined); load(); onInteractionCreated(item.recordRef); return
      }
      const result = await callArkme<ArkmeWorldInteractionCreateResult>('world.interactions.create-text', pending.current, controller.signal)
      if (controller.signal.aborted) return
      pending.current = undefined; setFrozen(false)
      setState(current => {
        const { message: _message, ...rest } = current
        return { ...rest, status: 'ready', items: [...new Map([...current.items, result.interaction].map(value => [value.interactionRef, value])).values()] }
      })
      setDraft('')
      if (textareaRef.current !== null) textareaRef.current.style.height = '40px'
      setReplyTarget(undefined)
      onInteractionCreated(item.recordRef)
    } catch (error) {
      if (!controller.signal.aborted && !isSocialBindingRequired(error)) setState(current => ({ ...current, message: messageOf(error, '评论结果未确认，请用发送按钮重试原请求') }))
    } finally { sendingRef.current = false; if (!controller.signal.aborted) setSending(false) }
  }
  return <section id={interactionRegionId(item.recordRef, detail)} aria-label={tr("{v0}的评论区", { v0: item.authorName })} style={styles.interactionPanel} data-world-comment-panel={detail ? 'detail' : 'inline'}>
    <div style={styles.interactionPanelSticky} data-world-comment-toolbar="sticky">
      <header style={styles.interactionPanelHeader}>
        <strong style={styles.interactionPanelTitle}>{worldInteractionCountLabel(state.items.length, state.hasMore)}</strong>
        {!detail && <button data-arkme-feedback="neutral" type="button" style={styles.interactionPanelClose} aria-label={tr("收起评论")} onClick={onClose}>{tr("收起")}</button>}
      </header>
      <div style={styles.interactionComposer}>
        {replyTeam?.capabilities.reply && <ArkmeSelfRoleMenu open={identityOpen} onClose={() => setIdentityOpen(false)} selectedIds={[asTeam ? 'team' : 'personal']} showSelectionIndicator
          anchor={<button type="button" style={styles.linkButton} disabled={sending || frozen} onClick={() => setIdentityOpen(value => !value)} aria-label={tr('回复身份')}>{asTeam ? replyTeam.name : tr('我')} ▾</button>}
          actions={[{ id: 'personal', label: tr('我'), onSelect: () => { setAsTeam(false); setIdentityOpen(false) } }, { id: 'team', label: replyTeam.name, onSelect: () => { setAsTeam(true); setIdentityOpen(false) } }]} />}
        {replyTarget !== undefined && <div style={styles.replyTarget}><span>{tr("回复")} {replyTarget.authorName}</span><button data-arkme-feedback="neutral" type="button" style={styles.linkButton} disabled={sending || frozen} onClick={() => { setReplyTarget(undefined); textareaRef.current?.focus() }}>{tr("取消回复")}</button></div>}
        <div style={styles.interactionComposerRow}>
          <textarea ref={textareaRef} aria-label={tr("评论内容")} rows={1} style={styles.interactionInput} value={draft} disabled={sending || frozen} maxLength={20_000} placeholder={replyTarget === undefined ? '写一条评论…' : tr("回复 {v0}…", { v0: replyTarget.authorName })} onChange={event => {
            setDraft(event.currentTarget.value)
            event.currentTarget.style.height = '40px'
            event.currentTarget.style.height = `${String(Math.min(96, event.currentTarget.scrollHeight))}px`
          }} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void send() } }} />
          <button data-arkme-feedback="primary" type="button" style={{ ...styles.interactionSend, ...(sendDisabled ? { opacity: 0.38, cursor: 'default' } : {}) }} title={tr("Ctrl / ⌘ + Enter 发送")} disabled={sendDisabled} onClick={() => { void send() }}>{sending ? '发送中…' : tr("发送")}</button>
        </div>
      </div>
    </div>
    <div style={styles.interactionPanelBody}>
      {state.status === 'loading' && <p role="status" style={styles.subtitle}>{tr("评论加载中…")}</p>}
      {state.message !== undefined && <div role="alert" style={{ ...styles.notice, ...styles.error, width: '100%', margin: '12px 0 0' }}>{state.message}{state.status === 'error' && <button data-arkme-feedback="neutral" type="button" style={{ ...styles.button, marginLeft: 12 }} onClick={load}>{tr("重试")}</button>}</div>}
      <WorldInteractionThreadList
        rootRef={item.recordRef}
        items={state.items}
        {...(replyTarget === undefined ? {} : { replyTargetRef: replyTarget.interactionRef })}
        onReply={interaction => {
          if (sending || frozen) return
          setReplyTarget(current => current?.interactionRef === interaction.interactionRef ? undefined : interaction)
          textareaRef.current?.focus()
        }}
      />
      {state.hasMore && <div style={styles.loadMore}><button data-arkme-feedback="neutral" type="button" style={styles.button} disabled={state.loadingMore} onClick={() => { void loadMore() }}>{state.loadingMore ? tr("加载中…") : tr('加载更多评论')}</button></div>}
      {state.status === 'ready' && state.items.length === 0 && <div style={styles.interactionEmpty}>{tr("还没有评论")}</div>}
    </div>
  </section>
}

const loadingState = (): ArkmeWorldViewState => ({ status: 'loading', items: [] })

/** First-party World page owned by the same product surface as recordings. */
function worldAuthorCardMember(item: ArkmeWorldFeedItem): ArkmeMemberProfileIdentity {
  return {
    displayName: item.authorName,
    ...(item.avatarRef === undefined ? {} : { avatarRef: item.avatarRef }),
    ...(item.avatarFallback === undefined ? {} : { avatarFallback: item.avatarFallback }),
  }
}

export function ArkmeWorldSurface({ notificationRef, target, initialScope = 'all', currentUserId, accountScope, onBackToWorld, onSourceActivated, active = true }: {
  active?: boolean
  notificationRef?: string
  target?: ArkmeWorldViewTarget
  initialScope?: WorldScope
  currentUserId?: number
  accountScope?: string | undefined
  actorName?: string | undefined
  actorAvatarRef?: string | undefined
  onBackToWorld?(): void
  onSourceActivated?(source: ArkmeOpenPrivateChatResult['source']): void
} = {}) {
  useArkmeLocale()
  const [notificationTarget, setNotificationTarget] = useState(notificationRef)
  const [notificationFocus, setNotificationFocus] = useState<string>()
  const [scope, setScope] = useState<WorldScope>(initialScope)
  const [publicTab, setPublicTab] = useState<PublicSocialTab>()
  const [visitedDirectories, setVisitedDirectories] = useState<PublicSocialTab[]>([])
  const [directoryRevisions, setDirectoryRevisions] = useState({ groups: 0, people: 0 })
  const [profileGroupView, setProfileGroupView] = useState<{ uid?: string }>()
  const [createGroupOpen, setCreateGroupOpen] = useState(false)
  useEffect(() => { setProfileGroupView(undefined) }, [target?.userId, scope])
  const [views, setViews] = useState<Record<WorldScope, ArkmeWorldViewState>>({ all: loadingState(), mine: loadingState() })
  const [loaded, setLoaded] = useState<Record<WorldScope, boolean>>({ all: false, mine: false })
  const [composerOpen, setComposerOpen] = useState(false)
  const [interactionRecordRef, setInteractionRecordRef] = useState<string>()
  const worldAuth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot).auth
  const worldAccountKey = worldAuth?.status === 'authenticated' ? `${worldAuth.environment}:${worldAuth.userId}` : ''
  const [teamAuthorCard, setTeamAuthorCard] = useState<ArkmeWorldFeedItem['teamAuthor']>()
  const [authorCardItem, setAuthorCardItem] = useState<ArkmeWorldFeedItem>()
  const [authorCardBusy, setAuthorCardBusy] = useState(false)
  const [inviteItem, setInviteItem] = useState<ArkmeWorldFeedItem>()
  const [inviteSending, setInviteSending] = useState(false)
  const [inviteMessage, setInviteMessage] = useState<string>()
  const [inviteSocialContext, setInviteSocialContext] = useState<ArkmeWorldVoiceprintSocialContext>()
  const invitePresentationIndexesRef = useRef(new Map<string, number>())
  const inviteLoadTokenRef = useRef(0)
  const [playableRefs, setPlayableRefs] = useState<Set<string>>(() => cachedWorldVoiceprintPlayableRefs())
  const resolvedVoiceprintRefsRef = useRef(cachedWorldVoiceprintResolvedRefs())
  const [voiceprintAvailabilityRevision, setVoiceprintAvailabilityRevision] = useState(0)
  const [voiceprintRecordRef, setVoiceprintRecordRef] = useState<string>()
  const [voiceprintLoadingRecordRef, setVoiceprintLoadingRecordRef] = useState<string>()
  const [actionMessage, setActionMessage] = useState<string>()
  const [targetView, setTargetView] = useState<ArkmeWorldViewState>(() => loadingState())
  const loadControllers = useRef<Partial<Record<WorldScope | 'target', AbortController>>>({})
  const pendingAuthorLabels = useRef(new Map<string, { owner: string; refs: Set<string> }>())
  const [authorLabelsRevision, bumpAuthorLabelsRevision] = useState(0)
  const audioRef = useRef<HTMLAudioElement>()
  const voiceprintControllerRef = useRef<AbortController>()
  const voiceprintAudioRefsRef = useRef(new Set<HTMLAudioElement>())
  const voiceprintAudioUrlsRef = useRef(new Map<HTMLAudioElement, string>())
  const voiceprintTokenRef = useRef(0)
  const state = target === undefined ? views[scope] : targetView

  const applyViewerAuthorLabels = useCallback((labels: readonly ArkmeWorldAuthorLabel[]) => {
    const labelsByRef = new Map(labels.map(label => [label.authorRef, label.authorName]))
    if (labelsByRef.size === 0) return
    const memberships = new Map(labels.map(label => [label.authorRef, label.memberType]))
    const update = (view: ArkmeWorldViewState): ArkmeWorldViewState => applyWorldAuthorLabels(view, labelsByRef, memberships)
    setViews(current => {
      const all = update(current.all)
      const mine = update(current.mine)
      return all === current.all && mine === current.mine ? current : { all, mine }
    })
    setTargetView(update)
    setAuthorCardItem(current => {
      if (current?.authorRef === undefined) return current
      const authorName = labelsByRef.get(current.authorRef)
      return authorName === undefined || authorName === current.authorName ? current : { ...current, authorName }
    })
  }, [])

  const queueAuthorLabels = useCallback((slot: string, owner: string, items: readonly ArkmeWorldFeedItem[], replace: boolean) => {
    let pending = pendingAuthorLabels.current.get(slot)
    if (replace || pending?.owner !== owner) {
      pending = { owner, refs: new Set() }
      pendingAuthorLabels.current.set(slot, pending)
    }
    for (const item of items) if (!item.teamAuthor) pending!.refs.add(item.authorRef ?? item.recordRef)
    bumpAuthorLabelsRevision(value => value + 1)
  }, [])
  const feedVisible = active && !profileGroupView && (target !== undefined || !publicTab)
  const authorLabelSlot = target ? 'target' : notificationTarget ? 'notification' : scope
  const authorLabelOwner = target ? String(target.userId) : notificationTarget ?? scope
  useEffect(() => {
    const pending = pendingAuthorLabels.current.get(authorLabelSlot)
    if (!feedVisible || !pending?.refs.size || pending.owner !== authorLabelOwner) return
    const controller = new AbortController()
    void hydrateWorldAuthorLabels([...pending.refs], controller.signal, labels => {
      if (pendingAuthorLabels.current.get(authorLabelSlot) !== pending) return
      for (const label of labels) pending.refs.delete(label.authorRef)
      applyViewerAuthorLabels(labels)
    }).catch(() => {})
    return () => controller.abort()
  }, [feedVisible, authorLabelSlot, authorLabelOwner, authorLabelsRevision, applyViewerAuthorLabels])

  const stopVoiceprintMedia = () => {
    voiceprintControllerRef.current?.abort()
    voiceprintControllerRef.current = undefined
    for (const audio of voiceprintAudioRefsRef.current) {
      audio.onended = null
      audio.onerror = null
      audio.pause()
      audio.removeAttribute('src')
      try { audio.load() } catch { /* The browser may already have released this media element. */ }
      const objectUrl = voiceprintAudioUrlsRef.current.get(audio)
      if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl)
    }
    voiceprintAudioRefsRef.current.clear()
    voiceprintAudioUrlsRef.current.clear()
    audioRef.current = undefined
  }
  useEffect(() => {
    if (!active) { voiceprintTokenRef.current += 1; stopVoiceprintMedia(); setVoiceprintRecordRef(undefined); setVoiceprintLoadingRecordRef(undefined) }
  }, [active])

  const load = useCallback((target: WorldScope, position: number | string = 0, preserveItems = false) => {
    loadControllers.current[target]?.abort()
    const controller = new AbortController()
    loadControllers.current[target] = controller
    setViews(current => ({
      ...current,
      [target]: position === 0
        ? preserveItems && current[target].items.length > 0
          ? { ...current[target], refreshing: true, message: undefined }
          : loadingState()
        : { ...current[target], loadingMore: true, message: undefined },
    }))
    const operation = target === 'mine' ? 'world.mine' : 'world.feed'
    void callArkme<ArkmeWorldFeedPage>(operation, { limit: 20, ...(typeof position === 'string' ? { cursor: position } : { offset: position }) }, controller.signal).then(page => {
      if (controller.signal.aborted) return
      setLoaded(current => ({ ...current, [target]: true }))
      setViews(current => {
        const items = position === 0 ? page.items : appendWorldFeedItems(current[target].items, page.items)
        const hasMore = page.hasMore && (target === 'mine' ? page.nextOffset !== undefined && page.nextOffset > Number(position) : !!page.nextCursor && page.nextCursor !== position)
        return { ...current, [target]: { status: items.length === 0 ? 'empty' : 'success', items, hasMore, ...(hasMore ? target === 'mine' ? { nextOffset: page.nextOffset } : { nextCursor: page.nextCursor } : {}) } }
      })
      queueAuthorLabels(target, target, page.items, position === 0)
    }).catch(error => {
      if (controller.signal.aborted) return
      setLoaded(current => ({ ...current, [target]: true }))
      setViews(current => {
        const previous = current[target]
        const message = messageOf(error, target === 'mine' ? '我的世界暂时无法加载' : '世界暂时无法加载')
        return {
          ...current,
          [target]: previous.items.length > 0
            ? { ...previous, status: 'success', refreshing: false, loadingMore: false, message }
            : { status: 'error', items: [], message },
        }
      })
    }).finally(() => {
      if (loadControllers.current[target] === controller) delete loadControllers.current[target]
    })
  }, [queueAuthorLabels])

  const loadUser = useCallback((profile: ArkmeWorldViewTarget, offset = 0, preserveItems = false) => {
    loadControllers.current.target?.abort()
    const controller = new AbortController()
    loadControllers.current.target = controller
    setTargetView(current => {
      const { message: _message, ...rest } = current
      return offset === 0
        ? preserveItems && current.items.length > 0
          ? { ...rest, refreshing: true }
          : loadingState()
        : { ...rest, loadingMore: true }
    })
    void callArkme<ArkmeWorldFeedPage>('world.user', { userId: profile.userId, limit: 20, offset }, controller.signal)
      .then(page => {
        if (controller.signal.aborted) return
        setTargetView(current => {
          const items = offset === 0 ? page.items : appendWorldFeedItems(current.items, page.items)
          const hasMore = page.hasMore && page.nextOffset !== undefined && page.nextOffset > offset
          return { status: items.length === 0 ? 'empty' : 'success', items, hasMore, ...(hasMore ? { nextOffset: page.nextOffset } : {}) }
        })
        queueAuthorLabels('target', String(profile.userId), page.items, offset === 0)
      }).finally(() => {
        if (loadControllers.current.target === controller) delete loadControllers.current.target
      })
      .catch(error => {
        if (controller.signal.aborted) return
        setTargetView(current => {
          const message = messageOf(error, tr("{v0}的世界暂时无法加载", { v0: profile.displayName }))
          return current.items.length > 0
            ? { ...current, status: 'success', refreshing: false, loadingMore: false, message }
            : { status: 'error', items: [], message }
        })
      })
  }, [queueAuthorLabels])

  const loadNotification = useCallback(() => {
    if (!notificationTarget) return
    loadControllers.current.all?.abort()
    const controller = new AbortController()
    loadControllers.current.all = controller
    setViews(current => ({ ...current, all: loadingState() }))
    void callArkme<ArkmeWorldNotificationTarget>('world.notification-target', { interactionRef: notificationTarget }, controller.signal).then(value => {
      if (controller.signal.aborted) return
      setViews(current => ({ ...current, all: { status: 'success', items: [value.root], hasMore: false } }))
      setLoaded(current => ({ ...current, all: true }))
      setNotificationFocus(value.path.at(-1)?.interactionRef)
      setInteractionRecordRef(value.root.recordRef)
      queueAuthorLabels('notification', notificationTarget, [value.root], true)
    }).catch(error => {
      if (!controller.signal.aborted) setViews(current => ({ ...current, all: { status: 'error', items: [], message: messageOf(error, tr('这条世界动态或评论已不可查看')) } }))
    })
    return () => controller.abort()
  }, [notificationTarget, queueAuthorLabels])
  useEffect(loadNotification, [loadNotification])
  useEffect(() => { if (active && !publicTab && !profileGroupView && !notificationTarget && target === undefined && !loaded[scope]) load(scope) }, [load, loaded, scope, target, notificationTarget, publicTab, profileGroupView, active])
  useEffect(() => {
    if (!active || target === undefined) return
    setInteractionRecordRef(undefined)
    setActionMessage(undefined)
    loadUser(target)
    return () => { loadControllers.current.target?.abort() }
  }, [loadUser, target?.userId, target !== undefined && 'contactRef' in target ? target.contactRef : undefined, active])
  useEffect(() => () => {
    for (const controller of Object.values(loadControllers.current)) controller?.abort()
    loadControllers.current = {}
    voiceprintTokenRef.current += 1
    inviteLoadTokenRef.current += 1
    voiceprintControllerRef.current?.abort()
    for (const audio of voiceprintAudioRefsRef.current) {
      audio.onended = null
      audio.onerror = null
      audio.pause()
      audio.removeAttribute('src')
      const objectUrl = voiceprintAudioUrlsRef.current.get(audio)
      if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl)
    }
    voiceprintAudioRefsRef.current.clear()
    voiceprintAudioUrlsRef.current.clear()
  }, [])
  useEffect(() => {
    if (!feedVisible || state.status !== 'success' || state.items.length === 0) return
    const pendingRefs = pendingWorldVoiceprintRecordRefs(state.items, resolvedVoiceprintRefsRef.current)
    if (pendingRefs.length === 0) return
    const controller = new AbortController()
    void (async () => {
      for (let offset = 0; offset < pendingRefs.length; offset += 20) {
        const result = await callArkme<ArkmeWorldVoiceprintAvailability>(
          'world.voiceprint.availability',
          { recordRefs: pendingRefs.slice(offset, offset + 20) },
          controller.signal,
        )
        if (controller.signal.aborted) return
        rememberWorldVoiceprintAvailability(result)
        for (const item of result.items) resolvedVoiceprintRefsRef.current.add(item.recordRef)
        setPlayableRefs(current => mergeWorldVoiceprintPlayableRefs(current, result))
      }
    })().catch(() => {})
    return () => { controller.abort() }
  }, [state.items, state.status, voiceprintAvailabilityRevision, feedVisible])

  const refresh = () => {
    if (publicTab && target === undefined) { setDirectoryRevisions(current => ({ ...current, [publicTab]: current[publicTab] + 1 })); return }
    setActionMessage(undefined)
    invalidateWorldVoiceprintAvailability(state.items.map(item => item.recordRef))
    for (const item of state.items) resolvedVoiceprintRefsRef.current.delete(item.recordRef)
    setVoiceprintAvailabilityRevision(current => current + 1)
    if (notificationTarget) loadNotification()
    else if (target === undefined) load(scope, 0, true)
    else loadUser(target, 0, true)
  }
  const selectScope = (next: WorldScope) => {
    if (notificationTarget) { loadControllers.current.all?.abort(); setLoaded(current => ({ ...current, all: false })) }
    setPublicTab(undefined); setProfileGroupView(undefined); setNotificationTarget(undefined); setActionMessage(undefined); setInteractionRecordRef(undefined); setScope(next)
  }
  const selectDirectory = (tab: PublicSocialTab) => {
    if (publicTab === tab) return
    stopVoiceprintMedia(); setVoiceprintRecordRef(undefined); setInteractionRecordRef(undefined)
    setVisitedDirectories(current => current.includes(tab) ? current : [...current, tab])
    setPublicTab(tab)
  }
  const toggleInteractions = (item: ArkmeWorldFeedItem) => {
    setInteractionRecordRef(current => current === item.recordRef ? undefined : item.recordRef)
  }
  const recordInteractionCreated = (recordRef: string) => {
    const update = (view: ArkmeWorldViewState): ArkmeWorldViewState => updateWorldViewItem(
      view,
      recordRef,
      item => ({ ...item, extendCount: item.extendCount + 1 }),
    )
    setViews(current => ({ all: update(current.all), mine: update(current.mine) }))
    setTargetView(update)
  }
  const openPrivateChatForAuthor = async (item: ArkmeWorldFeedItem) => {
    if (item.authorRef === undefined || authorCardBusy) return
    setAuthorCardBusy(true)
    try {
      const result = await callArkme<ArkmeOpenPrivateChatResult>('chat.world.private.open', { authorRef: item.authorRef })
      setAuthorCardItem(undefined)
      onSourceActivated?.(result.source)
    } catch (error) {
      setActionMessage(messageOf(error, '暂时无法打开私聊，请稍后重试'))
    } finally { setAuthorCardBusy(false) }
  }
  const toggleVoiceprint = async (recordRef: string) => {
    if (voiceprintRecordRef === recordRef) {
      voiceprintTokenRef.current += 1
      stopVoiceprintMedia()
      setVoiceprintRecordRef(undefined)
      setVoiceprintLoadingRecordRef(undefined)
      return
    }
    const token = voiceprintTokenRef.current + 1
    voiceprintTokenRef.current = token
    stopVoiceprintMedia()
    const controller = new AbortController()
    voiceprintControllerRef.current = controller
    setActionMessage(undefined)
    setVoiceprintRecordRef(recordRef)
    setVoiceprintLoadingRecordRef(recordRef)
    const isActive = () => voiceprintTokenRef.current === token && !controller.signal.aborted
    try {
      const result = await playWorldVoiceprintChunkQueue({
        loadChunk: async chunkIndex => {
          const chunk = await callArkme<ArkmeWorldVoiceprintPlaybackChunk>(
            'world.voiceprint.playback.generate',
            { recordRef, chunkIndex },
            controller.signal,
          )
          if (!isActive()) throw new Error('声纹播放已停止')
          if (typeof Audio === 'undefined' || typeof URL.createObjectURL !== 'function') throw new Error('当前环境无法播放声音')
          const blob = await downloadWorldVoiceprintAudio(
            `/arkme-self/api/media?ref=${encodeURIComponent(chunk.mediaRef)}`,
            controller.signal,
          )
          if (!isActive()) throw new Error('声纹播放已停止')
          const objectUrl = URL.createObjectURL(blob)
          const audio = new Audio(objectUrl)
          audio.preload = 'auto'
          voiceprintAudioRefsRef.current.add(audio)
          voiceprintAudioUrlsRef.current.set(audio, objectUrl)
          audio.load()
          return { ...chunk, audio }
        },
        playChunk: async prepared => {
          if (!isActive()) return
          const { audio } = prepared
          audioRef.current = audio
          try {
            await playPreparedWorldVoiceprintAudio(
              audio,
              controller.signal,
              () => { setVoiceprintLoadingRecordRef(undefined) },
            )
            if (prepared.chunkIndex + 1 < prepared.chunkCount && isActive()) {
              setVoiceprintLoadingRecordRef(recordRef)
            }
          } finally {
            voiceprintAudioRefsRef.current.delete(audio)
            const objectUrl = voiceprintAudioUrlsRef.current.get(audio)
            voiceprintAudioUrlsRef.current.delete(audio)
            audio.removeAttribute('src')
            try { audio.load() } catch { /* The browser may already have released this media element. */ }
            if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl)
            if (audioRef.current === audio) audioRef.current = undefined
          }
        },
        isActive,
      })
      if (result === 'completed' && isActive()) {
        setVoiceprintRecordRef(undefined)
        setVoiceprintLoadingRecordRef(undefined)
      }
    } catch (error) {
      if (!isActive()) return
      voiceprintTokenRef.current += 1
      stopVoiceprintMedia()
      setActionMessage(messageOf(error, '声纹生成失败，请重试'))
      setVoiceprintRecordRef(undefined)
      setVoiceprintLoadingRecordRef(undefined)
    } finally {
      if (voiceprintTokenRef.current === token) voiceprintControllerRef.current = undefined
    }
  }
  const openVoiceprintInvite = async (item: ArkmeWorldFeedItem) => {
    const token = inviteLoadTokenRef.current + 1
    inviteLoadTokenRef.current = token
    setActionMessage(undefined)
    setInviteMessage(undefined)
    setInviteSocialContext(undefined)
    const controller = new AbortController()
    const timeout = setTimeout(() => { controller.abort() }, 6_000)
    let socialContext: ArkmeWorldVoiceprintSocialContext = { relations: [] }
    try {
      socialContext = await callArkme<ArkmeWorldVoiceprintSocialContext>(
        'world.voiceprint.social-context', { recordRef: item.recordRef, forceRefresh: true }, controller.signal,
      )
    } catch { /* Relationship context is optional; the reminder still opens without invented evidence. */ }
    finally { clearTimeout(timeout) }
    if (inviteLoadTokenRef.current !== token) return
    setInviteSocialContext(socialContext)
    setInviteItem(item)
  }
  const closeVoiceprintInvite = () => {
    if (inviteSending || inviteItem === undefined) return
    const currentIndex = invitePresentationIndexesRef.current.get(inviteItem.recordRef) ?? 0
    invitePresentationIndexesRef.current.set(inviteItem.recordRef, currentIndex + 1)
    setInviteItem(undefined)
    setInviteSocialContext(undefined)
  }
  const inviteVoiceprint = async (item: ArkmeWorldFeedItem) => {
    if (inviteSending) return
    setInviteSending(true)
    setInviteMessage(undefined)
    try {
      const result = await callArkme<ArkmeWorldVoiceprintInviteResult>('world.voiceprint.invite', { recordRef: item.recordRef })
      setInviteItem(undefined)
      setActionMessage(tr("已提醒 {v0} 开启声纹", { v0: result.peerDisplayName || item.authorName }))
    } catch (error) { setInviteMessage(messageOf(error, '声纹邀请发送失败，请稍后重试')) }
    finally { setInviteSending(false) }
  }

  const profileUserId = target?.userId ?? (scope === 'mine' ? currentUserId : undefined)
  return <WorldNotificationFocus.Provider value={notificationTarget ? notificationFocus : undefined}><main style={styles.root} data-arkme-owned="world-surface" aria-label={tr("世界")}>
    {accountScope && profileGroupView ? <PublicSocialDirectory
      key={`${accountScope}:${profileUserId}:groups`}
      accountScope={accountScope} currentUserId={currentUserId} mode="groups"
      {...(profileGroupView && profileUserId ? { profileUserId, profileName: target?.displayName ?? tr('我'), initialGroupUid: profileGroupView.uid, onBack: () => setProfileGroupView(undefined) } : {})}
      onTabChange={next => { if (next === 'all' || next === 'mine') selectScope(next); else selectDirectory(next) }}
      onCreateGroup={() => setCreateGroupOpen(true)} onSourceActivated={onSourceActivated}
      onOpenWorld={person => { setPublicTab(undefined); setProfileGroupView(undefined); arkmeUi.showUserWorld({ userId: person.userId, displayName: person.displayName || tr('即我用户') }) }}
    /> : <ArkmeWorldContent state={state} scope={scope} {...(target === undefined ? {} : { target })}
      publicTab={target === undefined ? publicTab : undefined}
      {...(accountScope ? { onSelectPublicTab: selectDirectory,
        publicContent: visitedDirectories.map(mode => <div key={mode} data-world-directory-tab={mode} style={{ display: target === undefined && publicTab === mode ? 'flex' : 'none', flex: 1, minHeight: 0, minWidth: 0 }}>
          <PublicSocialDirectory embedded active={target === undefined && publicTab === mode} accountScope={accountScope} currentUserId={currentUserId} mode={mode} refreshKey={directoryRevisions[mode]}
            onCreateGroup={() => setCreateGroupOpen(true)} onSourceActivated={onSourceActivated}
            onOpenWorld={person => { arkmeUi.showUserWorld({ userId: person.userId, displayName: person.displayName || tr('即我用户') }) }} />
        </div>),
      } : {})}
      {...(accountScope && profileUserId ? { publicGroupsSlot: <>
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 0 2px' }}><IdentityCopyLinkButton accountScope={accountScope} target={{ kind: 'person', userId: profileUserId }} label={profileUserId === currentUserId ? '复制我的链接' : '复制个人链接'} /></div>
        <PublicWorldGroups accountScope={accountScope} userId={profileUserId} onOpen={uid => setProfileGroupView(uid ? { uid } : {})} />
      </> } : {})}
      {...(target?.userId !== undefined ? { catalogOwnerUserId: target.userId } : target === undefined && scope === 'mine' && currentUserId !== undefined ? { catalogOwnerUserId: currentUserId } : {})}
      {...(target?.displayName !== undefined ? { catalogOwnerName: target.displayName } : scope === 'mine' ? { catalogOwnerName: '我' } : {})}
      voiceprintPlayableRefs={playableRefs} voiceprintRecordRef={voiceprintRecordRef}
      {...(voiceprintLoadingRecordRef === undefined ? {} : { voiceprintLoadingRecordRef })}
      {...(interactionRecordRef === undefined ? {} : { interactionRecordRef })}
      {...(actionMessage === undefined ? {} : { actionMessage })}
      onRefresh={refresh} {...(onBackToWorld === undefined ? {} : { onBackToWorld })} onSelectScope={selectScope} onOpenComposer={() => { setComposerOpen(true) }}
      onOpenInteractions={toggleInteractions} onInteractionCreated={recordInteractionCreated} onToggleVoiceprint={recordRef => { void toggleVoiceprint(recordRef) }}
      onInviteVoiceprint={item => { void openVoiceprintInvite(item) }} onLoadMore={() => {
        if (target === undefined && scope !== 'mine') { if (state.nextCursor) load(scope, state.nextCursor); return }
        if (state.nextOffset === undefined) return
        if (target === undefined) load(scope, state.nextOffset)
        else loadUser(target, state.nextOffset)
      }} onOpenAuthor={item => { if (item.teamAuthor) setTeamAuthorCard(item.teamAuthor); else if (item.authorRef !== undefined) setAuthorCardItem(item) }}
      onOpenExtension={extensionId => { arkmeUi.showExtensionDetail(extensionId) }}
      onOpenAllExtensions={(ownerUserId, ownerName) => { arkmeUi.showAuthorExtensions(ownerUserId, ownerName) }} />}
    {createGroupOpen && accountScope && <ArkmeGroupCreateDialog key={accountScope} accountScope={accountScope} onClose={() => setCreateGroupOpen(false)} onSourceCreated={async source => { await onSourceActivated?.(source); setCreateGroupOpen(false) }} />}
    {composerOpen && <WorldPublishGuide onClose={() => { setComposerOpen(false) }} />}
    {inviteItem !== undefined && <VoiceprintInviteDialog item={inviteItem} variantIndex={invitePresentationIndexesRef.current.get(inviteItem.recordRef) ?? 0} {...(inviteSocialContext === undefined ? {} : { socialContext: inviteSocialContext })} sending={inviteSending} {...(inviteMessage === undefined ? {} : { message: inviteMessage })} onClose={closeVoiceprintInvite} onConfirm={item => { void inviteVoiceprint(item) }} />}
    {teamAuthorCard && <TeamPublicCardDialog accountKey={worldAccountKey} jotmoId={teamAuthorCard.jotmoId} onClose={() => setTeamAuthorCard(undefined)} />}
    {authorCardItem !== undefined && <ArkmeMemberProfileCard
      copyLinkTarget={authorCardItem.authorRef ? { kind: 'author', authorRef: authorCardItem.authorRef } : undefined}
      member={worldAuthorCardMember(authorCardItem)} busy={authorCardBusy}
      onClose={() => { if (!authorCardBusy) setAuthorCardItem(undefined) }}
      onSend={() => { void openPrivateChatForAuthor(authorCardItem) }}
    />}
  </main></WorldNotificationFocus.Provider>
}
