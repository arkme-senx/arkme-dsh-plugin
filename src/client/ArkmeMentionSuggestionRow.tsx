import type { CSSProperties } from 'react'
import { RobotIcon } from '@phosphor-icons/react/dist/csr/Robot'
import mentionAiThoughtBase64 from '../../assets/mention/icon_ai_thought.svg'
import mentionAllAvatarDarkBase64 from '../../assets/mention/image_at_all_member_dark.png'
import mentionAllAvatarLightBase64 from '../../assets/mention/image_at_all_member_light.png'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { arkmeMentionCandidateIsReservedAsen, arkmeMentionCandidatePrimaryText, type ArkmeMentionCandidate } from './mention-candidates.js'
import { arkmeTheme } from './arkme-theme.js'

export interface ArkmeMentionSuggestionRowStyles {
  row: CSSProperties
  rowActive: CSSProperties
  avatar: CSSProperties
  botAvatar: CSSProperties
  text: CSSProperties
  name: CSSProperties
  secondary: CSSProperties
}

function assetUrl(value: string, mediaType: string): string {
  return value.startsWith('data:') || value.startsWith('/') ? value : `data:${mediaType};base64,${value}`
}

const allMemberLightUrl = assetUrl(mentionAllAvatarLightBase64, 'image/png')
const allMemberDarkUrl = assetUrl(mentionAllAvatarDarkBase64, 'image/png')
const aiThoughtUrl = assetUrl(mentionAiThoughtBase64, 'image/svg+xml')

const themeImageStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
}

const reservedAgentIconStyle: CSSProperties = {
  width: 16,
  height: 16,
  display: 'block',
}

const reservedAgentBadgeStyle: CSSProperties = {
  flex: 'none',
  padding: '2px 6px',
  borderRadius: 10,
  background: 'rgba(144, 151, 161, 0.10)',
  color: arkmeTheme.tertiary,
  fontSize: 10,
  lineHeight: '12px',
  fontWeight: 400,
  whiteSpace: 'nowrap',
}

export function ArkmeMentionSuggestionThemeStyles() {
  return <style>{`
.arkme-mention-all-avatar [data-arkme-theme-image="dark"] { display: none; }
body[data-ds-dark-theme] .arkme-mention-all-avatar [data-arkme-theme-image="light"] { display: none !important; }
body[data-ds-dark-theme] .arkme-mention-all-avatar [data-arkme-theme-image="dark"] { display: block !important; }
`}</style>
}

function ArkmeMentionSuggestionAvatar({ candidate, styles }: {
  candidate: ArkmeMentionCandidate
  styles: Pick<ArkmeMentionSuggestionRowStyles, 'botAvatar'>
}) {
  if (candidate.kind === 'all') {
    return <span className="arkme-mention-all-avatar" style={{ width: '100%', height: '100%', display: 'block' }}>
      <img data-arkme-theme-image="light" src={allMemberLightUrl} alt="" style={themeImageStyle} />
      <img data-arkme-theme-image="dark" src={allMemberDarkUrl} alt="" style={{ ...themeImageStyle, display: 'none' }} />
    </span>
  }
  if (arkmeMentionCandidateIsReservedAsen(candidate)) {
    return <img src={aiThoughtUrl} alt="" style={reservedAgentIconStyle} />
  }
  if (candidate.kind === 'bot') {
    return candidate.avatarRef === undefined
      ? <span style={styles.botAvatar}><RobotIcon size={14} weight="fill" /></span>
      : <ArkmeUserAvatar avatarRef={candidate.avatarRef} size={28} label={candidate.displayName} />
  }
  return <ArkmeUserAvatar {...(candidate.avatarRef === undefined ? {} : { avatarRef: candidate.avatarRef })} size={28} label={candidate.displayName} />
}

export function ArkmeMentionSuggestionRow({ candidate, active, styles, onActive, onSelect }: {
  candidate: ArkmeMentionCandidate
  active: boolean
  styles: ArkmeMentionSuggestionRowStyles
  onActive: () => void
  onSelect: () => void
}) {
  const primary = arkmeMentionCandidatePrimaryText(candidate)
  const reservedAgent = arkmeMentionCandidateIsReservedAsen(candidate)
  const secondary = candidate.kind === 'bot' && !reservedAgent ? (candidate.secondaryName ?? 'Bot').trim() : ''
  return <button
    type="button"
    role="option"
    aria-selected={active}
    style={{
      ...styles.row,
      ...(active ? styles.rowActive : {}),
    }}
    onMouseEnter={onActive}
    onMouseDown={event => {
      event.preventDefault()
      onSelect()
    }}
  >
    <span style={styles.avatar} aria-hidden>
      <ArkmeMentionSuggestionAvatar candidate={candidate} styles={styles} />
    </span>
    <span style={styles.text}>
      <span style={styles.name}>{primary}</span>
      {secondary !== '' && secondary !== candidate.displayName
        ? <span style={styles.secondary}>{secondary}</span>
        : null}
    </span>
    {reservedAgent ? <span style={reservedAgentBadgeStyle}>AI智能体</span> : null}
  </button>
}
