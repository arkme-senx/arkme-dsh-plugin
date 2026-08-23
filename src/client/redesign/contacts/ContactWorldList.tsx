import { useEffect, useState } from 'react'
import type { ArkmeWorldFeedItem, ArkmeWorldFeedPage } from '../../../types.js'
import { loadWorldImageDataUrl } from '../../ArkmeWorldSurface.js'
import { arkmeEmojiPlainText } from '../../arkme-emoji.js'
import contactWorldEmptyBase64 from '../../../../assets/branding/contact-world-empty.svg'

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

function worldDateParts(item: ArkmeWorldFeedItem): { year: number; diary: string; time: string } {
  const value = item.publishedAtMillis || item.createdAtMillis
  const date = new Date(value)
  if (!Number.isFinite(value) || value <= 0 || Number.isNaN(date.getTime())) {
    return { year: 0, diary: '日期未知', time: '' }
  }
  return {
    year: date.getFullYear(),
    diary: `${String(date.getMonth() + 1)}月${String(date.getDate())}日记`,
    time: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
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

function ContactWorldCard({ item }: { item: ArkmeWorldFeedItem }) {
  return <article className="arkme-contact-world-card" data-world-record-ref={item.recordRef}>
    {item.headline.trim() !== '' && <h3 className="arkme-contact-world-headline">{arkmeEmojiPlainText(item.headline)}</h3>}
    {item.textContent.trim() !== '' && <p className="arkme-contact-world-text">{arkmeEmojiPlainText(item.textContent)}</p>}
    {item.imageRefs.length > 0 && <div className="arkme-contact-world-images">
      {item.imageRefs.map((imageRef, index) => <ContactWorldImage
        key={imageRef}
        imageRef={imageRef}
        alt={`${item.authorName}发布的图片 ${String(index + 1)}`}
      />)}
    </div>}
    {item.tags.length > 0 && <div className="arkme-contact-world-tags">
      {item.tags.map(tag => <span key={tag} className="arkme-contact-world-tag">#{tag}</span>)}
    </div>}
  </article>
}

function ContactWorldTimeline({ items }: { items: readonly ArkmeWorldFeedItem[] }) {
  const groups: Array<{ year: number; items: ArkmeWorldFeedItem[] }> = []
  const sorted = [...items].sort((left, right) => {
    const leftTime = left.publishedAtMillis || left.createdAtMillis
    const rightTime = right.publishedAtMillis || right.createdAtMillis
    return rightTime - leftTime
  })
  for (const item of sorted) {
    const year = worldDateParts(item).year
    const current = groups.at(-1)
    if (current?.year === year) current.items.push(item)
    else groups.push({ year, items: [item] })
  }
  return <div className="arkme-contact-world-list">
    {groups.map((group, index) => <section className="arkme-contact-world-year" key={`${String(group.year)}:${String(index)}`}>
      <h2>{group.year > 0 ? `${String(group.year)}年` : '时间未知'}</h2>
      {group.items.map(item => {
        const date = worldDateParts(item)
        return <div className="arkme-contact-world-entry" key={item.recordRef}>
          <strong className="arkme-contact-world-diary">{date.diary}</strong>
          {date.time !== '' && <time className="arkme-contact-world-time"><span aria-hidden>•</span>{date.time}</time>}
          <ContactWorldCard item={item} />
        </div>
      })}
    </section>)}
  </div>
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
  const appending = state.status === 'loading' && state.loadingMode === 'append'
  const appendError = state.status === 'error' && state.items.length > 0
  return <section className="arkme-contact-world" aria-label="联系人世界">
    <div className="arkme-contact-world-container">
      <h2 className="arkme-contact-world-title">世界</h2>
      {initialLoading && <div role="status" className="arkme-contact-world-status">正在加载 TA 的世界…</div>}
      {state.status === 'empty' && <div className="arkme-contact-world-empty">
        <img src={`data:image/svg+xml;base64,${contactWorldEmptyBase64}`} alt="暂无公开内容" draggable={false} />
        <p>他还没有公开任何内容</p>
      </div>}
      {state.status === 'ready' && state.items.length === 0 && <div className="arkme-contact-world-page-empty">当前页面暂无可显示的动态</div>}
      {state.status === 'error' && state.items.length === 0 && <div role="alert" className="arkme-contact-world-error">
        <span>{state.message ?? '世界加载失败'}</span>
        <button type="button" onClick={onRetry}>重试</button>
      </div>}
      {state.items.length > 0 && <ContactWorldTimeline items={state.items} />}
      {appendError && <div role="alert" className="arkme-contact-world-load-more-error">
        <span>{state.message ?? '加载更多失败'}</span>
        <button type="button" onClick={onLoadMore}>重试</button>
      </div>}
      {appending && <div role="status" className="arkme-contact-world-load-more-status">正在加载更多…</div>}
      {!appending && !appendError && state.hasMore && <button
        type="button"
        className="arkme-contact-world-load-more"
        onClick={onLoadMore}
      >加载更多</button>}
    </div>
  </section>
}
