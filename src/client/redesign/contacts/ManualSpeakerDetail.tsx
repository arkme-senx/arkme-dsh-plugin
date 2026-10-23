import { useEffect, useState } from 'react'
import type { ArkmeDirectoryItem, ArkmeRecordingSpeakerMembers } from '../../../types.js'
import { callArkme } from '../../api.js'
import { arkmeIntlLocale, tr, useArkmeLocale } from '../../locale.js'
import { arkmeUi } from '../../ui-controller.js'
import { ManualSpeakerAvatar } from './ManualSpeakerAvatar.js'
import { UnmarkedSpeakerTokenAvatar } from './UnmarkedSpeakerVisuals.js'

type Speaker = Extract<ArkmeDirectoryItem, { kind: 'manual-speaker' }>
export type ManualSpeakerMembersLoader = (speakerRef: string, signal: AbortSignal) => Promise<ArkmeRecordingSpeakerMembers>
const loadMembers: ManualSpeakerMembersLoader = (speakerRef, signal) => callArkme('recordings.speaker.members', { speakerRef }, signal)
const openRecording = (at: number) => {
  const day = new Date(at); day.setHours(0, 0, 0, 0)
  arkmeUi.showRecordingTarget(day.getTime(), at)
}
const dateLabel = (at: number) => new Intl.DateTimeFormat(arkmeIntlLocale(), {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(at)

export function ManualSpeakerDetail({ accountKey, speaker, load = loadMembers, onOpenRecording = openRecording }: {
  accountKey: string; speaker: Speaker; load?: ManualSpeakerMembersLoader; onOpenRecording?(at: number): void
}) {
  return <SpeakerDetail key={`${accountKey}:${speaker.speakerKey}`} speaker={speaker} load={load} onOpenRecording={onOpenRecording}/>
}

function SpeakerDetail({ speaker, load, onOpenRecording }: {
  speaker: Speaker; load: ManualSpeakerMembersLoader; onOpenRecording(at: number): void
}) {
  useArkmeLocale()
  const [value, setValue] = useState<ArkmeRecordingSpeakerMembers>()
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError('')
    void load(speaker.speakerRef, controller.signal).then(result => {
      if (!controller.signal.aborted) setValue(result)
    }).catch(error => {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : tr('读取失败，请重试'))
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [speaker.speakerRef, load, revision])
  const ready = value?.state === 'fresh'
  const retry = <button type="button" className="arkme-manual-speaker-link" disabled={loading} onClick={() => setRevision(x => x + 1)}>{tr('刷新')}</button>
  return <section className="arkme-contact-detail" aria-label={tr('手动说话人详情')}>
    <div className="arkme-contact-profile">
      <header className="arkme-contact-profile-main">
        <span className="arkme-contact-profile-avatar"><ManualSpeakerAvatar name={speaker.displayName} size={72}/></span>
        <div className="arkme-contact-profile-identity">
          <h1 className="arkme-contact-profile-name">{speaker.displayName}</h1>
          <span className="arkme-manual-speaker-muted">{tr('手动说话人')}</span>
        </div>
      </header>
      <section className="arkme-contact-profile-section">
        <h2 className="arkme-contact-profile-section-title">{tr('录音出现记录')}</h2>
        {loading && <p role="status" className="arkme-manual-speaker-muted">{tr(value ? '正在更新…' : '正在读取录音出现记录…')}</p>}
        {error && <div role="alert" className="arkme-contact-profile-error"><span>{error}</span>{retry}</div>}
        {!loading && !error && value && !ready && <p role="status" className="arkme-manual-speaker-muted">
          {tr(value.state === 'failed' ? '录音出现记录读取失败' : value.state === 'stale' ? '录音出现记录待更新' : '录音出现记录仍在整理')} {retry}
        </p>}
        {ready && <>
          <p>{tr('出现 {v0} 天', { v0: value.dayCount })} · {tr('{v0} 个关联的识别说话人', { v0: value.items.length })}</p>
          {value.lastSeenAt > 0 && <div className="arkme-manual-speaker-recent">
            <span className="arkme-manual-speaker-muted">{tr('最近出现')} {dateLabel(value.lastSeenAt)}</span>
            <button type="button" className="arkme-manual-speaker-link" onClick={() => onOpenRecording(value.lastSeenAt)}>{tr('查看最近录音')} ↗</button>
          </div>}
          {!value.items.length && <p className="arkme-manual-speaker-muted">{tr('暂无可核实的关联录音，已创建的说话人仍会保留在名单中。')}</p>}
          {value.items.length > 0 && <ul className="arkme-manual-speaker-members" aria-label={tr('对应的识别说话人')}>
            {value.items.map(member => <li key={member.identityKey}>
              <UnmarkedSpeakerTokenAvatar token={member.token} size={32} label={tr('说话人 {v0}', { v0: member.token })}/>
              <span><strong>{tr('说话人 {v0}', { v0: member.token })}</strong><small>{tr('出现 {v0} 天', { v0: member.dayCount })}{member.lastSeenAt > 0 ? ` · ${dateLabel(member.lastSeenAt)}` : ''}</small></span>
              {member.lastSeenAt > 0 && <button type="button" className="arkme-manual-speaker-link" aria-label={tr('查看说话人 {v0} 的最近录音', { v0: member.token })} onClick={() => onOpenRecording(member.lastSeenAt)}>{tr('查看录音')} ↗</button>}
            </li>)}
          </ul>}
        </>}
      </section>
    </div>
  </section>
}
