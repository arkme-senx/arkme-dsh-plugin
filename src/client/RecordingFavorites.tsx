import { copyText } from './clipboard-text.js'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BookmarkSimple } from '@phosphor-icons/react/dist/icons/BookmarkSimple'
import type { RecordingFavorite, RecordingFavoriteDetail, RecordingFavoritePage } from '../recording-favorite-contract.js'
import { recordingFavorites, favoriteChanges } from './recording-favorite-client.js'
import { arkmeUi } from './ui-controller.js'
import { tr, arkmeIntlLocale } from './locale.js'
import { formatArkmeDateTime } from './display-time-zone.js'
import { RecordingShareSegments } from './RecordingShareSegments.js'
import { ArkmeConfirmDialog } from './ArkmeConfirmDialog.js'
import { arkmeVoiceDuration } from './ArkmeVoiceContent.js'
import { WindowedTimelineRows } from './WindowedTimelineRows.js'
import css from './recording-favorites.css?inline'

const date = (at: number) => at > 0 ? formatArkmeDateTime(new Date(at), arkmeIntlLocale(), { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : ''
function Avatar({ person, mediaPath }: { person: RecordingFavorite['sharer']; mediaPath: string }) {
  return <span className="arkme-favorite-avatar">{person.avatarRef ? <img alt="" src={`${mediaPath}?ref=${encodeURIComponent(person.avatarRef)}`} onError={event => { event.currentTarget.hidden = true }} /> : person.name.slice(0, 1)}</span>
}
export function RecordingFavorites({ accountKey, mediaPath, initialRef, fromNotifications = false }: { accountKey: string; mediaPath: string; initialRef?: string | undefined; fromNotifications?: boolean | undefined }) {
  const [selected, select] = useState(initialRef), [page, setPage] = useState<RecordingFavoritePage>(), [revision, refresh] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const scroll = useRef<HTMLDivElement>(null), scrollTop = useRef(0), sentinel = useRef<HTMLDivElement>(null)
  const request = useRef<AbortController>(), retryCursor = useRef<string>()
  const rows = useMemo(() => page?.items.map(item => ({ id: item.favoriteRef })) ?? [], [page])
  const load = useCallback(async (cursor?: string) => {
    if (request.current) return
    const controller = new AbortController(); request.current = controller; retryCursor.current = cursor
    setBusy(true); setError('')
    try {
      const result = await recordingFavorites({ action: 'page', accountKey, ...(cursor ? { cursor } : {}) }, controller.signal)
      if (controller.signal.aborted) return
      setPage(current => ({ ...result, items: [...new Map([...(cursor ? current?.items ?? [] : []), ...result.items].map(item => [item.favoriteRef, item])).values()] }))
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : tr('加载失败，请重试'))
    } finally {
      if (request.current === controller) { request.current = undefined; setBusy(false) }
    }
  }, [accountKey])
  useEffect(() => { select(initialRef) }, [initialRef])
  useEffect(() => favoriteChanges.subscribe(account => { if (account === accountKey) refresh(value => value + 1) }), [accountKey])
  useEffect(() => {
    if (fromNotifications) return
    setPage(undefined); scrollTop.current = 0
    if (scroll.current) scroll.current.scrollTop = 0
    void load()
    return () => { request.current?.abort(); request.current = undefined }
  }, [load, revision, fromNotifications])
  useEffect(() => {
    if (selected || busy || error || !page?.nextCursor || !sentinel.current || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void load(page.nextCursor)
    }, { root: scroll.current, rootMargin: '240px 0px' })
    observer.observe(sentinel.current)
    return () => observer.disconnect()
  }, [selected, busy, error, page, load])
  useLayoutEffect(() => { if (!selected && scroll.current) scroll.current.scrollTop = scrollTop.current }, [selected])
  const back = () => { if (fromNotifications) arkmeUi.showNotifications(); else select(undefined) }
  return <section className="arkme-favorites" aria-label={tr('我收藏的录音')}>
    <style>{css}</style>
    <header className="arkme-favorites-header"><button type="button" aria-label={tr('返回')} onClick={() => selected ? back() : arkmeUi.showRecordings()}>‹</button><h2>{tr(selected ? '收藏的录音' : '我收藏的录音')}</h2>{!selected && <button type="button" disabled={busy} onClick={() => refresh(value => value + 1)}>{tr('刷新')}</button>}</header>
    {selected && <FavoriteDetail key={selected} accountKey={accountKey} favoriteRef={selected} mediaPath={mediaPath} onRemoved={back} />}
    {!fromNotifications && <div ref={scroll} className="arkme-favorites-scroll" style={selected ? { display: 'none' } : undefined}><div className="arkme-favorites-list">
      <p className="arkme-favorites-subtitle">{tr('保存分享给你的录音片段，随时回来听。')}</p>
      {!busy && !error && page?.items.length === 0 && <div className="arkme-favorites-empty"><BookmarkSimple size={36} /><h3>{tr('还没有收藏的录音')}</h3><p>{tr('打开录音分享链接，点击「收藏录音」即可保存。')}</p></div>}
      <ul className="arkme-favorites-rows"><WindowedTimelineRows rowIds={rows} scrollport={scroll} renderRow={index => {
        const item = page!.items[index]!
        return <li key={item.favoriteRef}><button type="button" className="arkme-favorite-row" onClick={() => { scrollTop.current = scroll.current?.scrollTop ?? 0; request.current?.abort(); request.current = undefined; setBusy(false); select(item.favoriteRef) }}>
        <Avatar person={item.sharer} mediaPath={mediaPath} /><span className="arkme-favorite-row-body"><span className="arkme-favorite-row-title"><strong>{tr('{name} 分享的录音', { name: item.sharer.name })}</strong><time>{date(item.savedAtMillis)} {tr('收藏')}</time></span>
          <span className="arkme-favorite-preview">{item.available ? item.preview || tr('录音片段') : tr('该录音已不可访问')}</span>
          <span className="arkme-favorite-meta">{date(item.recordingStartedAtMillis)} · {item.segmentCount} {tr('个片段')} · {arkmeVoiceDuration(item.durationMillis / 1000)}</span></span><span aria-hidden>›</span>
      </button></li>}} /></ul>
      {(busy || error || page?.nextCursor) && <div ref={sentinel} className="arkme-favorites-more">
        {busy ? <span role="status">{tr(page ? '正在加载更多…' : '加载中…')}</span>
          : error ? <span role="alert">{error} <button type="button" onClick={() => { void load(retryCursor.current) }}>{tr('重试')}</button></span>
          : <button type="button" onClick={() => { void load(page?.nextCursor) }}>{tr('加载更多')}</button>}
      </div>}
    </div></div>}
  </section>
}
function FavoriteDetail({ accountKey, favoriteRef, mediaPath, onRemoved }: { accountKey: string; favoriteRef: string; mediaPath: string; onRemoved(): void }) {
  const [detail, setDetail] = useState<RecordingFavoriteDetail>(), [error, setError] = useState(''), [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [revision, refresh] = useState(0), [confirm, setConfirm] = useState<'remove' | 'revoke'>()
  const lifetime = useRef(new AbortController())
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller; setDetail(undefined); setError('')
    void recordingFavorites({ action: 'detail', accountKey, favoriteRef }, controller.signal).then(setDetail).catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [accountKey, favoriteRef, revision])
  const act = async (action: 'copy' | 'source' | 'remove' | 'revoke') => {
    if (!detail || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      if (action === 'copy') { await copyText(detail.segments.map(row => `${row.speakerName} ${date(row.occurredAtMillis)}\n${row.textContent}`).join('\n\n')); setNotice(tr('已复制文字')) }
      else if (action === 'source') {
        if (!detail.sourceRef) return
        const result = await recordingFavorites({ action: 'source', accountKey, sourceRef: detail.sourceRef }, lifetime.current.signal)
        arkmeUi.showRecordingFavoriteSource(result.atMillis, result.identityHash)
      } else {
        await recordingFavorites(action === 'remove' ? { action, accountKey, favoriteRef, expectedVersion: detail.version } : { action, accountKey, favoriteRef }, lifetime.current.signal)
        setConfirm(undefined); favoriteChanges.publish(accountKey)
        if (action === 'remove') onRemoved(); else refresh(value => value + 1)
      }
    } catch (error) {
      if (!lifetime.current.signal.aborted) {
        setError(error instanceof Error ? error.message : tr('操作失败，请重试')); setConfirm(undefined)
        if (action === 'remove' || action === 'revoke') {
          setDetail(undefined)
          try { setDetail(await recordingFavorites({ action: 'detail', accountKey, favoriteRef }, lifetime.current.signal)) } catch { /* Refresh must succeed before another mutation. */ }
        }
      }
    } finally { if (!lifetime.current.signal.aborted) setBusy(false) }
  }
  return <div className="arkme-favorites-scroll arkme-favorite-detail-scroll"><div className="arkme-favorite-detail">
    {error && <div role="alert">{error} <button type="button" onClick={() => refresh(value => value + 1)}>{tr('重新加载')}</button></div>}
    {notice && <div role="status">{notice}</div>}
    {!detail && !error && <p role="status">{tr('加载中…')}</p>}
    {detail && <><div className="arkme-favorite-heading"><Avatar person={detail.sharer} mediaPath={mediaPath} /><div><strong>{tr('{name} 分享的录音', { name: detail.sharer.name })}</strong><div className="arkme-favorite-meta">{date(detail.recordingStartedAtMillis)}</div><div className="arkme-favorite-meta">{detail.audience === 'sharer' ? tr('{name} 收藏了你分享的录音', { name: detail.collector?.name ?? tr('有人') }) : `${date(detail.savedAtMillis)} ${tr('收藏')}`}</div></div></div>
      {detail.audience === 'collector' && detail.saved && <button className="arkme-favorite-saved" type="button" aria-label={tr('取消收藏')} disabled={busy} onClick={() => setConfirm('remove')}><BookmarkSimple weight="fill" size={16} /> {tr('已收藏')}</button>}
      {detail.available ? <RecordingShareSegments segments={detail.segments} media={detail.audio} mediaPath={mediaPath} detail actions={<><button type="button" disabled={busy} onClick={() => { void act('copy') }}>{tr('复制文字')}</button>{detail.sourceRef && <button type="button" disabled={busy} onClick={() => { void act('source') }}>{tr('查看原录音')}</button>}{detail.canRevoke && <button type="button" disabled={busy} onClick={() => setConfirm('revoke')}>{tr('撤销授权')}</button>}</>} /> : <div className="arkme-favorites-empty"><BookmarkSimple size={32} /><h3>{tr('该录音已不可访问')}</h3><p>{tr('分享者已撤销授权，或该内容暂不可用。')}</p></div>}
    </>}
    {confirm && <ArkmeConfirmDialog titleId="favorite-detail-confirm" title={tr(confirm === 'remove' ? '取消收藏？' : '撤销这段录音的授权？')} description={tr(confirm === 'remove' ? '取消后将从你的收藏列表移除。分享者的历史通知仍保留，且仍可播放。' : '撤销后，所有人通过这份分享和收藏都无法再查看或播放这些片段。原录音不受影响。此操作无法撤回。')} confirmLabel={tr(confirm === 'remove' ? '取消收藏' : '撤销授权')} busyLabel={tr('处理中…')} busy={busy} onClose={() => setConfirm(undefined)} onConfirm={() => { void act(confirm) }} />}
  </div></div>
}
