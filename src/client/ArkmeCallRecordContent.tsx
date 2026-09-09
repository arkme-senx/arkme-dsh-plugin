import type { CSSProperties } from 'react'
import type { ArkmeTimelineItem } from '../types.js'
import { arkmeTheme } from './arkme-theme.js'

export function arkmeCallRecordBubbleStyle(isMe: boolean): CSSProperties {
  return {
    background: isMe ? arkmeTheme.messageOwn : arkmeTheme.messageOther,
    borderColor: 'transparent',
    borderRadius: isMe ? '12px 4px 12px 12px' : '4px 12px 12px 12px',
    minHeight: 42,
    padding: 10,
    display: 'flex',
    alignItems: 'center',
  }
}

export function ArkmeCallRecordContent({ call }: { call: NonNullable<ArkmeTimelineItem['callRecord']> }) {
  return <div data-arkme-call-record={call.mediaType} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, fontSize: 14, fontWeight: 400, lineHeight: '20px', color: arkmeTheme.secondary }}>
    {call.mediaType === 'video'
      // Original Flutter MaterialIcons videocam_outlined (U+F48C), without substituting a different video icon.
      ? <svg aria-hidden viewBox="0 0 512 512" style={{ width: 18, height: 18, flex: '0 0 18px', color: arkmeTheme.tertiary }}>
        <path fill="currentColor" transform="translate(0 512) scale(1 -1)" d="M320 341V171H107V341H320ZM341 384H85C74 384 64 374 64 363V149C64 138 74 128 85 128H341C353 128 363 138 363 149V224L448 139V373L363 288V363C363 374 353 384 341 384Z" />
      </svg>
      : <span aria-hidden style={{ width: 18, height: 18, flex: '0 0 18px', backgroundColor: arkmeTheme.tertiary, mask: 'url("/arkme-self/api/call/call-linear.svg") center / contain no-repeat', WebkitMask: 'url("/arkme-self/api/call/call-linear.svg") center / contain no-repeat' }} />}
    <span>{call.text}</span>
  </div>
}
