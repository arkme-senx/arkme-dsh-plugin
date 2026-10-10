import type { ArkmeTeamAvatar as Avatar } from '../team-profile-contract.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { teamAvatarImages } from './team-avatar-image-runtime.js'
import { arkmeTheme } from './arkme-theme.js'
import type { TeamChannel } from '../team-app-contract.js'

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Both clients take two visible characters, preserving emoji and combining marks. */
export function teamNameAvatarText(name: string): string {
  const normalized = name.trim().replace(/[a-z]/g, character => character.toUpperCase())
  return Array.from(graphemes.segment(normalized), part => part.segment).filter(part => part.trim()).slice(0, 2).join('') || '团'
}

export function ArkmeTeamNameAvatar({ name, size = 44 }: { name: string; size?: number }) {
  return <span className="arkme-team-name-avatar" aria-label={`${name}的团队头像`} style={{
    width: size, height: size, display: 'inline-grid', placeItems: 'center', flexShrink: 0,
    borderRadius: '50%', background: arkmeTheme.accentSoft, color: arkmeTheme.accent,
    fontSize: size * .32, fontWeight: 600, lineHeight: 1,
  }}>{teamNameAvatarText(name)}</span>
}

export function ArkmeTeamAvatar({ avatar, name, size = 44, label = '团队头像' }: {
  avatar?: Avatar | undefined; name: string; size?: number; label?: string;
}) {
  const fallback = <ArkmeTeamNameAvatar name={name} size={size}/>
  return avatar?.mode === 'custom'
    ? <ArkmeUserAvatar avatarRef={avatar.imageRef} imageKey={avatar.key} imagePort={teamAvatarImages}
        size={size} label={label} fallbackContent={fallback}/>
    : fallback
}

/** The channel override and the current Team profile have separate owners. */
export function ArkmeTeamChannelAvatar({channel,size=44}:{channel:TeamChannel;size?:number}) {
  return channel.imageRef
    ? <ArkmeUserAvatar avatarRef={channel.imageRef} imageKey={channel.imageKey} imagePort={teamAvatarImages}
        size={size} label="团队头像" fallbackContent={<ArkmeTeamNameAvatar name={channel.name} size={size}/>}/>
    : <ArkmeTeamAvatar avatar={channel.avatar} name={channel.name} size={size}/>
}
