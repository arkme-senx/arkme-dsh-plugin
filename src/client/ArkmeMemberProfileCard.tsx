import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ArkmeConversationMemberItem, ArkmeGroupAvatarFallback } from '../types.js'
import type { IdentityPersonProfile, IdentityShareLink, IdentityShareTarget } from '../identity-share-contract.js'
import type { ArkmeAvatarImagePort } from './avatar-image-store.js'
import { ArkmePersonProfileDialog } from './ArkmePersonProfileDialog.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { identityShareAccountScope } from './identity-share-ui.js'
import { arkmeUi } from './ui-controller.js'
import { conversationWindowRequested } from './conversation-window.js'
import { openTeamOutbound } from './team-outbound.js'
import { tr } from './locale.js'

export function arkmeMemberProfileNames(
  member: Pick<ArkmeConversationMemberItem, 'displayName' | 'memberName' | 'secondaryName'>,
  showTopicNickname: boolean,
): { displayName: string; topicNickname: string } {
  const fallbackDisplayName = member.displayName.trim() || '群成员'
  if (!showTopicNickname) return { displayName: fallbackDisplayName, topicNickname: '' }
  const memberName = member.memberName?.trim() ?? ''
  const secondaryName = member.secondaryName?.trim() ?? ''
  const displayName = memberName !== ''
    && fallbackDisplayName === memberName
    && secondaryName !== ''
    && secondaryName !== memberName
    ? secondaryName
    : fallbackDisplayName
  return {
    displayName,
    topicNickname: memberName !== '' && memberName !== displayName ? memberName : '',
  }
}

export type ArkmeMemberProfileIdentity = Pick<
  ArkmeConversationMemberItem,
  'displayName' | 'memberName' | 'secondaryName' | 'avatarRef'
> & { avatarFallback?: ArkmeGroupAvatarFallback; isSelf?: boolean }

export function ArkmeMemberProfileCard(props: {
  copyLinkTarget?: IdentityShareTarget | undefined
  copyUrl?: string | undefined
  refreshing?: boolean
  refreshError?: string
  person?: IdentityPersonProfile | undefined
  member: ArkmeMemberProfileIdentity
  imagePort?: ArkmeAvatarImagePort
  imageKey?: string | undefined
  error?: string | undefined
  hideSend?: boolean
  showTopicNickname?: boolean
  busy: boolean
  closeWhileBusy?: boolean
  loading?: boolean
  pending?: boolean
  accountName?: string
  browserUrl?: string
  onRefresh?: () => void
  onClose: () => void
  onSend: () => void
  onContactAsTeam?: (() => void) | undefined
}) {
  const scope = useSyncExternalStore(arkmeAuthStore.subscribe, identityShareAccountScope, () => '')
  const issuedScope = useRef(scope)
  const targetKey = JSON.stringify(props.copyLinkTarget)
  const [resolved, setResolved] = useState<{ key: string; person: IdentityPersonProfile }>()
  const [revision, setRevision] = useState(0), [error, setError] = useState(''), [worldBusy, setWorldBusy] = useState(false)
  const worldRequest = useRef<AbortController>()
  const profileReadBusy = useRef(false)
  const [profileRefreshing, setProfileRefreshing] = useState(false), [profileRefreshError, setProfileRefreshError] = useState('')
  const key = `${scope}:${targetKey}:${revision}`
  const person = props.person ?? (resolved?.key === key ? resolved.person : undefined)
  const target = props.copyLinkTarget
  const readPerson = (signal: AbortSignal) => callArkme<IdentityPersonProfile>('identity.person.read', { accountScope: scope, ...target }, signal)
  useEffect(() => {
    profileReadBusy.current = false; setProfileRefreshing(false); setProfileRefreshError('')
    if (!scope || scope !== issuedScope.current || !target || props.person) return
    profileReadBusy.current = true; setProfileRefreshing(true)
    const controller = new AbortController()
    void readPerson(controller.signal).then(value => {
      if (!controller.signal.aborted && scope === identityShareAccountScope()) setResolved({ key, person: value })
    }).catch(() => { if (!controller.signal.aborted && revision > 0) setProfileRefreshError(tr('更新失败')) })
      .finally(() => { if (!controller.signal.aborted) { profileReadBusy.current = false; setProfileRefreshing(false) } })
    return () => controller.abort()
  }, [key, Boolean(props.person)])
  useEffect(() => {
    setWorldBusy(false); setError('')
    return () => { worldRequest.current?.abort(); worldRequest.current = undefined }
  }, [scope, targetKey])
  const world = async () => {
    if (!scope || scope !== identityShareAccountScope() || props.busy || worldRequest.current || (!person && !target)) return
    const controller = new AbortController(); worldRequest.current = controller; setWorldBusy(true); setError('')
    // A fixed conversation window cannot become a World window. Preserve its conversation
    // and use the same portable profile destination as a shared-link card.
    const child = conversationWindowRequested()
    try {
      const current = person ?? await readPerson(controller.signal)
      if (controller.signal.aborted || scope !== identityShareAccountScope()) { return }
      if (child) {
        const link = props.browserUrl ? { url: props.browserUrl } : await callArkme<IdentityShareLink>('identity.share.link', { accountScope: scope, ...target }, controller.signal)
        if (controller.signal.aborted || scope !== identityShareAccountScope()) { return }
        window.open(link.url, '_blank', 'noopener,noreferrer')
      } else arkmeUi.showUserWorld({ userId: current.userId, displayName: names.displayName, ...(props.member.avatarRef ? { avatarRef: props.member.avatarRef } : {}) })
      props.onClose()
    } catch (caught) {
      if (!controller.signal.aborted && scope === identityShareAccountScope()) setError(caught instanceof Error ? caught.message : tr('暂时无法打开TA的世界'))
    } finally {
      if (worldRequest.current === controller) { worldRequest.current = undefined; if (!controller.signal.aborted) setWorldBusy(false) }
    }
  }
  const names = arkmeMemberProfileNames(props.member, props.showTopicNickname === true)
  const team = props.onContactAsTeam ?? (person && typeof person.userId === 'number' && !person.isSelf && scope && !conversationWindowRequested() ? () => {
    if (scope !== identityShareAccountScope()) return
    openTeamOutbound({ accountKey: scope, person: { recipient: { kind: 'public-person', userId: person.userId },
      displayName: names.displayName, ...(props.member.avatarRef ? { avatarRef: props.member.avatarRef } : {}) } })
    props.onClose()
  } : undefined)
  if (scope !== issuedScope.current) return null
  return <ArkmePersonProfileDialog displayName={names.displayName} topicNickname={names.topicNickname}
    accountName={person?.accountName ?? props.accountName} isSelf={person?.isSelf ?? props.member.isSelf} avatarRef={props.member.avatarRef} avatarFallback={props.member.avatarFallback}
    imagePort={props.imagePort} imageKey={props.imageKey} accountScope={scope} copyLinkTarget={target} copyUrl={props.copyUrl}
    refreshing={props.refreshing ?? profileRefreshing} refreshError={props.refreshError ?? profileRefreshError}
    busy={props.busy} closeWhileBusy={props.closeWhileBusy === true} worldBusy={worldBusy} worldDisabled={!person && !target} loading={props.loading ?? false} pending={props.pending ?? false}
    hideSend={props.hideSend} error={error || props.error} onClose={props.onClose} onSend={() => { if (scope === identityShareAccountScope()) props.onSend() }}
    onContactAsTeam={team} onWorld={() => { void world() }} browserUrl={props.browserUrl}
    onRefresh={props.onRefresh ?? (target ? () => { if (profileReadBusy.current) return; profileReadBusy.current = true; setProfileRefreshing(true); setError(''); setRevision(value => value + 1) } : undefined)} />
}
