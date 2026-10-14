import { useEffect, useState } from 'react'
import type { ArkmeArrangementDetail } from '../types.js'
import type { ArkmeNotificationItem, ArkmeNotificationKind } from './ArkmeNotificationCenter.js'
import officialIcon from '../../assets/notification-icons/verify-linear.svg'
import arrangementIcon from '../../assets/notification-icons/calendar-linear.svg'
import reactionIcon from '../../assets/notification-icons/emoji-happy-linear.svg'
import worldIcon from '../../assets/notification-icons/global-linear.svg'
import aiIcon from '../../assets/notification-icons/sms-linear.svg'
import recordingIcon from '../../assets/notification-icons/microphone-linear.svg'
import { ArkmeArrangementContent } from './ArkmeArrangementContent.js'
import { ArkmeRecordingNotificationDetail } from './ArkmeRecordingNotificationDetail.js'
import { ArkmeOfficialNotificationDetail } from './ArkmeOfficialNotificationDetail.js'
import { ArkmeRichText } from './ArkmeRichText.js'
import { callArkme } from './api.js'
import { withArkmeReadDeadline } from './read-deadline.js'
import { tr } from './locale.js'

// Keep the sender identities aligned with Flutter's MobileUnifiedNotificationPage.
const notificationIcons: Record<ArkmeNotificationKind, string> = {
  official: officialIcon, arrangement: arrangementIcon, reaction: reactionIcon,
  world: worldIcon, ai: aiIcon, recording: recordingIcon,
}

function NotificationAvatar({ kind }: { kind: ArkmeNotificationKind }) {
  const mask = `url(data:image/svg+xml;base64,${notificationIcons[kind]})`
  return <span className="arkme-notification-avatar" aria-hidden="true">
    <span className="arkme-notification-avatar-icon" data-notification-icon={kind} style={{ maskImage: mask, WebkitMaskImage: mask }} />
  </span>
}

function ArrangementNoticeContent({ arrangementRef }: { arrangementRef: string }) {
  const [detail, setDetail] = useState<ArkmeArrangementDetail>()
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setError(false)
    void withArkmeReadDeadline(signal => callArkme<ArkmeArrangementDetail>('arrangements.detail', { arrangementRef }, signal), controller.signal)
      .then(value => {
        if (controller.signal.aborted) return
        if (value.arrangementRef !== arrangementRef) throw new Error('Arrangement identity mismatch')
        setDetail(value)
      }).catch(() => { if (!controller.signal.aborted) setError(true) })
    return () => controller.abort()
  }, [arrangementRef, attempt])
  if (error) return <div role="alert">{tr('安排暂时无法加载')} <button className="arkme-notification-link" onClick={() => setAttempt(value => value + 1)}>{tr('重试')}</button></div>
  if (!detail) return <div role="status">{tr('加载中…')}</div>
  return <div style={{ marginTop: 12 }}>
    <strong>{detail.title}</strong>
    {detail.description && <div className="arkme-notification-text"><ArkmeRichText text={detail.description} /></div>}
    <ArkmeArrangementContent item={detail} expanded />
  </div>
}

export function ArkmeNotificationMessage({ item, scope, category, timeLabel, onOpen, busy }: {
  item: ArkmeNotificationItem; scope: string; category: string; timeLabel: string
  onOpen(item: ArkmeNotificationItem): void; busy: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const long = item.preview.length > 320 || item.preview.split('\n').length > 6
  const canExpand = item.kind === 'official' || item.kind === 'arrangement' || long
  return <article role="listitem" aria-label={`${category}：${item.title}`} className="arkme-notification-message">
    {timeLabel && <time className="arkme-notification-time" dateTime={new Date(item.atMillis).toISOString()}>{timeLabel}</time>}
    <div className="arkme-notification-message-row" data-notification-id={item.id}>
      <div className="arkme-notification-identity">
        <NotificationAvatar kind={item.kind} />
        <div className="arkme-notification-sender">{category}</div>
      </div>
      <div className="arkme-notification-message-content">
        <div className="arkme-notification-bubble">
          <h3><ArkmeRichText text={item.title} /></h3>
          {item.recording ? <ArkmeRecordingNotificationDetail notice={item.recording} embedded /> : <>
            {item.preview !== item.title && !(item.kind === 'official' && expanded) && <div className={`arkme-notification-text${long && !expanded ? ' arkme-notification-text--collapsed' : ''}`}><ArkmeRichText text={item.preview} /></div>}
            {item.kind === 'official' && expanded && <ArkmeOfficialNotificationDetail id={item.id.slice('official:'.length)} scope={scope} embedded />}
            {item.arrangement && expanded && <ArrangementNoticeContent arrangementRef={item.arrangement.arrangementRef} />}
            {canExpand && <button type="button" className="arkme-notification-link" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? tr('收起') : item.kind === 'arrangement' ? tr('查看安排') : tr('展开全文')}</button>}
            {(item.kind === 'world' || item.kind === 'reaction') && <div><button type="button" className="arkme-notification-link" disabled={busy} onClick={() => onOpen(item)}>{item.kind === 'world' ? tr('查看互动') : tr('查看原消息')} →</button></div>}
          </>}
        </div>
      </div>
    </div>
  </article>
}
