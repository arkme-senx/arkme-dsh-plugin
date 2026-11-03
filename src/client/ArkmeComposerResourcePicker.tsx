import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { ArkmeComposerResource, ArkmeComposerResourcePage } from '../types.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { createArkmeSdk } from '../sdk/index.js'
import { ArkmeMediaPreview } from './ArkmeRichContent.js'
import { arkmeTheme as theme } from './arkme-theme.js'
import { tr, useArkmeLocale } from './locale.js'

const button: CSSProperties = { border: `1px solid ${theme.border}`, borderRadius: 8, padding: '8px 12px', color: theme.text, background: theme.layer1, cursor: 'pointer', font: 'inherit' }
export function composerResourceBlock(item: ArkmeComposerResource) {
  return { kind: item.asset.fileKind === 1 ? 'image' as const : item.asset.fileKind === 3 ? 'video' as const : 'file' as const,
    mediaRef: item.mediaRef ?? item.thumbnailRef ?? '', fileAssetUid: item.asset.fileAssetUid, fileName: item.asset.fileName,
    mimeType: item.asset.mimeType, size: item.asset.size, sortOrder: 0 }
}
export function ArkmeComposerResourcePicker({ kind, accountKey, userId, limit, existingAssetUids = [], onClose, onSelect }: {
  kind: 'file' | 'gallery'; accountKey: string; userId: number; limit: number; existingAssetUids?: readonly string[]
  onClose(): void; onSelect(items: ArkmeComposerResource[]): void
}) {
  useArkmeLocale()
  const title = tr(kind === 'file' ? '云端文件' : '视图库')
  const [query, setQuery] = useState(''), [items, setItems] = useState<ArkmeComposerResource[]>([])
  const [selected, setSelected] = useState<string[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [next, setNext] = useState<string>(), [hasMore, setHasMore] = useState(false), [preview, setPreview] = useState<ArkmeComposerResource>()
  const search = useRef<HTMLInputElement>(null), root = useRef<HTMLDivElement>(null), generation = useRef(0), request = useRef<AbortController>()
  const cursors = useRef(new Set<string>())
  const sameAccount = () => { const auth = arkmeAuthStore.getSnapshot().auth; return auth?.status === 'authenticated' && `${auth.environment}:${auth.userId}` === accountKey }
  const load = async (cursor?: string) => {
    const id = ++generation.current
    request.current?.abort(); const controller = new AbortController(); request.current = controller
    setLoading(true); setError('')
    const timer = setTimeout(() => controller.abort(), 20000)
    try {
      if (!sameAccount()) throw new Error('账号已切换，请重新选择')
      const page = await callArkme<ArkmeComposerResourcePage>('composer.resources.list', { kind, query, limit: 30, expectedUserId: userId, ...(cursor ? { cursor } : {}) }, controller.signal)
      if (id !== generation.current || !sameAccount()) return
      setItems(current => [...new Map([...(cursor ? current : []), ...page.items].map(item => [item.asset.fileAssetUid, item])).values()])
      const more = page.hasMore && !!page.nextCursor && page.nextCursor !== cursor && !cursors.current.has(page.nextCursor)
      if (cursor) cursors.current.add(cursor)
      setHasMore(more); setNext(more ? page.nextCursor : undefined)
      if (page.hasMore && !more) setError('后续分页暂不可用，请重试')
    } catch (caught) { if (id === generation.current) setError(controller.signal.aborted ? '加载超时，请重试' : caught instanceof Error ? caught.message : '加载失败，请重试') }
    finally { clearTimeout(timer); if (id === generation.current) setLoading(false) }
  }
  useEffect(() => {
    generation.current++; request.current?.abort(); cursors.current.clear(); setItems([]); setSelected([]); setHasMore(false); setNext(undefined); setLoading(true)
    const timer = setTimeout(() => { void load() }, query.trim() ? 250 : 0)
    return () => { clearTimeout(timer); generation.current++; request.current?.abort() }
  }, [query, kind, accountKey, userId])
  useEffect(() => {
    const previous = typeof document !== 'undefined' ? document.activeElement as HTMLElement | null : null
    search.current?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])
  const toggle = (item: ArkmeComposerResource) => {
    const uid = item.asset.fileAssetUid
    if (existingAssetUids.includes(uid)) return
    setSelected(current => current.includes(uid) ? current.filter(value => value !== uid) : current.length < limit ? [...current, uid] : current)
  }
  const visible = items.filter(item => !existingAssetUids.includes(item.asset.fileAssetUid))
  return <div style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,.45)', display: 'grid', placeItems: 'center', padding: 16 }}
    onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div ref={root} role="dialog" aria-modal="true" aria-label={title} style={{ width: 'min(700px,100%)', height: 'min(720px,88vh)', background: theme.base, color: theme.text,
      display: 'flex', flexDirection: 'column', borderRadius: 16, overflow: 'hidden', boxShadow: theme.shadow }}
      onKeyDown={event => {
        if (preview) return
        if (event.key === 'Escape') { event.stopPropagation(); onClose() }
        if (event.key === 'Tab') {
          const controls = [...root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') ?? []]
          if (!controls.length) return
          if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() }
          else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus() }
        }
      }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '20px 24px 12px' }}><h2 style={{ fontSize: 19, margin: 0, flex: 1 }}>{title}</h2>
        <button type="button" aria-label={tr('关闭{v0}', { v0: title })} style={button} onClick={onClose}>×</button></header>
      <input ref={search} aria-label={tr('搜索我的{v0}', { v0: title })} placeholder={tr('搜索我的{v0}', { v0: title })} value={query} onChange={event => setQuery(event.target.value)}
        style={{ margin: '0 24px 16px', padding: 10, border: `1px solid ${theme.border}`, borderRadius: 10, background: theme.input, color: theme.text, font: 'inherit' }} />
      <div style={{ overflowY: 'auto', minHeight: 0, flex: 1, padding: '0 24px 16px' }}>
        <div style={kind === 'gallery' ? { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(135px,1fr))', gap: 12 } : { display: 'flex', flexDirection: 'column', gap: 10 }}>
          {visible.map(item => { const checked = selected.includes(item.asset.fileAssetUid), disabled = !checked && selected.length >= limit
            return <div key={item.asset.fileAssetUid} style={{ border: `1px solid ${checked ? theme.accent : theme.border}`, borderRadius: 10, overflow: 'hidden', background: checked ? theme.accentSoft : theme.base }}>
              <button type="button" role="checkbox" aria-checked={checked} aria-label={item.asset.fileName} disabled={disabled} onClick={() => toggle(item)}
                style={{ display: 'flex', flexDirection: kind === 'gallery' ? 'column' : 'row', gap: 10, alignItems: 'center', width: '100%', border: 0, background: 'transparent', color: 'inherit', textAlign: 'left', padding: 12, cursor: disabled ? 'default' : 'pointer' }}>
                {kind === 'gallery' && <span style={{ width: '100%', aspectRatio: '1', display: 'grid', placeItems: 'center', overflow: 'hidden', borderRadius: 6, background: theme.layer1 }}>
                  {(item.thumbnailRef || item.mediaRef) && item.asset.fileKind === 1 ? <img loading="lazy" decoding="async" src={createArkmeSdk().mediaUrl(item.thumbnailRef ?? item.mediaRef!)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span>{item.asset.fileKind === 3 ? tr('视频') : tr('图片')}</span>}
                </span>}
                <span aria-hidden>{checked ? '☑' : '☐'}</span><span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', fontSize: 13 }}>{item.asset.fileName}<small style={{ display: 'block', color: theme.secondary, marginTop: 4 }}>{Math.ceil(item.asset.size / 1024)} KB</small></span>
              </button>
              {(item.mediaRef || item.thumbnailRef) && <button type="button" style={{ ...button, margin: '0 12px 10px', padding: '4px 8px', fontSize: 12 }} onClick={() => setPreview(item)}>{tr('预览')}</button>}
            </div>
          })}
        </div>
        {loading && <p role="status">{tr('正在加载…')}</p>}
        {error && <p role="alert">{tr(error)} <button type="button" style={button} onClick={() => { void load(next) }}>{tr('重试')}</button></p>}
        {!loading && !error && !visible.length && <p>{hasMore ? tr('本页暂无可选内容，可继续加载') : tr('暂无可选内容')}</p>}
        {!loading && hasMore && <button type="button" style={button} onClick={() => { void load(next) }}>{tr('加载更多')}</button>}
      </div>
      <footer style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 24px', borderTop: `1px solid ${theme.border}` }}>
        <span style={{ flex: 1, color: theme.secondary, fontSize: 12 }}>{tr('已选 {v0} 项', { v0: selected.length })}</span>
        <button type="button" style={button} onClick={onClose}>{tr('取消')}</button>
        <button type="button" style={{ ...button, background: theme.primaryAction, color: theme.onPrimaryAction }} disabled={!selected.length || selected.length > limit || !sameAccount()} onClick={() => { if (sameAccount()) { onSelect(items.filter(item => selected.includes(item.asset.fileAssetUid))); onClose() } }}>{tr('添加到输入框')}</button>
      </footer>
    </div>
    {preview && <ArkmeMediaPreview selected={composerResourceBlock(preview)} blocks={items.filter(item => item.mediaRef).map(composerResourceBlock)} onSelect={block => setPreview(items.find(item => item.mediaRef === block.mediaRef))} onClose={() => setPreview(undefined)} />}
  </div>
}
