import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ArkmeOfficialNotification } from '../official-notification-contract.js'
import { callArkme } from './api.js'
import { officialNotifications } from './official-notification-store.js'
import { ArrowLeft } from '@phosphor-icons/react/dist/icons/ArrowLeft'
import { MegaphoneSimple } from '@phosphor-icons/react/dist/icons/MegaphoneSimple'
import detailCss from './official-notification-detail.css?inline'
import { arkmeIntlLocale, tr } from './locale.js'

export function ArkmeOfficialNotificationDetail({
  id,
  scope,
  onClose,
}: {
  id: string
  scope: string
  onClose(): void
}) {
  const snapshot = useSyncExternalStore(
    officialNotifications.subscribe,
    officialNotifications.getSnapshot,
    officialNotifications.getSnapshot,
  )
  const acknowledged = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const [notice, setNotice] = useState<ArkmeOfficialNotification>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [ackError, setAckError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    setError('')
    void callArkme<ArkmeOfficialNotification>(
      'official-notifications.detail',
      { id },
      controller.signal,
    )
      .then((value) => {
        if (!controller.signal.aborted) setNotice(value)
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setNotice(undefined)
          setError(
            reason instanceof Error ? reason.message : tr('官方通知暂时不可用'),
          ) /* A withdrawn notice stays unavailable until the next reconciliation. */
        }
      })
    return () => controller.abort()
  }, [id, scope, attempt, snapshot.revision])
  // A committed detail render, not a background fetch or list preview, acknowledges reading.
  useEffect(() => {
    if (!notice || notice.readAtMillis > 0 || acknowledged.current) return
    const acknowledge = () => {
      if (document.hidden || acknowledged.current) return
      acknowledged.current = true
      void officialNotifications.read(scope, [notice.id]).catch(() => {
        if (mounted.current) setAckError(tr('已读状态保存失败，请重试'))
      })
    }
    acknowledge()
    document.addEventListener('visibilitychange', acknowledge)
    return () => {
      document.removeEventListener('visibilitychange', acknowledge)
    }
  }, [notice, scope])

  return (
    <article
      aria-label={tr('官方通知详情')}
      className="arkme-official-detail"
    >
      <style>{detailCss}</style>
      <div className="arkme-official-detail__inner">
        <nav className="arkme-official-detail__navigation">
          <button
            type="button"
            className="arkme-official-detail__back"
            onClick={onClose}
          >
            <ArrowLeft size={16} aria-hidden />
            {tr('返回通知列表')}
          </button>
        </nav>
        {error ? (
          <div role="alert" className="arkme-official-detail__status">
            {error}
            <button type="button" onClick={() => setAttempt((value) => value + 1)}>
              {tr('重试')}
            </button>
          </div>
        ) : !notice ? (
          <p role="status" className="arkme-official-detail__status">{tr('正在加载通知…')}</p>
        ) : (
          <>
            <header className="arkme-official-detail__header">
              <div className="arkme-official-detail__label">
                <MegaphoneSimple size={15} aria-hidden />
                <span>{tr('官方通知')}</span>
              </div>
              <h2>{notice.title}</h2>
              <time dateTime={new Date(notice.publishedAtMillis).toISOString()}>
                {new Date(notice.publishedAtMillis).toLocaleString(arkmeIntlLocale(), {
                  year: 'numeric', month: 'long', day: 'numeric',
                  hour: '2-digit', minute: '2-digit', hour12: false,
                })}
              </time>
            </header>
            <div className="arkme-official-detail__body">
              <Markdown
                skipHtml
                remarkPlugins={[remarkGfm]}
                allowedElements={[
                  'p',
                  'h1',
                  'h2',
                  'h3',
                  'h4',
                  'strong',
                  'em',
                  'del',
                  'ul',
                  'ol',
                  'li',
                  'blockquote',
                  'pre',
                  'code',
                  'a',
                  'br',
                  'hr',
                  'table',
                  'thead',
                  'tbody',
                  'tr',
                  'th',
                  'td',
                ]}
                urlTransform={(url) => (/^https?:\/\//i.test(url) ? url : '')}
                components={{
                  a: ({ href, children }) =>
                    href ? (
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        {children}
                      </a>
                    ) : (
                      <span>{children}</span>
                    ),
                }}
              >
                {notice.bodyMarkdown || ''}
              </Markdown>
            </div>
            {ackError && (
              <div role="alert" className="arkme-official-detail__status">
                {ackError}
                <button
                  type="button"
                  onClick={() => {
                    void officialNotifications
                      .read(scope, [notice.id])
                      .then(() => setAckError(''))
                      .catch(() => undefined)
                  }}
                >
                  {tr('重试')}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </article>
  )
}
