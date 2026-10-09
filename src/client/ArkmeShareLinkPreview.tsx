import { arkmeEmojiPlainText } from '../arkme-emoji-text.js'
import { ArkmeRichText } from './ArkmeRichText.js'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { LinkIcon } from '@phosphor-icons/react/dist/csr/Link'
import { previewText, shareLinkLabels, type ShareLinkPreview, type ShareLinkTarget } from '../share-link-preview.js'
import { arkmeAuthStore } from './auth-store.js'
import { sharePreviewAccountKey, sharePreviewClient } from './share-preview-client.js'
import { tr, useArkmeLocale } from './locale.js'

const stateLabels = { unavailable: '分享内容暂不可用', expired: '分享已失效', auditing: '分享内容审核中', restricted: '请打开链接确认访问权限' }

export function sharePreviewInlineLabel(target: ShareLinkTarget, preview?: ShareLinkPreview | null): string {
  const kind = preview?.kind ?? target.kind
  const label = tr(kind === 'message' ? '快记分享链接' : shareLinkLabels[kind])
  if (preview?.state !== 'ready') {
    const stateLabel = preview && stateLabels[preview.state as keyof typeof stateLabels]
    return stateLabel ? `${label} · ${tr(stateLabel)}` : label
  }
  const author = preview.authorIsMe ? tr('我') : preview.author
  const content = previewText(preview.summary, 100)
  const byAuthor = (value: string) => author ? `${author}：${value}` : value
  if (kind === 'conversation') return [preview.title || label, preview.count ? tr('{count} 条记录', { count: preview.count }) : ''].filter(Boolean).join(' · ')
  if (kind === 'article') return preview.title || byAuthor(content || label)
  if (kind === 'topic' || kind === 'world') return [preview.title, label].filter(Boolean).join(' · ')
  if (kind === 'extension') return preview.title || label
  if (kind === 'call-invite') return [author, tr(preview.callMediaType === 'audio' ? '语音通话邀请' : preview.callMediaType === 'video' ? '视频通话邀请' : '通话邀请')].filter(Boolean).join(' · ')
  if (kind === 'voiceprint') return [author, label].filter(Boolean).join(' · ')
  if (['image', 'video', 'audio', 'file', 'recording'].includes(kind)) return byAuthor(`[${label}] ${preview.title || content}`.trim())
  return byAuthor(preview.title || content || label)
}

/** Replace only the link label; keep surrounding text and paragraph layout. */
export function ArkmeShareLinkPreview({ target, text, onMessageCopyLinkOpen }: {
  target: ShareLinkTarget; text: string; onMessageCopyLinkOpen?: ((sid: string) => void) | undefined
}) {
  useArkmeLocale()
  const scope = useSyncExternalStore(arkmeAuthStore.subscribe, sharePreviewAccountKey, () => '')
  const element = useRef<HTMLAnchorElement>(null)
  const [visible, setVisible] = useState(false)
  const [result, setResult] = useState<{ scope: string; url: string; value: ShareLinkPreview | null }>()
  const [refresh, setRefresh] = useState(0)
  useEffect(() => { setResult(undefined) }, [scope])
  useEffect(() => {
    const node = element.current
    if (!node) return
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return }
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)), { rootMargin: '80px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!visible || !scope) return
    let active = true
    const request = sharePreviewClient.acquire(scope, target.url)
    void request.promise.then(value => { if (active) setResult({ scope, url: target.url, value }) })
    const timer = setTimeout(() => setRefresh(value => value + 1), 61000)
    return () => { active = false; clearTimeout(timer); request.release() }
  }, [visible, scope, target.url, refresh])
  const loaded = result?.scope === scope && result.url === target.url
  const preview = loaded ? result.value : undefined
  const label = sharePreviewInlineLabel(target, preview)
  const sourceLabel = text.trim()
  const suffix = sourceLabel.startsWith(target.url) ? sourceLabel.slice(target.url.length) : ''
  const trailingText = /^\s/u.test(suffix) ? suffix : ''
  return <><a ref={element} href={target.url} target="_blank" rel="noopener noreferrer"
    data-arkme-share-preview={preview?.kind ?? target.kind} data-preview-state={preview?.state ?? (loaded ? 'error' : 'loading')}
    data-arkme-inline-link={target.kind === 'message' ? 'message-copy-link' : 'share-preview'}
    aria-label={arkmeEmojiPlainText(label)} title={arkmeEmojiPlainText(label)} onClick={event => {
      event.stopPropagation()
      if (target.kind === 'message' && scope.startsWith(`${target.environment}:`) && onMessageCopyLinkOpen
        && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
        event.preventDefault(); onMessageCopyLinkOpen(target.id)
      }
    }} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4, maxWidth: '100%', minWidth: 0,
      color: 'var(--dsw-alias-state-business-primary, #007aff)', textDecoration: 'none', cursor: 'pointer', verticalAlign: 'baseline' }}>
    <LinkIcon aria-hidden data-arkme-link-icon="true" style={{ width: 16, height: 16, flex: 'none', alignSelf: 'center' }} />
    <span data-arkme-link-label="true" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><ArkmeRichText text={label} presentation="preview" /></span>
  </a>{trailingText && <span data-arkme-share-trailing-text="true">{trailingText}</span>}</>
}
