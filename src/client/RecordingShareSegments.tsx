import type { CSSProperties, ReactNode } from 'react'
import type { ArkmeForwardTranscriptSegment } from '../types.js'
import type { RecordingShareAudio } from '../recording-favorite-contract.js'
import { arkmeTheme as theme } from './arkme-theme.js'
import { tr } from './locale.js'
import { recordingSpeakerColor } from './recordings/recording-speaker-presentation.js'
import { useRecordingSharePlayback } from './recordings/useRecordingSharePlayback.js'
import { arkmeVoiceDuration } from './ArkmeVoiceContent.js'
import { formatArkmeTime, formatArkmeDate } from './display-time-zone.js'

const button: CSSProperties = { border: 0, background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer' }
const time = (millis: number) => formatArkmeTime(millis, undefined, { hourCycle: 'h23' })
export function RecordingShareSegments({ segments, audioUrl, media, mediaPath = '/arkme-self/api/media', detail = false, actions }: {
  segments: readonly (ArkmeForwardTranscriptSegment & { occurredAtMillis?: number; speakerAvatarRef?: string })[]
  audioUrl?: string | undefined; media?: RecordingShareAudio | undefined; mediaPath?: string; detail?: boolean; actions?: ReactNode
}) {
  const playback = useRecordingSharePlayback(segments, media, mediaPath, audioUrl)
  const playing = playback.status === 'playing' || playback.status === 'loading'
  return <section className={detail ? 'arkme-favorite-transcripts' : undefined} aria-label={tr('已分享的录音片段')} style={{ minWidth: 0 }}>
    {detail && <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 0', color: theme.secondary, fontSize: 13 }}>
      <span>{segments.length} {tr('个片段')} · {arkmeVoiceDuration(playback.total)}</span>
      <span className="arkme-favorite-toolbar">{actions}<button type="button" style={{ ...button, border: `1px solid ${theme.border}`, padding: '7px 12px', borderRadius: 8 }} disabled={!playback.playable} onClick={playback.toggleAll}>{playing ? 'Ⅱ' : '▶'} {tr(playing ? '暂停' : '播放全部')}</button></span>
    </div>}
    {detail && segments[0]?.occurredAtMillis && <div className="arkme-favorite-day">{formatArkmeDate(segments[0].occurredAtMillis)}</div>}
    {!playback.playable && <p style={{ margin: '4px 10px', fontSize: 12, color: theme.secondary }}>{tr('音频暂不可用')}</p>}
    {segments.map((segment, index) => {
      const selected = playback.index === index, active = selected && playing
      const label = detail && segment.occurredAtMillis ? time(segment.occurredAtMillis) : [Math.floor(segment.startMillis / 3600000), Math.floor(segment.startMillis / 60000) % 60, Math.floor(segment.startMillis / 1000) % 60].map(value => String(value).padStart(2, '0')).join(':')
      return <div key={index} data-arkme-shared-recording-segment style={{ borderTop: !detail && index ? `1px solid ${theme.borderSoft}` : undefined }}>
        <button type="button" disabled={!playback.playable} aria-busy={selected && playback.status === 'loading' || undefined}
          aria-label={`${tr(active ? '暂停' : '播放')} · ${segment.speakerName} · ${label}`}
          style={{ ...button, display: detail ? 'grid' : 'block', gridTemplateColumns: '104px minmax(0, 1fr) 22px', gap: 18, width: '100%', padding: detail ? '10px 0' : '8px 10px', textAlign: 'left', borderRadius: 6, background: selected ? theme.hover : 'transparent' }}
          onClick={() => playback.toggle(index)}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, flexWrap: detail ? 'wrap' : undefined }}>
            {!detail && <span aria-hidden style={{ width: 14 }}>{selected && playback.status === 'loading' ? '…' : active ? 'Ⅱ' : '▶'}</span>}
            <span aria-hidden style={{ width: 11, height: 11, marginTop: 0, flex: 'none', borderRadius: '50%', background: recordingSpeakerColor(segment.speakerNumber ?? index) }} />
            <span style={{ flex: 1, overflowWrap: 'anywhere' }}>{segment.speakerName}</span>
            {!detail && <time style={{ color: theme.secondary, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{label}</time>}
          </span>
          <span style={{ display: 'block', marginTop: detail ? 0 : 5, justifySelf: 'start', padding: detail ? '7px 10px' : undefined, borderRadius: detail ? 10 : undefined, background: detail ? theme.messageOther : undefined, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 14, lineHeight: 1.65 }}>{segment.textContent}{detail && <time style={{ marginLeft: 14, whiteSpace: 'nowrap', fontSize: 12, color: theme.tertiary }}>{label}</time>}</span>
          {detail && <span aria-hidden style={{ color: theme.tertiary }}>{selected && playback.status === 'loading' ? '…' : active ? 'Ⅱ' : '▷'}</span>}
        </button>
      </div>
    })}
    {playback.status === 'error' && <div role="alert" style={{ padding: 10, color: theme.secondary, fontSize: 12 }}>{tr('音频播放失败，请点击片段重试')}</div>}
    {detail && <footer className="arkme-favorite-player" style={{ position: 'sticky', bottom: 0, background: theme.base, padding: '18px 0', borderTop: `1px solid ${theme.border}`, display: 'flex', alignItems: 'center', gap: 14 }}>
      <button type="button" aria-label={tr(playing ? '暂停' : '播放全部')} disabled={!playback.playable} onClick={playback.toggleAll} style={{ ...button, width: 42, height: 42, flexShrink: 0, borderRadius: '50%', background: theme.primaryAction, color: theme.onPrimaryAction }}>{playing ? 'Ⅱ' : '▶'}</button>
      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13 }}>{segments.length} {tr('个片段 · 按分享顺序播放')}</div>
        <input aria-label={tr('播放进度')} type="range" min={0} max={playback.total} step={.1} value={playback.elapsed} disabled={!playback.playable} onChange={event => playback.seek(Number(event.currentTarget.value))} style={{ width: '100%', accentColor: theme.text }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: theme.secondary }}><span>{arkmeVoiceDuration(playback.elapsed, true)}</span><span>{arkmeVoiceDuration(playback.total)}</span></div>
      </div><button type="button" aria-label={tr('播放速度')} onClick={playback.cycleRate} style={{ ...button, color: theme.secondary, fontSize: 13, width: 42 }}>{playback.rate === 1 ? '1.0' : playback.rate}×</button>
    </footer>}
  </section>
}
