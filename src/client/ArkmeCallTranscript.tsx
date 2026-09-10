import type { ArkmeCallDetail } from '../types.js'
import { PhoneDisconnectIcon } from '@phosphor-icons/react/dist/csr/PhoneDisconnect'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { arkmeTheme } from './arkme-theme.js'

export function callTranscriptClock(startMillis: number, startedAtMillis: number, spokenAtMillis?: number): string {
  const time = spokenAtMillis ?? (startedAtMillis > 0 ? startedAtMillis + startMillis : 0)
  if (!Number.isFinite(time) || time <= 0) return '--:--:--'
  return new Date(time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

export function ArkmeCallTranscript({ detail }: { detail: ArkmeCallDetail }) {
  return <div aria-label="通话转写" style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingTop: 18 }}>
    {detail.transcriptSegments.map(segment => {
      const speaker = detail.participants.find(participant => segment.speakerUserId !== undefined && participant.userId === segment.speakerUserId)
      const mine = speaker?.isCurrentUser === true
      const name = speaker?.displayName || segment.speakerDisplayName
      const avatar = <ArkmeUserAvatar size={32} label={`${name}的头像`} {...(speaker?.avatarRef ? { avatarRef: speaker.avatarRef } : {})} />
      return <article key={segment.segmentId} aria-label={name} data-arkme-call-speaker={mine ? 'self' : 'peer'} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, justifyContent: mine ? 'flex-end' : 'flex-start' }}>
        {!mine && avatar}
        <div style={{ minWidth: 0, maxWidth: 'calc(100% - 48px)', display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '4px 12px', padding: '8px 10px', borderRadius: mine ? '14px 5px 14px 14px' : '5px 14px 14px 14px', background: mine ? arkmeTheme.messageOwn : arkmeTheme.messageOther, color: arkmeTheme.text }}>
          <p style={{ margin: 0, minWidth: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 13, lineHeight: '21px' }}>{segment.text}</p>
          <time style={{ marginLeft: 'auto', flex: 'none', color: arkmeTheme.tertiary, fontSize: 10, lineHeight: '18px', fontVariantNumeric: 'tabular-nums' }}>{callTranscriptClock(segment.startMillis, detail.startedAtMillis, segment.spokenAtMillis)}</time>
        </div>
        {mine && avatar}
      </article>
    })}
    {detail.hangupParticipant && <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, color: arkmeTheme.tertiary, fontSize: 12, marginTop: 4 }}>
      <span aria-hidden style={{ flex: 1, borderTop: `1px solid ${arkmeTheme.borderSoft}` }} />
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><PhoneDisconnectIcon size={14} aria-hidden />{detail.hangupParticipant.displayName}已挂断通话</span>
      <span aria-hidden style={{ flex: 1, borderTop: `1px solid ${arkmeTheme.borderSoft}` }} />
    </div>}
  </div>
}
