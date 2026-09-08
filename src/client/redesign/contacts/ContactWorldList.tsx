import { useEffect, useState } from 'react'
import type { ArkmeWorldFeedItem, ArkmeWorldFeedPage } from '../../../types.js'
import { loadWorldImageDataUrl } from '../../ArkmeWorldSurface.js'
import { ArkmeRichText } from '../../ArkmeRichText.js'
import { formatContactDate } from './contact-date.js'

export interface ContactDetailIdentity {
  accountKey: string
  contactRef: string
  generation: number
}

export type ContactWorldStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error'
export type ContactWorldLoadMode = 'replace' | 'append'

export interface ContactWorldState {
  identity: ContactDetailIdentity
  status: ContactWorldStatus
  items: ArkmeWorldFeedItem[]
  total: number
  hasMore: boolean
  nextOffset: number | undefined
  loadingMode: ContactWorldLoadMode | undefined
  message: string | undefined
}

export type ContactWorldAction =
  | { type: 'world-reset'; identity: ContactDetailIdentity }
  | { type: 'world-start'; identity: ContactDetailIdentity; mode: ContactWorldLoadMode }
  | { type: 'world-success'; identity: ContactDetailIdentity; mode: ContactWorldLoadMode; page: ArkmeWorldFeedPage }
  | { type: 'world-error'; identity: ContactDetailIdentity; message: string }

export function contactDetailIdentityMatches(
  current: ContactDetailIdentity,
  candidate: ContactDetailIdentity,
): boolean {
  return current.accountKey === candidate.accountKey
    && current.contactRef === candidate.contactRef
    && current.generation === candidate.generation
}

export function createContactWorldState(identity: ContactDetailIdentity): ContactWorldState {
  return {
    identity,
    status: 'idle',
    items: [],
    total: 0,
    hasMore: false,
    nextOffset: undefined,
    loadingMode: undefined,
    message: undefined,
  }
}

function mergeWorldItems(
  current: readonly ArkmeWorldFeedItem[],
  incoming: readonly ArkmeWorldFeedItem[],
): ArkmeWorldFeedItem[] {
  const merged = [...current]
  const indexes = new Map(merged.map((item, index) => [item.recordRef, index]))
  for (const item of incoming) {
    const index = indexes.get(item.recordRef)
    if (index === undefined) {
      indexes.set(item.recordRef, merged.length)
      merged.push(item)
    } else {
      merged[index] = item
    }
  }
  return merged
}

export function contactWorldReducer(
  state: ContactWorldState,
  action: ContactWorldAction,
): ContactWorldState {
  if (action.type === 'world-reset') return createContactWorldState(action.identity)
  if (!contactDetailIdentityMatches(state.identity, action.identity)) return state
  switch (action.type) {
    case 'world-start':
      return {
        ...state,
        status: 'loading',
        ...(action.mode === 'replace'
          ? { items: [], total: 0, hasMore: false, nextOffset: undefined }
          : {}),
        loadingMode: action.mode,
        message: undefined,
      }
    case 'world-success': {
      const items = action.mode === 'append'
        ? mergeWorldItems(state.items, action.page.items)
        : [...action.page.items]
      return {
        ...state,
        status: items.length === 0 && action.page.total === 0 ? 'empty' : 'ready',
        items,
        total: action.page.total,
        hasMore: action.page.hasMore,
        nextOffset: action.page.nextOffset,
        loadingMode: undefined,
        message: undefined,
      }
    }
    case 'world-error':
      return { ...state, status: 'error', loadingMode: undefined, message: action.message }
  }
}

function ContactWorldImage({ imageRef, alt }: { imageRef: string; alt: string }) {
  const [source, setSource] = useState<string>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    setSource(undefined)
    setFailed(false)
    void loadWorldImageDataUrl(imageRef)
      .then(value => { if (active) setSource(value) })
      .catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [imageRef])
  if (failed) return <span className="arkme-contact-world-image-error" role="img" aria-label={`${alt}加载失败`}>图片加载失败</span>
  if (source === undefined) return <span className="arkme-contact-world-image-loading" aria-hidden />
  return <img className="arkme-contact-world-image" src={source} alt={alt} loading="lazy" />
}

/** Quick notes: text, media, voice, or voice with media. Articles are kind 8. */
export function isContactQuickNote(item: ArkmeWorldFeedItem): boolean {
  return item.templateKind >= 1 && item.templateKind <= 4 && Number.isInteger(item.templateKind)
}

function worldTimestamp(item: ArkmeWorldFeedItem): number {
  if (Number.isFinite(item.publishedAtMillis) && item.publishedAtMillis > 0) return item.publishedAtMillis
  return Number.isFinite(item.createdAtMillis) && item.createdAtMillis > 0 ? item.createdAtMillis : 0
}

export function ContactWorldList({
  state,
  onRetry,
  onLoadMore,
}: {
  state: ContactWorldState
  onRetry(): void
  onLoadMore(): void
}) {
  const initialLoading = state.status === 'loading' && state.loadingMode === 'replace'
  const latest = state.items.filter(isContactQuickNote).reduce<ArkmeWorldFeedItem | undefined>((current, item) => (
    current === undefined || worldTimestamp(item) > worldTimestamp(current) ? item : current
  ), undefined)
  const imageRef = latest?.imageRefs[0]
  return <section className="arkme-contact-world" aria-label="联系人世界">
    <h2 className="arkme-contact-world-title">世界</h2>
    <div className="arkme-contact-world-content">
      {initialLoading && <div role="status" className="arkme-contact-world-status">正在加载 TA 的世界…</div>}
      {state.status === 'empty' && <div className="arkme-contact-world-empty">暂无公开快记</div>}
      {state.status === 'ready' && latest === undefined && <div className="arkme-contact-world-page-empty">暂无公开快记</div>}
      {state.status === 'error' && <div role="alert" className="arkme-contact-world-error">
        <span>{state.message ?? '世界加载失败'}</span>
        <button type="button" onClick={latest === undefined ? onRetry : onLoadMore}>重试</button>
      </div>}
      {!initialLoading && latest !== undefined && <article className="arkme-contact-world-preview" data-world-record-ref={latest.recordRef}>
        {imageRef !== undefined && <div className="arkme-contact-world-thumbnail"><ContactWorldImage key={imageRef} imageRef={imageRef} alt={`${latest.authorName}发布的图片 1`} /></div>}
        <div className="arkme-contact-world-summary">
          {latest.headline.trim() !== '' && <h3 className="arkme-contact-world-headline"><ArkmeRichText text={latest.headline} presentation="preview" /></h3>}
          {latest.textContent.trim() !== '' && <p className="arkme-contact-world-text"><ArkmeRichText text={latest.textContent} presentation="preview" /></p>}
          {latest.headline.trim() === '' && latest.textContent.trim() === '' && <p className="arkme-contact-world-text">{
            latest.imageCount > 0 ? '[图片]' : latest.videoCount > 0 ? '[视频]' : latest.voiceCount > 0 ? '[语音]' : '世界动态'
          }</p>}
          <span className="arkme-contact-world-time">{formatContactDate(worldTimestamp(latest), '日期未知')}</span>
        </div>
      </article>}
    </div>
  </section>
}
