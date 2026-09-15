import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { ArrowClockwise } from '@phosphor-icons/react/dist/icons/ArrowClockwise'
import { Pause } from '@phosphor-icons/react/dist/icons/Pause'
import { Play } from '@phosphor-icons/react/dist/icons/Play'
import type { ArkmeCallDetail, ArkmeCallHistoryItem, ArkmeCallVideoPerspective } from '../types.js'
import { CallAvatar, callVideoPerspectiveLabel, cleanAvatarRef, clockTime, formatDuration, sampleAvatarUrl } from './call-detail-presentation.js'
import { arkmeTheme } from './arkme-theme.js'
import { useCallTranscriptPlayback } from './use-call-transcript-playback.js'

const SAMPLE_VIDEO_PEER_URL = '/arkme-self/api/call/call-demo-peer.png'
const SAMPLE_VIDEO_SELF_URL = '/arkme-self/api/call/call-demo-self.png'
type SamplePerspective = 'primary' | 'secondary'
const styles: Record<string, CSSProperties> = {
  detailBody: { minHeight: 0, flex: 1, overflowY: 'auto', padding: '24px 28px 36px', boxSizing: 'border-box' },
  card: { maxWidth: 720, margin: '0 auto 18px', padding: 16, borderRadius: 14, background: arkmeTheme.layer1, boxSizing: 'border-box' },
  cardTitle: { margin: '0 0 9px', color: arkmeTheme.text, fontSize: 13, lineHeight: '18px', fontWeight: 650 },
  cardText: { margin: 0, color: arkmeTheme.secondary, fontSize: 13, lineHeight: '22px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
  sampleMedia: { maxWidth: 720, margin: '0 auto 18px', display: 'grid', gap: 4 },
  sampleImageFrame: { position: 'relative', overflow: 'hidden', borderRadius: 14, border: `1px solid ${arkmeTheme.border}`, background: '#11141a', aspectRatio: '16 / 9', boxShadow: 'none' },
  sampleImage: { width: '100%', height: '100%', display: 'block', objectFit: 'cover' },
  videoInset: { position: 'absolute', top: 12, right: 12, width: 95, height: 126, overflow: 'hidden', borderRadius: 12, border: '1px solid rgba(255,255,255,.78)', background: '#151923', boxShadow: '0 10px 22px rgba(0,0,0,.22)' },
  videoInsetImage: { width: '100%', height: '100%', display: 'block', objectFit: 'cover' },
  videoPreviewFallback: { width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: '#11161f' },
  videoPreviewFigure: { width: '40%', maxWidth: 156, aspectRatio: '1 / 1', borderRadius: 999, background: '#77869a', opacity: .72 },
  videoPill: { position: 'absolute', zIndex: 2, padding: '5px 8px', borderRadius: 7, background: 'rgba(22,24,30,.66)', color: '#fff', fontSize: 10, lineHeight: '14px', fontWeight: 650 },
  videoPillTop: { top: 12, left: 12 },
  videoPillBottomLeft: { left: 12, bottom: 12 },
  videoPillBottomRight: { right: 12, bottom: 12 },
  videoPlay: { position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: 54, height: 54, display: 'grid', placeItems: 'center', borderRadius: 999, background: 'rgba(255,255,255,.88)', color: '#171923', boxShadow: '0 8px 22px rgba(0,0,0,.18)' },
  videoPlayButton: { border: 0, padding: 0, cursor: 'pointer' },
  realVideo: { width: '100%', height: '100%', display: 'block', objectFit: 'cover', background: '#11141a' },
  videoControls: {
    position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 3, minHeight: 48, padding: '12px 14px 13px',
    display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr) auto', alignItems: 'center', gap: 10,
    color: '#fff', background: 'linear-gradient(to top, rgba(0,0,0,.68), rgba(0,0,0,.08), rgba(0,0,0,0))',
    boxSizing: 'border-box',
  },
  videoControlButton: { width: 28, height: 28, display: 'grid', placeItems: 'center', border: 0, borderRadius: 999, background: 'rgba(255,255,255,.88)', color: '#171923', cursor: 'pointer' },
  videoProgressTrack: { position: 'relative', height: 4, overflow: 'hidden', borderRadius: 999, background: 'rgba(255,255,255,.38)' },
  videoProgressFill: { position: 'absolute', inset: '0 auto 0 0', borderRadius: 999, background: '#fff' },
  videoTimeText: { color: 'rgba(255,255,255,.92)', fontSize: 11, fontVariantNumeric: 'tabular-nums' },
  videoUnavailable: { minHeight: 220, display: 'grid', placeItems: 'center', color: arkmeTheme.tertiary, fontSize: 13, lineHeight: '20px', background: arkmeTheme.layer1 },
  videoTitleRow: { width: '100%', maxWidth: 720, justifySelf: 'stretch', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, boxSizing: 'border-box' },
  videoTitleText: { minWidth: 0, flex: '1 1 auto', display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 },
  videoTitle: { margin: 0, color: arkmeTheme.text, fontSize: 14, lineHeight: '20px', fontWeight: 650 },
  videoCaption: { color: arkmeTheme.tertiary, fontSize: 11, lineHeight: '16px' },
  sampleSwitch: {
    height: 32, padding: '0 11px', display: 'inline-flex', alignItems: 'center', gap: 6, border: 0, borderRadius: 9,
    background: arkmeTheme.elevated, color: arkmeTheme.text, cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 600,
  },
  transcript: { maxWidth: 720, margin: '0 auto', display: 'grid', gap: 12 },
  transcriptHeader: { display: 'flex', alignItems: 'baseline', justifyContent: 'flex-start', gap: 8, paddingBottom: 10, borderBottom: `1px solid ${arkmeTheme.borderSoft}` },
  transcriptTitle: { margin: 0, color: arkmeTheme.text, fontSize: 14, lineHeight: '20px', fontWeight: 650 },
  transcriptCount: { color: arkmeTheme.tertiary, fontSize: 11, lineHeight: '16px' },
  transcriptEmpty: { margin: '10px 0 0', color: arkmeTheme.tertiary, fontSize: 13, lineHeight: '21px' },
  segment: { display: 'flex', gap: 9, alignItems: 'flex-start' },
  segmentMine: { justifyContent: 'flex-end' },
  segmentStack: { maxWidth: '76%', minWidth: 0, display: 'grid', gap: 5, justifyItems: 'start' },
  segmentStackMine: { justifyItems: 'end' },
  segmentBubble: { maxWidth: '76%', padding: '9px 11px', borderRadius: '5px 14px 14px 14px', background: arkmeTheme.messageOther, color: arkmeTheme.text },
  segmentBubbleMine: { borderRadius: '14px 5px 14px 14px', background: arkmeTheme.messageOwn },
  segmentBubbleInStack: { maxWidth: '100%' },
  segmentMeta: { display: 'block', color: arkmeTheme.tertiary, fontSize: 10, lineHeight: '14px' },
  segmentText: { margin: 0, fontSize: 13, lineHeight: '21px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
  endEvent: { maxWidth: 360, margin: '6px auto 0', display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 8, color: arkmeTheme.tertiary, fontSize: 10 },
  endLine: { height: 1, background: arkmeTheme.borderSoft },
}

export interface ArkmeCallDetailContentProps {
  selectedItem: Pick<ArkmeCallHistoryItem, 'callRef' | 'peerDisplayName' | 'mediaType' | 'durationSeconds' | 'acceptedAtMillis' | 'summaryPreview'>
  detail?: ArkmeCallDetail | undefined
  detailState: 'idle' | 'loading' | 'ready' | 'error'
  detailError?: string | undefined
  avatarRefForName?: ((name: string) => string | undefined) | undefined
  compact?: boolean
  initialVideoUrl?: string | undefined
  tourSample?: boolean
}

/** The selected-call pane, shared by the call browser and conversation drawer. */
export function ArkmeCallDetailContent({ selectedItem, detail, detailState, detailError, avatarRefForName = () => undefined, compact = false, initialVideoUrl, tourSample = false }: ArkmeCallDetailContentProps) {
  const selectedIsSample = selectedItem.callRef.startsWith('sample-')
  const [samplePerspective, setSamplePerspective] = useState<SamplePerspective>('primary')
  const [playingVideoKey, setPlayingVideoKey] = useState('')
  const [videoPlaying, setVideoPlaying] = useState(false)
  const [videoCurrentTime, setVideoCurrentTime] = useState(0)
  const [videoDuration, setVideoDuration] = useState(0)
  const [failedVideoPreviewKeys, setFailedVideoPreviewKeys] = useState<readonly string[]>([])
  const videoRefs = useRef(new Map<string, HTMLVideoElement>())
  const standaloneVideo = useRef<HTMLVideoElement>(null)
  const transcriptPlayback = useCallTranscriptPlayback(selectedItem.callRef, () => {
    setVideoPlaying(false)
    for (const video of videoRefs.current.values()) video.pause()
    standaloneVideo.current?.pause()
  })
  const setVideoRef = useCallback((key: string, element: HTMLVideoElement | null) => {
    if (element === null) {
      videoRefs.current.delete(key)
      return
    }
    videoRefs.current.set(key, element)
  }, [])
  const syncVideoElements = useCallback((time?: number) => {
    const videos = [...videoRefs.current.values()]
    if (videos.length === 0) return
    const targetTime = time ?? videos[0]?.currentTime ?? 0
    for (const video of videos) {
      if (Number.isFinite(targetTime) && Math.abs(video.currentTime - targetTime) > 0.35) {
        try { video.currentTime = targetTime } catch {}
      }
      if (videoPlaying) {
        void video.play().catch(() => undefined)
      } else {
        video.pause()
      }
    }
  }, [videoPlaying])
  useEffect(() => {
    syncVideoElements(videoCurrentTime)
  }, [playingVideoKey, samplePerspective, syncVideoElements, videoCurrentTime])
  const videoPerspectiveLabel = (perspective: ArkmeCallVideoPerspective | undefined, fallback: string): string => {
    return callVideoPerspectiveLabel(perspective, detail?.participants ?? [], selectedItem.peerDisplayName, fallback)
  }
  const videoPerspectiveKey = (perspective: ArkmeCallVideoPerspective): string => {
    return `${perspective.perspective}:${perspective.videoUrl ?? ''}:${perspective.posterUrl ?? ''}`
  }
  const markVideoPreviewFailed = useCallback((key: string) => {
    setFailedVideoPreviewKeys(current => current.includes(key) ? current : [...current, key])
  }, [])
  const startVideoPlayback = (perspective: ArkmeCallVideoPerspective) => {
    transcriptPlayback.stop()
    setPlayingVideoKey(videoPerspectiveKey(perspective))
    setVideoPlaying(true)
  }
  const toggleVideoPlayback = () => {
    transcriptPlayback.stop()
    setVideoPlaying(value => !value)
  }
  const renderVideoPreviewFallback = (label: string, inset = false) => {
    return <span
      aria-label={`${label}缩略图暂不可用`}
      style={styles.videoPreviewFallback}
    >
      <span style={{ ...styles.videoPreviewFigure, width: inset ? '48%' : '32%' }} />
    </span>
  }
  const renderPerspectiveMedia = (
    perspective: ArkmeCallVideoPerspective,
    options: { inset?: boolean; alt: string; active?: boolean },
  ) => {
    const style = options.inset === true ? styles.videoInsetImage : styles.realVideo
    const key = videoPerspectiveKey(perspective)
    const previewFailed = failedVideoPreviewKeys.includes(key)
    const shouldRenderVideo = options.active === true && perspective.videoUrl !== undefined
    const shouldShowPoster = perspective.posterUrl !== undefined
      && !previewFailed
      && !shouldRenderVideo
    if (shouldShowPoster) return <img
      src={perspective.posterUrl}
      alt={options.alt}
      draggable={false}
      onError={() => { markVideoPreviewFailed(key) }}
      style={options.inset === true ? styles.videoInsetImage : styles.sampleImage}
    />
    if (!shouldRenderVideo && perspective.videoUrl !== undefined) return <video
      key={`${perspective.videoUrl}:${options.inset === true ? 'preview-inset' : 'preview-main'}`}
      src={perspective.videoUrl}
      muted
      preload="metadata"
      playsInline
      aria-label={options.alt}
      style={style}
    />
    if (perspective.videoUrl !== undefined) return <video
      key={`${perspective.videoUrl}:${options.inset === true ? 'inset' : 'main'}`}
      ref={element => { setVideoRef(key, element) }}
      src={perspective.videoUrl}
      {...(perspective.posterUrl === undefined ? {} : { poster: perspective.posterUrl })}
      controls={false}
      onPlay={transcriptPlayback.stop}
      muted={options.inset === true}
      autoPlay={options.active === true && videoPlaying}
      preload="metadata"
      playsInline
      onLoadedMetadata={event => {
        if (options.inset === true) return
        const duration = event.currentTarget.duration
        if (Number.isFinite(duration) && duration > 0) setVideoDuration(duration)
      }}
      onTimeUpdate={event => {
        if (options.inset === true) return
        const current = event.currentTarget.currentTime
        const duration = event.currentTarget.duration
        setVideoCurrentTime(Number.isFinite(current) ? current : 0)
        if (Number.isFinite(duration) && duration > 0) setVideoDuration(duration)
        syncVideoElements(current)
      }}
      onEnded={() => { setVideoPlaying(false) }}
      style={style}
    />
    if (perspective.posterUrl !== undefined) return <img
      src={perspective.posterUrl}
      alt={options.alt}
      draggable={false}
      onError={() => { markVideoPreviewFailed(key) }}
      style={options.inset === true ? styles.videoInsetImage : styles.sampleImage}
    />
    return renderVideoPreviewFallback(videoPerspectiveLabel(perspective, '视频'), options.inset === true)
  }
  const appliedVideoUrl = useRef<string>()
  const videoSection = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!initialVideoUrl || !detail || appliedVideoUrl.current === initialVideoUrl) return
    const index = detail.videoRecord?.perspectives?.filter(item => item.videoUrl || item.posterUrl).findIndex(item => item.videoUrl === initialVideoUrl || item.posterUrl === initialVideoUrl) ?? -1
    if (index < 0 && detail.videoRecord?.videoUrl !== initialVideoUrl && detail.videoRecord?.posterUrl !== initialVideoUrl) return
    appliedVideoUrl.current = initialVideoUrl
    setPlayingVideoKey('')
    setVideoPlaying(false)
    setVideoCurrentTime(0)
    setVideoDuration(0)
    setSamplePerspective(index === 1 ? 'secondary' : 'primary')
    videoSection.current?.scrollIntoView?.({ block: 'nearest' })
  }, [detail, initialVideoUrl])
  const renderVideoRecord = () => {
    if (selectedItem === undefined || selectedItem.mediaType !== 'video') return null
    const titleCaption = selectedIsSample ? '功能示例 · 完整保留双方画面' : '完整保留双方画面'
    const videoRecord = detail?.videoRecord
    const realPerspectives = videoRecord?.perspectives?.filter(item => item.videoUrl !== undefined || item.posterUrl !== undefined) ?? []
    const realMain = samplePerspective === 'primary'
      ? realPerspectives[0]
      : realPerspectives[1] ?? realPerspectives[0]
    const realInset = samplePerspective === 'primary'
      ? realPerspectives[1]
      : realPerspectives[0]
    const canSwitchRealPerspective = realPerspectives.length > 1
    const sampleMain = samplePerspective === 'primary' ? SAMPLE_VIDEO_PEER_URL : SAMPLE_VIDEO_SELF_URL
    const sampleInset = samplePerspective === 'primary' ? SAMPLE_VIDEO_SELF_URL : SAMPLE_VIDEO_PEER_URL
    const sampleMainLabel = samplePerspective === 'primary' ? '我的视角' : selectedItem.peerDisplayName
    const sampleInsetLabel = samplePerspective === 'primary' ? selectedItem.peerDisplayName : '我的视角'
    const realPlaybackActive = realMain !== undefined && playingVideoKey === videoPerspectiveKey(realMain)
    const progress = videoDuration > 0 ? Math.min(1, Math.max(0, videoCurrentTime / videoDuration)) : 0
    const realMainPillBottom = realPlaybackActive ? 50 : 12
    const hasRenderableVideo = selectedIsSample || realPerspectives.length > 0 || videoRecord?.videoUrl !== undefined || videoRecord?.posterUrl !== undefined
    const accepted = detail?.acceptedAtMillis ?? selectedItem.acceptedAtMillis
    if (!selectedIsSample && detailState !== 'ready') return null
    if (!hasRenderableVideo && accepted <= 0) return null
    return <section ref={videoSection} style={styles.sampleMedia} aria-label="视频记录" data-arkme-call-tour-target={tourSample ? 'video' : undefined}>
      <header style={styles.videoTitleRow} data-arkme-call-video-title-row="aligned">
        <span style={styles.videoTitleText}>
          <h3 style={styles.videoTitle}>视频记录</h3>
          <span style={styles.videoCaption}>{titleCaption}</span>
        </span>
        {(selectedIsSample || canSwitchRealPerspective) && <button
          type="button"
          style={styles.sampleSwitch}
          data-arkme-call-video-title-action="switch-perspective"
          onClick={() => {
            setPlayingVideoKey('')
            setVideoPlaying(false)
            setVideoCurrentTime(0)
            setSamplePerspective(value => value === 'primary' ? 'secondary' : 'primary')
          }}
        ><ArrowClockwise size={13} />切换视角</button>}
      </header>
      <div style={styles.sampleImageFrame}>
        {selectedIsSample ? <>
          <img
            src={sampleMain}
            alt={`${selectedItem.peerDisplayName}示例主画面`}
            draggable={false}
            style={styles.sampleImage}
          />
          <span style={{ ...styles.videoPill, ...styles.videoPillTop }}>示例画面</span>
          <span style={{ ...styles.videoPill, ...styles.videoPillBottomLeft }}>{sampleMainLabel}</span>
          <span style={{ ...styles.videoPill, ...styles.videoPillBottomRight }}>{formatDuration(selectedItem.durationSeconds)}</span>
          <span style={styles.videoInset}>
            <img
              src={sampleInset}
              alt={`${sampleInsetLabel}示例小窗`}
              draggable={false}
              style={styles.videoInsetImage}
            />
            <span style={{ ...styles.videoPill, right: 7, bottom: 7, padding: '4px 6px', fontSize: 9 }}>{sampleInsetLabel}</span>
          </span>
          <span style={styles.videoPlay} aria-hidden="true"><Play size={25} weight="fill" /></span>
        </> : realMain !== undefined ? <>
          {renderPerspectiveMedia(realMain, { alt: `${videoPerspectiveLabel(realMain, '主视角')}视频通话记录画面`, active: realPlaybackActive })}
          {realMain.videoUrl !== undefined && !realPlaybackActive && <button
            type="button"
            style={{ ...styles.videoPlay, ...styles.videoPlayButton }}
            aria-label="播放视频记录"
            onClick={() => { startVideoPlayback(realMain) }}
          ><Play size={25} weight="fill" /></button>}
          <span style={{ ...styles.videoPill, ...styles.videoPillBottomLeft, bottom: realMainPillBottom }}>{videoPerspectiveLabel(realMain, '主视角')}</span>
          {!realPlaybackActive && <span style={{ ...styles.videoPill, ...styles.videoPillBottomRight }}>{formatDuration(selectedItem.durationSeconds)}</span>}
          {realInset !== undefined && <span style={styles.videoInset}>
            {renderPerspectiveMedia(realInset, { inset: true, alt: `${videoPerspectiveLabel(realInset, '对方视角')}视频通话记录小窗`, active: realPlaybackActive })}
            <span style={{ ...styles.videoPill, right: 7, bottom: 7, padding: '4px 6px', fontSize: 9 }}>{videoPerspectiveLabel(realInset, '对方视角')}</span>
          </span>}
          {realPlaybackActive && <div style={styles.videoControls} aria-label="视频播放控制" data-arkme-call-video-controls="overlay">
            <button type="button" style={styles.videoControlButton} aria-label={videoPlaying ? '暂停视频记录' : '继续播放视频记录'} onClick={toggleVideoPlayback}>
              {videoPlaying ? <Pause size={15} weight="fill" /> : <Play size={15} weight="fill" />}
            </button>
            <div style={styles.videoProgressTrack} aria-hidden="true">
              <span style={{ ...styles.videoProgressFill, width: `${String(progress * 100)}%` }} />
            </div>
            <span style={styles.videoTimeText}>{formatDuration(videoCurrentTime)} / {formatDuration(videoDuration || selectedItem.durationSeconds)}</span>
          </div>}
        </> : videoRecord?.videoUrl !== undefined ? <video
          ref={standaloneVideo}
          onPlay={transcriptPlayback.stop}
          src={videoRecord.videoUrl}
          {...(videoRecord.posterUrl === undefined ? {} : { poster: videoRecord.posterUrl })}
          controls
          preload="metadata"
          playsInline
          style={styles.realVideo}
        /> : videoRecord?.posterUrl !== undefined ? <img
          src={videoRecord.posterUrl}
          alt={`${selectedItem.peerDisplayName}视频通话记录画面`}
          draggable={false}
          style={styles.sampleImage}
        /> : <div style={styles.videoUnavailable}>视频记录暂不可用</div>}
      </div>
    </section>
  }

  return <div data-arkme-call-detail-content="true" style={{ ...styles.detailBody, ...(compact ? { padding: '8px 16px 24px' } : {}) }}>
          <section style={styles.card} data-arkme-call-tour-target={tourSample ? 'summary' : undefined}>
            <h3 style={styles.cardTitle}>AI 摘要</h3>
            <p style={styles.cardText}>
              {detailState === 'loading' ? '正在读取通话详情...'
                : detailState === 'error' ? detailError || '通话详情暂时不可用'
                  : detail?.summaryText ?? selectedItem.summaryPreview ?? (detail?.summaryStatus === 'pending' ? '摘要生成中…' : detail?.summaryStatus === 'failed' ? '摘要生成失败' : '这次通话还没有摘要。')}
            </p>
          </section>
          {renderVideoRecord()}
          {detail?.transcriptSegments !== undefined && detail.transcriptSegments.length > 0 && <section style={styles.transcript}>
            <header style={styles.transcriptHeader} data-arkme-call-transcript-header="aligned">
              <h3 style={styles.transcriptTitle}>通话转写</h3>
              <span style={styles.transcriptCount}>{detail.transcriptSegments.length} 段对话</span>
            </header>
            {detail.transcriptSegments.map(segment => {
              const mine = segment.speakerUserId !== undefined && detail.participants.some(participant => participant.isCurrentUser && participant.userId === segment.speakerUserId)
              const speaker = detail.participants.find(participant => segment.speakerUserId !== undefined && participant.userId === segment.speakerUserId)
                ?? detail.participants.find(participant => participant.displayName.trim() === segment.speakerDisplayName.trim())
              const speakerAvatarRef = cleanAvatarRef(speaker?.avatarRef) ?? avatarRefForName(segment.speakerDisplayName)
              const segmentTime = clockTime(detail.startedAtMillis + segment.startMillis)
              const playback = transcriptPlayback.state?.segmentId === segment.segmentId ? transcriptPlayback.state.status : undefined
              const highlighted = playback === 'loading' || playback === 'playing'
              const bubbleStyle = { ...styles.segmentBubble, ...styles.segmentBubbleInStack, ...(mine ? styles.segmentBubbleMine : {}) }
              return <article key={segment.segmentId} style={{ ...styles.segment, ...(mine ? styles.segmentMine : {}) }}>
                {!mine && <CallAvatar
                  name={segment.speakerDisplayName}
                  avatarRef={selectedIsSample ? undefined : speakerAvatarRef}
                  assetUrl={selectedIsSample ? sampleAvatarUrl(segment.speakerDisplayName) : undefined}
                  size={30}
                />}
                <span style={{ ...styles.segmentStack, ...(mine ? styles.segmentStackMine : {}) }}>
                  <small style={styles.segmentMeta}>{segment.speakerDisplayName}{segmentTime === '' ? '' : ` · ${segmentTime}`}</small>
                  {segment.audioUrl ? <button type="button"
                    data-arkme-call-tour-target={tourSample && segment.segmentId === 'sample-video-1' ? 'utterance' : undefined}
                    aria-label={`${highlighted ? '停止' : playback === 'failed' ? '重试播放' : '播放'}${segment.speakerDisplayName}的录音片段：${segment.text}`}
                    aria-pressed={highlighted}
                    aria-busy={playback === 'loading'}
                    onClick={() => { transcriptPlayback.toggle(segment) }}
                    style={{ ...bubbleStyle, border: 0, font: 'inherit', textAlign: 'left', cursor: 'pointer', ...(highlighted ? { boxShadow: `inset 0 0 0 1px ${arkmeTheme.accent}`, background: arkmeTheme.accentSoft } : {}) }}>
                    <span style={{ ...styles.segmentText, display: 'block' }}>{segment.text}</span>
                    {playback && <span role="status" style={{ display: 'block', marginTop: 4, fontSize: 11, color: playback === 'failed' ? arkmeTheme.danger : arkmeTheme.secondary }}>{playback === 'loading' ? '正在加载… 点击停止' : playback === 'playing' ? '■ 正在播放' : '播放失败，点击重试'}</span>}
                  </button> : <span style={bubbleStyle}>
                    <p style={styles.segmentText}>{segment.text}</p>
                  </span>}
                </span>
                {mine && <CallAvatar
                  name={segment.speakerDisplayName}
                  avatarRef={selectedIsSample ? undefined : speakerAvatarRef}
                  assetUrl={selectedIsSample ? sampleAvatarUrl(segment.speakerDisplayName) : undefined}
                  size={30}
                />}
              </article>
            })}
            <div style={styles.endEvent}>
              <i style={styles.endLine} />
              <span>{detail.hangupParticipant ? `${detail.hangupParticipant.displayName}已挂断通话` : '通话已结束'}</span>
              <i style={styles.endLine} />
            </div>
          </section>}
          {detailState === 'ready' && detail !== undefined && detail.transcriptSegments.length === 0 && <section style={styles.transcript} aria-label="通话转写">
            <header style={styles.transcriptHeader} data-arkme-call-transcript-header="aligned">
              <h3 style={styles.transcriptTitle}>通话转写</h3>
              <span style={styles.transcriptCount}>0 段对话</span>
            </header>
            <p role="status" style={styles.transcriptEmpty}>{detail.transcriptFailed ? '转写失败' : detail.transcriptPending ? '转写处理中' : '暂无转写内容'}</p>
          </section>}
        </div>
}
