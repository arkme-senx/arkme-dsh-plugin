import { useState, type CSSProperties } from 'react'
import { PlayIcon } from '@phosphor-icons/react/dist/csr/Play'
import type { ArkmeCallVideoPerspective, ArkmeTimelineItem } from '../types.js'
import { arkmeTheme } from './arkme-theme.js'
import { useCallRecordPreview } from './use-call-record-preview.js'

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

function CallPreviewImage({ clip, label }: { clip: ArkmeCallVideoPerspective; label: string }) {
  const [posterFailed, setPosterFailed] = useState(false)
  const [videoFailed, setVideoFailed] = useState(false)
  const style: CSSProperties = { width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }
  return <>
    {clip.posterUrl && !posterFailed ? <img src={clip.posterUrl} alt={label} loading="lazy" style={style} onError={() => { setPosterFailed(true) }} />
      : clip.videoUrl && !videoFailed ? <video src={clip.videoUrl} muted playsInline preload="metadata" aria-label={label} style={style} onError={() => { setVideoFailed(true) }} />
        : <span style={{ display: 'grid', placeItems: 'center', height: '100%', fontSize: 11 }}>预览暂不可用</span>}
    <span aria-hidden style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fff', background: 'linear-gradient(transparent,rgba(0,0,0,.3))' }}><PlayIcon size={24} weight="fill" /></span>
  </>
}

export function ArkmeCallRecordContent({ call, revision, onOpenDetail }: { call: NonNullable<ArkmeTimelineItem['callRecord']>; revision?: number | string | undefined; onOpenDetail?: ((videoUrl?: string) => void) | undefined }) {
  const { element, detail, failed } = useCallRecordPreview(call.callRef, revision)
  const summary = detail?.summaryText?.trim() || call.summaryText?.trim()
  const status = detail?.summaryStatus ?? call.summaryStatus
  const video = call.mediaType === 'video' && detail?.videoRecord?.available ? detail.videoRecord : undefined
  const perspectives = video?.perspectives?.filter(clip => clip.videoUrl || clip.posterUrl) ?? []
  const clips: ArkmeCallVideoPerspective[] = perspectives.length ? perspectives : video?.videoUrl || video?.posterUrl ? [{ perspective: 'main', ...(video.videoUrl ? { videoUrl: video.videoUrl } : {}), ...(video.posterUrl ? { posterUrl: video.posterUrl } : {}) }] : []
  return <div ref={element} data-arkme-call-record={call.mediaType} style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, maxWidth: 300, textAlign: 'left', color: arkmeTheme.secondary }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, fontSize: 14, fontWeight: 400, lineHeight: '20px' }}>
    {call.mediaType === 'video'
      // Original Flutter MaterialIcons videocam_outlined (U+F48C), without substituting a different video icon.
      ? <svg aria-hidden viewBox="0 0 512 512" style={{ width: 18, height: 18, flex: '0 0 18px', color: arkmeTheme.tertiary }}>
        <path fill="currentColor" transform="translate(0 512) scale(1 -1)" d="M320 341V171H107V341H320ZM341 384H85C74 384 64 374 64 363V149C64 138 74 128 85 128H341C353 128 363 138 363 149V224L448 139V373L363 288V363C363 374 353 384 341 384Z" />
      </svg>
      : <svg aria-hidden viewBox="0 0 24 24" fill="none" style={{ width: 18, height: 18, flex: '0 0 18px', color: arkmeTheme.tertiary }}>
        <path stroke="currentColor" strokeWidth={1.5} strokeMiterlimit={10} d="M21.97 18.33C21.97 18.69 21.89 19.06 21.72 19.42C21.55 19.78 21.33 20.12 21.04 20.44C20.55 20.98 20.01 21.37 19.4 21.62C18.8 21.87 18.15 22 17.45 22C16.43 22 15.34 21.76 14.19 21.27C13.04 20.78 11.89 20.12 10.75 19.29C9.6 18.45 8.51 17.52 7.47 16.49C6.44 15.45 5.51 14.36 4.68 13.22C3.86 12.08 3.2 10.94 2.72 9.81C2.24 8.67 2 7.58 2 6.54C2 5.86 2.12 5.21 2.36 4.61C2.6 4 2.98 3.44 3.51 2.94C4.15 2.31 4.85 2 5.59 2C5.87 2 6.15 2.06 6.4 2.18C6.66 2.3 6.89 2.48 7.07 2.74L9.39 6.01C9.57 6.26 9.7 6.49 9.79 6.71C9.88 6.92 9.93 7.13 9.93 7.32C9.93 7.56 9.86 7.8 9.72 8.03C9.59 8.26 9.4 8.5 9.16 8.74L8.4 9.53C8.29 9.64 8.24 9.77 8.24 9.93C8.24 10.01 8.25 10.08 8.27 10.16C8.3 10.24 8.33 10.3 8.35 10.36C8.53 10.69 8.84 11.12 9.28 11.64C9.73 12.16 10.21 12.69 10.73 13.22C11.27 13.75 11.79 14.24 12.32 14.69C12.84 15.13 13.27 15.43 13.61 15.61C13.66 15.63 13.72 15.66 13.79 15.69C13.87 15.72 13.95 15.73 14.04 15.73C14.21 15.73 14.34 15.67 14.45 15.56L15.21 14.81C15.46 14.56 15.7 14.37 15.93 14.25C16.16 14.11 16.39 14.04 16.64 14.04C16.83 14.04 17.03 14.08 17.25 14.17C17.47 14.26 17.7 14.39 17.95 14.56L21.26 16.91C21.52 17.09 21.7 17.3 21.81 17.55C21.91 17.8 21.97 18.05 21.97 18.33Z" />
      </svg>}
    <span>{call.text}</span>
    </div>
    {summary && <p data-arkme-call-summary="preview" style={{ margin: 0, fontSize: 12, lineHeight: '18px', color: arkmeTheme.tertiary, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>AI 摘要：{summary}</p>}
    {status === 'pending' && <span role="status" style={{ fontSize: 12, color: arkmeTheme.tertiary }}>摘要生成中…</span>}
    {status === 'failed' && <span style={{ fontSize: 12, color: arkmeTheme.tertiary }}>摘要生成失败，查看详情</span>}
    {failed && !summary && <span style={{ fontSize: 12, color: arkmeTheme.tertiary }}>预览加载失败，查看详情</span>}
    {clips.length > 0 && <div aria-label="通话视频预览" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {clips.map((clip, index) => {
        const label = clip.label || (clip.perspective === 'self' ? '我的视角' : clip.perspective === 'peer' ? '对方视角' : '通话视频')
        const preview = <span style={{ display: 'block', position: 'relative', width: '100%', aspectRatio: '9 / 16', borderRadius: 8, overflow: 'hidden', background: arkmeTheme.layer1 }}><CallPreviewImage clip={clip} label={label} /></span>
        return <span key={`${clip.videoUrl}:${clip.posterUrl}:${index}`} style={{ display: 'grid', gap: 4, width: 88, maxWidth: '100%', fontSize: 11 }}>
          {onOpenDetail ? <button type="button" aria-label={`查看${label}通话详情`} onClick={event => { event.stopPropagation(); onOpenDetail(clip.videoUrl ?? clip.posterUrl) }} style={{ width: '100%', border: 0, padding: 0, background: 'transparent', color: 'inherit', cursor: 'pointer' }}>{preview}</button> : preview}
          <span>{label}</span>
        </span>
      })}
    </div>}
  </div>
}
