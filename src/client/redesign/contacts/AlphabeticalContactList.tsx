import {ArkmeTeamAvatar} from '../../ArkmeTeamAvatar.js'
import { tr } from '../../locale.js'
import type { ArkmeBotSummary, ArkmeDirectoryItem } from '../../../types.js'
import { groupContactDirectoryItems } from '../../../contact-directory-presentation.js'
import { ArkmeDefaultAvatarFrame, ArkmeSourceAvatar, ArkmeUserAvatar } from '../../ArkmeAvatar.js'
import type { ArkmeDirectorySelection } from './contact-directory-state.js'
import { UnmarkedSpeakerTokenAvatar } from './UnmarkedSpeakerVisuals.js'

export interface DirectoryItemRowProps {
  item: ArkmeDirectoryItem
  selected: boolean
  onOpenGroup(sourceRef: string): void
  onOpenBot(bot: ArkmeBotSummary): void
  onSelect(selection: ArkmeDirectorySelection): void
}

export function ArkmeDirectoryBotGlyph({ size = 38 }: { size?: number }) {
  return <svg
    width={size * .68}
    height={size * .68}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden
  >
    <line x1="12" y1="3.5" x2="12" y2="6.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <rect x="6.5" y="6.5" width="11" height="11" rx="0.75" stroke="currentColor" strokeWidth="1.7" />
    <line x1="4.5" y1="9.5" x2="4.5" y2="14.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <line x1="19.5" y1="9.5" x2="19.5" y2="14.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <circle cx="10" cy="11" r="0.85" fill="currentColor" />
    <circle cx="14" cy="11" r="0.85" fill="currentColor" />
    <line x1="10" y1="14.25" x2="14" y2="14.25" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
}

function itemSubtitle(item: ArkmeDirectoryItem): string {
  switch (item.kind) {
    case 'group': return ''
    case 'bot': return ''
    case 'unmarked-speaker': return item.subtitle
    case 'team': return item.publicId ?? ''
    case 'contact': return ''
  }
}

function itemTitle(item: ArkmeDirectoryItem): string {
  if (item.kind === 'bot') return item.bot.name
  if (item.kind !== 'contact') return item.displayName
  return item.remark.trim() || item.nickname.trim() || item.displayName
}

function rowContent(item: ArkmeDirectoryItem) {
  const subtitle = itemSubtitle(item)
  const title = itemTitle(item)
  const avatarRef = 'avatarRef' in item ? item.avatarRef : undefined
  return <>
    {item.kind === 'group'
      ? <span className="arkme-contact-directory-avatar" role="img" aria-label={tr("{v0}的群聊头像", { v0: item.displayName })}>
          <ArkmeSourceAvatar
            kind="group"
            {...(item.groupAvatar === undefined ? {} : { groupAvatar: item.groupAvatar })}
            size={38}
          />
        </span>
      : item.kind === 'bot'
        ? <span className="arkme-contact-directory-avatar is-bot" role="img" aria-label={tr("{v0}的机器人头像", { v0: item.bot.name })}>
            <ArkmeDefaultAvatarFrame>
              <ArkmeDirectoryBotGlyph />
            </ArkmeDefaultAvatarFrame>
          </span>
        : item.kind === 'unmarked-speaker'
          ? <span className="arkme-contact-directory-avatar">
              <UnmarkedSpeakerTokenAvatar token={item.speakerToken} label={tr("{v0}的说话人头像", { v0: item.displayName })} />
            </span>
        : item.kind === 'team'
          ? <span className="arkme-contact-directory-avatar is-team" role="img" aria-label={tr("{v0}的团队头像", { v0: item.displayName })}>
              <ArkmeTeamAvatar avatar={item.avatar} name={item.displayName} size={38}/>
            </span>
          : <span className="arkme-contact-directory-avatar">
              <ArkmeUserAvatar
                {...(avatarRef === undefined ? {} : { avatarRef })}
                size={38}
                label={tr("{v0}的头像", { v0: item.displayName })}
              />
            </span>}
    <span className="arkme-contact-directory-row-copy">
      <strong>{title}</strong>
      {subtitle !== '' && <small>{subtitle}</small>}
    </span>
  </>
}

export function DirectoryItemRow({
  item,
  selected,
  onSelect,
}: DirectoryItemRowProps) {
  const selection = item.kind === 'contact'
    ? { kind: 'contact', contactRef: item.contactRef } as const
    : item.kind === 'unmarked-speaker'
      ? { kind: 'unmarked-speaker', candidateRef: item.candidateRef } as const
      : item.kind === 'team'
        ? { kind: 'team', teamRef: item.teamRef } as const
      : item
  return <button
    type="button"
    className={`arkme-contact-directory-row${selected ? ' is-selected' : ''}`}
    data-directory-row-kind={item.kind}
    data-directory-row-ref={item.kind === 'group' ? item.sourceRef : item.kind === 'bot' ? item.bot.botRef : selection === undefined ? '' : item.kind === 'contact' ? item.contactRef : item.kind === 'team' ? item.teamRef : item.candidateRef}
    {...(selection === undefined ? {} : { 'aria-current': selected as true | false })}
    onClick={() => {
      onSelect(selection)
    }}
  >{rowContent(item)}</button>
}

export function AlphabeticalContactList({
  items,
  selection,
  onSelect,
  onOpenGroup,
  onOpenBot,
}: {
  items: Extract<ArkmeDirectoryItem, { kind: 'contact' }>[]
  selection: ArkmeDirectorySelection
  onSelect(selection: ArkmeDirectorySelection): void
  onOpenGroup(sourceRef: string): void
  onOpenBot(bot: ArkmeBotSummary): void
}) {
  return <div className="arkme-contact-directory-alphabetical" role="list">
    {groupContactDirectoryItems(items).map(group => <div key={group.letter} className="arkme-contact-directory-letter-group">
      <div className="arkme-contact-directory-letter" data-directory-letter={group.letter}>{group.letter}</div>
      {group.items.map(item => <DirectoryItemRow
        key={item.contactRef}
        item={item}
        selected={selection.kind === 'contact' && selection.contactRef === item.contactRef}
        onSelect={onSelect}
        onOpenGroup={onOpenGroup}
        onOpenBot={onOpenBot}
      />)}
    </div>)}
  </div>
}
