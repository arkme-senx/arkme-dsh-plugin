import { WorldInfiniteScrollTrigger } from './ArkmeWorldSurface.js'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DotsThree } from '@phosphor-icons/react/dist/icons/DotsThree'
import type { TeamWorldAsset, TeamWorldContext, TeamWorldOriginal, TeamWorldReceipt, TeamWorldRequest } from '../team-world-contract.js'
import type { ReactionSnapshot } from '../reaction-contract.js'
import type { WorldReactionContext, WorldReactionContextPage } from '../world-reaction-contract.js'
import { callArkme } from './api.js'
import { ArkmeRichText } from './ArkmeRichText.js'
import { ArkmeDetailShell } from './ArkmeDetailShell.js'
import { ArkmeConfirmDialog } from './ArkmeConfirmDialog.js'
import { ArkmeActionMenu } from './ArkmeDshMenu.js'
import { ArkmePublishComposer } from './ArkmePublishComposer.js'
import { WorldPublishAttachments, type WorldPublishAttachment } from './WorldPublishAttachments.js'
import { TeamWorldImages, readTeamWorldImage } from './TeamWorldImages.js'
import { WorldReactionArchive } from './NoteWorldReactionArchive.js'
import { invalidateWorldImages } from './world-image-cache.js'
import { arkmeTheme as c } from './arkme-theme.js'
import { tr, arkmeIntlLocale } from './locale.js'

export function TeamWorldManagement({ accountKey, context, onClose, onChanged }: { accountKey: string; context: TeamWorldContext; onClose(): void; onChanged(): void }) {
  const [items, setItems] = useState<TeamWorldOriginal[]>([]), [deleted, setDeleted] = useState(false), [cursor, setCursor] = useState<string>()
  const [edit, setEdit] = useState<TeamWorldOriginal>(), [archive, setArchive] = useState<WorldReactionContext>(), [confirm, setConfirm] = useState<{ item: TeamWorldOriginal; change: 'delete' | 'unpublish'; count?: number }>()
  const [more, setMore] = useState(false), [menu, setMenu] = useState<string>(), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const request = useRef<AbortController>(), write = useRef<AbortController>(), rows = useRef<TeamWorldOriginal[]>([])
  const scrollRootRef = useRef<HTMLDivElement>(null)
  const pending = useRef<Extract<TeamWorldRequest, { action: 'submit' }>>()
  const pendingOriginal = useRef<string>()
  const pages = useRef<{ cursor?: string; items: TeamWorldOriginal[] }[]>([])
  const mainPosition = useRef<{ cursors: (string | undefined)[]; top: number }>(), restoreTop = useRef<number>()
  const loading = useRef(false), anchor = useRef<{ id: string; top: number }>()
  useLayoutEffect(() => {
    if (!edit && !archive && !loading.current && restoreTop.current !== undefined && scrollRootRef.current) {
      scrollRootRef.current.scrollTop = restoreTop.current; restoreTop.current = undefined
    }
    if (!anchor.current || !scrollRootRef.current) return
    const row = [...scrollRootRef.current.querySelectorAll<HTMLElement>('[data-team-page-row]')].find(el => el.dataset.teamPageRow === anchor.current!.id)
    if (row) scrollRootRef.current.scrollTop += row.getBoundingClientRect().top - anchor.current.top
    anchor.current = undefined
  }, [items, edit, archive, scrollRootRef])
  const load = useCallback(async (next?: string) => {
    if (next && loading.current) return
    request.current?.abort(); const controller = new AbortController(); request.current = controller; loading.current = true; setBusy(true); setError('')
    try {
      const fresh: typeof pages.current = []
      let position = next ?? pages.current[0]?.cursor
      const count = next ? 1 : Math.max(1, pages.current.length)
      let nextCursor: string | undefined
      for (let index = 0; index < count; index++) {
        const page = await callArkme<{ items: TeamWorldOriginal[]; hasMore: boolean; nextCursor?: string }>('team.world', { action: 'originals', accountKey, teamRef: context.teamRef, deleted, limit: 20, ...(position ? { cursor: position } : {}) }, controller.signal)
        if (controller.signal.aborted) return
        if (page.hasMore && (!page.nextCursor || page.nextCursor === position)) throw Error(tr('内容分页未推进'))
        fresh.push({ ...(position ? { cursor: position } : {}), items: page.items })
        nextCursor = page.hasMore ? page.nextCursor : undefined; position = nextCursor
        if (!nextCursor) break
      }
      const combined = [...(next ? pages.current : []), ...fresh]
      if (combined.length > 5 && scrollRootRef.current) {
        const item = combined[combined.length - 5]!.items[0]
        const id = item && item.recordRef
        const row = [...scrollRootRef.current.querySelectorAll<HTMLElement>('[data-team-page-row]')].find(el => el.dataset.teamPageRow === id)
        if (row && id) anchor.current = { id, top: row.getBoundingClientRect().top }
      }
      pages.current = combined.slice(-5)
      rows.current = [...new Map(pages.current.flatMap(page => page.items).map(item => [item.recordRef, item])).values()]
      setItems(rows.current); setCursor(nextCursor)
    } catch (error) {
      if (!controller.signal.aborted) { invalidateWorldImages(rows.current.flatMap(item => item.assets.map(asset => asset.imageRef))); rows.current = []; setItems([]); setEdit(undefined); setArchive(undefined); setConfirm(undefined); setError(error instanceof Error ? error.message : tr('读取失败')) }
    } finally { if (!controller.signal.aborted) { loading.current = false; setBusy(false) } }
  }, [accountKey, context.teamRef, deleted])
  useEffect(() => { void load(); const refresh = () => void load(); window.addEventListener('focus', refresh); window.addEventListener('arkme-reaction-policy-changed', refresh); return () => { request.current?.abort(); write.current?.abort(); window.removeEventListener('focus', refresh); window.removeEventListener('arkme-reaction-policy-changed', refresh) } }, [load])
  const submit = async (item: TeamWorldOriginal, change: 'unpublish' | 'delete' | 'restore' | 'publish') => {
    if (busy) return
    if (pending.current && (pendingOriginal.current !== item.recordRef || pending.current.change !== change)) { setError(tr('请先重试尚未确认的操作')); return }
    if (!pending.current) pendingOriginal.current = item.recordRef
    pending.current ??= { action: 'submit', accountKey, teamRef: context.teamRef, contentRef: item.contentRef, expectedRevision: item.revision, requestUid: crypto.randomUUID(), change }
    const controller = new AbortController(); write.current = controller; setBusy(true); setError('')
    try {
      const receipt = await callArkme<TeamWorldReceipt>('team.world', pending.current, controller.signal)
      if (controller.signal.aborted) return
      if (receipt.pending) { setError(tr('操作结果尚未确认，请重试原操作')); return }
      pending.current = undefined; setConfirm(undefined); onChanged(); await load()
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : tr('操作失败，请重试')) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  const prepareArchive = async (item: TeamWorldOriginal, withdraw = false) => {
    if (busy) return
    request.current?.abort(); const controller = new AbortController(); request.current = controller; setBusy(true); setError('')
    try {
      const page = await callArkme<WorldReactionContextPage>('world.reactions.prepare', { accountKey, recordRefs: [item.recordRef] }, controller.signal)
      const current = page.items[0]
      if (!current) throw Error(tr('当前无法读取这份原件的世界归档'))
      if (withdraw) {
        const result = await callArkme<{ items: ReactionSnapshot[] }>('world.reactions.archive', { action: 'query', accountKey, targets: [current.target] }, controller.signal)
        if (result.items[0]?.actor_count === undefined) throw Error(tr('互动人数暂不可用，请重试'))
        if (!controller.signal.aborted) setConfirm({ item, change: 'unpublish', count: result.items[0].actor_count })
      } else if (!controller.signal.aborted) setArchive(current)
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : tr('读取失败')) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  const switchDeleted = (value: boolean) => {
    if (value === deleted || busy && !loading.current) return
    if (value) mainPosition.current = { cursors: pages.current.map(page => page.cursor), top: scrollRootRef.current?.scrollTop ?? 0 }
    request.current?.abort(); rows.current = []; anchor.current = undefined
    pages.current = !value && mainPosition.current ? mainPosition.current.cursors.map(cursor => ({ ...(cursor ? { cursor } : {}), items: [] })) : []
    restoreTop.current = value ? 0 : mainPosition.current?.top ?? 0
    setItems([]); setCursor(undefined); setMenu(undefined); setMore(false); setError(''); setBusy(true); loading.current = true; setDeleted(value)
    if (scrollRootRef.current) scrollRootRef.current.scrollTop = 0
  }
  return <ArkmeDetailShell style={{ top: 0 }} bodyRef={scrollRootRef} title={tr(edit ? '编辑团队内容' : archive ? '世界表态归档' : deleted ? '已删除' : '团队内容')} label={tr('团队内容')} onClose={onClose}
    headerActions={!edit && !archive && !deleted && <ArkmeActionMenu open={more} onClose={() => setMore(false)} label={tr('团队内容列表操作')} align="end"
      anchor={<button type="button" style={actionStyle} aria-label={tr('更多团队内容操作')} disabled={busy && !loading.current} onClick={() => { setMenu(undefined); setMore(value => !value) }}><DotsThree size={20} /></button>}
      actions={[{ id: 'deleted', label: tr('已删除'), onSelect: () => switchDeleted(true) }]} />}
    {...(edit || archive || deleted ? { onBack: () => {
      if (edit || archive) { setEdit(undefined); setArchive(undefined) }
      else switchDeleted(false)
    }, backLabel: tr(deleted && !edit && !archive ? '返回团队内容' : deleted ? '返回已删除' : '返回团队内容') } : {})}>
    {error && <p role="alert">{error} <button type="button" style={actionStyle} disabled={busy} onClick={() => void load()}>{tr('重新读取')}</button></p>}
    {edit ? <TeamWorldEditor key={edit.contentRef} accountKey={accountKey} context={context} original={edit} onSaved={() => { setEdit(undefined); onChanged(); void load() }} />
      : archive ? <WorldReactionArchive accountKey={accountKey} context={archive} /> : <>
        {items.map(item => <article key={item.recordRef} data-team-page-row={item.recordRef} style={{ padding: '16px 0', borderBottom: `1px solid ${c.borderSoft}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 9 }}>
            <time style={{ color: c.tertiary, fontSize: 11 }} dateTime={new Date(item.updatedAt).toISOString()}>{new Intl.DateTimeFormat(arkmeIntlLocale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(item.updatedAt)}</time>
            <ArkmeActionMenu open={menu === item.recordRef} onClose={() => setMenu(undefined)} label={tr('团队内容操作')} align="end"
              anchor={<button type="button" style={{ ...actionStyle, padding: 0, display: 'flex' }} disabled={busy} aria-label={tr('更多内容操作')} onClick={() => { setMore(false); setMenu(item.recordRef) }}><DotsThree size={20} /></button>}
              actions={[...(!item.deleted ? [{ id: 'visibility', label: tr(item.publicRequested ? '取消公开' : '公开'), onSelect: () => { setMenu(undefined); item.publicRequested ? void prepareArchive(item, true) : void submit(item, 'publish') } }] : []),
                { id: 'archive', label: tr('世界表态归档'), onSelect: () => { setMenu(undefined); restoreTop.current = scrollRootRef.current?.scrollTop ?? 0; void prepareArchive(item) } },
                ...(!item.deleted ? [{ id: 'delete', label: tr('删除'), danger: true, onSelect: () => { setMenu(undefined); setConfirm({ item, change: 'delete' }) } }] : [])]} />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {item.title && <strong style={{ ...previewText, display: '-webkit-box', WebkitLineClamp: 1, marginBottom: 5, fontWeight: 500 }}><ArkmeRichText text={item.title} presentation="preview" /></strong>}
              {item.text && <p style={{ ...previewText, margin: 0 }}><ArkmeRichText text={item.text} presentation="preview" /></p>}
            </div>
            {item.assets.length > 0 && <TeamWorldImages compact imageRefs={item.assets.map(asset => asset.imageRef)} />}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            {item.deleted ? <button type="button" style={actionStyle} disabled={busy} onClick={() => void submit(item, 'restore')}>{tr('恢复为未公开')}</button>
              : <button type="button" style={actionStyle} disabled={busy} onClick={() => { restoreTop.current = scrollRootRef.current?.scrollTop ?? 0; setEdit(item) }}>{tr('编辑')}</button>}
          </div>
        </article>)}
        {busy && <p role="status">{tr('加载中…')}</p>}
        {!busy && !items.length && !error && <p style={{ color: c.secondary, fontSize: 13 }}>{tr(deleted ? '暂无已删除内容' : '暂无团队内容')}</p>}
        {pages.current[0]?.cursor && <button type="button" style={actionStyle} disabled={busy} onClick={() => { pages.current = []; if (scrollRootRef.current) scrollRootRef.current.scrollTop = 0; void load() }}>{tr('返回最新记录')}</button>}
        {cursor && !error && <WorldInfiniteScrollTrigger scrollRootRef={scrollRootRef} loading={busy} error={false} onLoadMore={() => { if (!busy) void load(cursor) }} />}
      </>}
    {confirm && <ArkmeConfirmDialog titleId="team-content-confirm" title={tr(confirm.change === 'delete' ? '删除团队内容' : '取消公开')} description={confirm.change === 'delete' ? tr('删除后公开内容不可访问，可从已删除中恢复为未公开。') : tr('当前版本有 {v0} 人表态。取消公开后，原文、图片和公开评论将不可访问，表态归档保留。', { v0: confirm.count ?? 0 })} confirmLabel={tr('确认')} busyLabel={tr('处理中…')} busy={busy} onClose={() => setConfirm(undefined)} onConfirm={() => void submit(confirm.item, confirm.change)} />}
  </ArkmeDetailShell>
}
const previewText = { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden', whiteSpace: 'pre-wrap' as const, overflowWrap: 'anywhere' as const, fontSize: 14, lineHeight: '22px' }
const actionStyle = { padding: '5px 8px', border: 0, borderRadius: 6, background: 'transparent', color: c.secondary, cursor: 'pointer', font: 'inherit', fontSize: 13 }

function TeamWorldEditor({ accountKey, context, original, onSaved }: { accountKey: string; context: TeamWorldContext; original: TeamWorldOriginal; onSaved(): void }) {
  const [title, setTitle] = useState(original.title), [text, setText] = useState(original.text)
  const [attachments, setAttachments] = useState<(WorldPublishAttachment & { teamAsset?: TeamWorldAsset })[]>(() => original.assets.map((asset, index) => ({ id: asset.imageRef, teamAsset: asset, asset: { fileAssetUid: asset.imageRef, fileName: `图片 ${index + 1}`, mimeType: asset.mimeType, size: asset.size, fileKind: 1 as const } })))
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const picker = useRef<HTMLInputElement>(null), request = useRef<AbortController>(), urls = useRef<string[]>([])
  const pending = useRef<Extract<TeamWorldRequest, { action: 'submit' }>>()
  const uploaded = useRef(new Map<string, TeamWorldAsset>())
  const [frozen, setFrozen] = useState(false)
  useEffect(() => () => { request.current?.abort(); urls.current.forEach(url => URL.revokeObjectURL(url)) }, [])
  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      for (const asset of original.assets) {
        try {
          const image = await readTeamWorldImage(asset.imageRef, controller.signal)
          if (controller.signal.aborted) return
          const previewUrl = URL.createObjectURL(new Blob([Uint8Array.from(atob(image.dataBase64), char => char.charCodeAt(0))], { type: image.mediaType }))
          urls.current.push(previewUrl)
          setAttachments(current => current.map(item => item.id === asset.imageRef ? { ...item, previewUrl } : item))
        } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : tr('图片暂不可访问')) }
      }
    })()
    return () => controller.abort()
  }, [original.contentRef])
  const add = (selected?: readonly File[]) => {
    if (!selected) { picker.current?.click(); return }
    if (selected.some(file => !['image/png','image/jpeg','image/webp'].includes(file.type) || file.size <= 0 || file.size > 20 << 20) || attachments.length + selected.length > 27) { setError(tr('最多 27 张图片，每张不超过 20MB，支持 PNG、JPEG、WebP')); return }
    setAttachments(current => [...current, ...selected.map(file => { const previewUrl = URL.createObjectURL(file); urls.current.push(previewUrl); return { id: crypto.randomUUID(), file, previewUrl } })])
  }
  const save = async () => {
    if (busy) return
    const controller = new AbortController(); request.current = controller; setBusy(true); setError('')
    try {
      if (!pending.current) {
        const imageRefs: string[] = []
        for (const item of attachments) {
          let asset = item.teamAsset ?? uploaded.current.get(item.id)
          if (!asset) {
            const contentBase64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]!); reader.onerror = () => reject(reader.error); reader.readAsDataURL(item.file!) })
            controller.signal.throwIfAborted()
            asset = await callArkme<TeamWorldAsset>('team.world', { action: 'image-upload', accountKey, teamRef: context.teamRef, contentRef: original.contentRef, contentUid: item.id, uploadUid: item.id, contentBase64, mimeType: item.file!.type }, controller.signal)
            uploaded.current.set(item.id, asset)
          }
          imageRefs.push(asset.imageRef)
        }
        pending.current = { action: 'submit', accountKey, teamRef: context.teamRef, contentRef: original.contentRef, expectedRevision: original.revision, requestUid: crypto.randomUUID(), change: 'edit', draft: { title, text, format: original.format, imageRefs } }
      }
      setFrozen(true)
      const result = await callArkme<TeamWorldReceipt>('team.world', pending.current, controller.signal)
      if (controller.signal.aborted) return
      if (result.pending) { setError(tr('保存结果尚未确认，请重试原操作')); return }
      pending.current = undefined; setFrozen(false); onSaved()
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : tr('保存失败，请重试')) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }

  return <>
    <input aria-label={tr('标题')} value={title} maxLength={100} disabled={busy || frozen} onChange={event => setTitle(event.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: 10, border: `1px solid ${c.borderSoft}`, borderRadius: 8, color: c.text, background: c.base, marginBottom: 12 }} />
    <input ref={picker} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={event => { add(Array.from(event.target.files ?? [])); event.target.value = '' }} />
    <ArkmePublishComposer value={text} onChange={setText} textFormat={original.format} disabled={busy || frozen} actionDisabled={busy} canPublish={!!text.trim() || attachments.length > 0} onPublish={() => void save()} onAdd={add} accountKey={accountKey} identity={<span>{context.name}</span>} destination={tr('编辑团队内容')}
      attachments={<WorldPublishAttachments items={attachments} disabled={busy || frozen} onRemove={id => { const item = attachments.find(value => value.id === id); if (item?.previewUrl) { URL.revokeObjectURL(item.previewUrl); urls.current = urls.current.filter(url => url !== item.previewUrl) }; uploaded.current.delete(id); setAttachments(current => current.filter(value => value.id !== id)) }} onMove={(from, to) => setAttachments(current => { const next = [...current]; const item = next.splice(from, 1)[0]; if (item) next.splice(to, 0, item); return next })} onRetry={() => void save()} />} />
    {error && <p role="alert">{error}</p>}
  </>
}
