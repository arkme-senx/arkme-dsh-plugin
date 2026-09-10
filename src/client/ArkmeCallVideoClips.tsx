import { useCallback, useState } from 'react'
import { PlayIcon } from '@phosphor-icons/react/dist/csr/Play'
import { ArkmeCallVideoPlayer } from './ArkmeCallVideoPlayer.js'
import type { ArkmeCallDetail, ArkmeCallVideoPerspective } from '../types.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { arkmeTheme } from './arkme-theme.js'

export function ArkmeCallVideoClips({ detail }: { detail: ArkmeCallDetail }) {
  const [selected, setSelected] = useState<ArkmeCallVideoPerspective>()
  const closePlayer = useCallback(() => { setSelected(undefined) }, [])
  if (!detail.videoRecord?.available) return null
  const perspectives = detail.videoRecord.perspectives?.filter(value => value.videoUrl) ?? []
  const clips: ArkmeCallVideoPerspective[] = perspectives.length ? perspectives : detail.videoRecord.videoUrl ? [{ perspective: 'unknown', videoUrl: detail.videoRecord.videoUrl, ...(detail.videoRecord.posterUrl ? { posterUrl: detail.videoRecord.posterUrl } : {}) }] : []
  return <>
    {clips.map((clip, index) => {
      const candidates = detail.participants.filter(value => clip.perspective === 'self' ? value.isCurrentUser === true : clip.perspective === 'peer' ? value.isCurrentUser === false : false)
      const participant = detail.participants.find(value => clip.userId !== undefined && value.userId === clip.userId) ?? (candidates.length === 1 ? candidates[0] : undefined)
      const mine = participant?.isCurrentUser ?? clip.perspective === 'self'
      const avatar = <ArkmeUserAvatar size={32} label={`${participant?.displayName ?? clip.label ?? '通话参与者'}的头像`} {...(participant?.avatarRef ? { avatarRef: participant.avatarRef } : {})} />
      return <div key={`${clip.videoUrl}:${index}`} data-arkme-call-video={mine ? 'self' : 'peer'} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: mine ? 'flex-end' : 'flex-start', gap: 8, margin: '4px 0 12px', flex: 'none' }}>
        {!mine && avatar}
        <button type="button" aria-label={`播放${clip.label || '通话录像'}`} onClick={() => { setSelected(clip) }} style={{ width: 78, maxWidth: 'calc(100% - 40px)', flex: 'none', padding: '4px 4px 6px', border: 0, borderRadius: mine ? '16px 5px 16px 16px' : '5px 16px 16px 16px', background: mine ? arkmeTheme.messageOwn : arkmeTheme.messageOther, cursor: 'pointer' }}>
          <span style={{ display: 'block', position: 'relative', aspectRatio: '9 / 16', overflow: 'hidden', borderRadius: 12, background: arkmeTheme.layer1 }}>
            <video src={clip.videoUrl} poster={clip.posterUrl} muted playsInline preload={clip.posterUrl ? 'none' : 'metadata'} aria-hidden style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />
            <span style={{ position: 'absolute', inset: 0, background: 'linear-gradient(rgba(0,0,0,.08),rgba(0,0,0,.38))', display: 'grid', placeItems: 'center' }}>
              <span style={{ display: 'grid', placeItems: 'center', width: 36, height: 36, borderRadius: '50%', border: '1px solid rgba(255,255,255,.18)', background: 'rgba(255,255,255,.18)', color: '#fff' }}><PlayIcon size={22} weight="fill" /></span>
            </span>
          </span>
        </button>
        {mine && avatar}
      </div>
    })}
    {selected && <ArkmeCallVideoPlayer clip={selected} onClose={closePlayer} />}
  </>
}
