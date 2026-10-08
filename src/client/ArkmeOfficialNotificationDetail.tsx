import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ArkmeOfficialNotification } from '../official-notification-contract.js'
import { callArkme } from './api.js'
import { officialNotifications } from './official-notification-store.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr } from './locale.js'

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
      style={{
        padding: 24,
        overflowY: 'auto',
        overflowWrap: 'anywhere',
        flex: 1,
        color: arkmeTheme.text,
      }}
    >
      <button type="button" onClick={onClose}>
        {tr('返回通知列表')}
      </button>
      {error ? (
        <div role="alert">
          {error}
          <button onClick={() => setAttempt((value) => value + 1)}>
            {tr('重试')}
          </button>
        </div>
      ) : !notice ? (
        <p role="status">{tr('正在加载通知…')}</p>
      ) : (
        <>
          <h2>{notice.title}</h2>
          <time>{new Date(notice.publishedAtMillis).toLocaleString()}</time>
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
          {ackError && (
            <div role="alert">
              {ackError}
              <button
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
    </article>
  )
}
