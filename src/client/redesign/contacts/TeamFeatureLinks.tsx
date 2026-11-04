import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from '@phosphor-icons/react/dist/icons/Link'
import { ArrowSquareOut } from '@phosphor-icons/react/dist/icons/ArrowSquareOut'
import { DotsThree } from '@phosphor-icons/react/dist/icons/DotsThree'
import { callArkme } from '../../api.js'
import { arkmeAuthStore } from '../../auth-store.js'
import { ArkmeActionMenu } from '../../ArkmeDshMenu.js'
import { tr } from '../../locale.js'
import { readTeamFeatureLinks, teamFeatureLinkURL, type TeamFeatureLink, type TeamFeatureLinks as Snapshot } from '../../../team-feature-links-contract.js'

type Edit = { kind: 'add' } | { kind: 'edit' | 'delete'; item: TeamFeatureLink }
const account = () => { const auth = arkmeAuthStore.getSnapshot().auth; return auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : '' }
const code = (error: unknown) => (error as { body?: { code?: string }; code?: string })?.body?.code ?? (error as { code?: string })?.code
const denied = (error: unknown) => ['team-not_accessible', 'team-feature_links_forbidden', 'team-account-changed'].includes(code(error) ?? '')
function snapshot(value: Snapshot): Snapshot {
  if (value?.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 || value.maxItems !== 20 || typeof value.canManage !== 'boolean' || !readTeamFeatureLinks(value.items)) throw new Error(tr('团队入口返回异常，请重试'))
  return value
}

export function TeamFeatureLinks({ accountKey, teamRef, children }: { accountKey: string; teamRef: string; children: ReactNode }) {
  return <ScopedLinks key={JSON.stringify([accountKey, teamRef])} accountKey={accountKey} teamRef={teamRef}>{children}</ScopedLinks>
}
function ScopedLinks({ accountKey, teamRef, children }: { accountKey: string; teamRef: string; children: ReactNode }) {
  const [view, setView] = useState<Snapshot>(), [error, setError] = useState(''), [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState<Edit>(), [menu, setMenu] = useState<string>()
  const pending = useRef<AbortController>(), live = useRef(true), valid = useRef(true)
  const load = async () => {
    if (!live.current || !valid.current || account() !== accountKey) return
    pending.current?.abort(); const controller = new AbortController(); pending.current = controller
    setLoading(true)
    try {
      const value = snapshot(await callArkme<Snapshot>('team.app.feature-links.get', { teamRef, expectedAccountKey: accountKey }, controller.signal))
      if (!controller.signal.aborted && live.current && valid.current) { setView(value); setError(''); if (!value.canManage) { setEdit(undefined); setMenu(undefined) } }
    } catch (reason) {
      if (!controller.signal.aborted && live.current) {
        setError(tr('团队入口暂时无法加载'))
        if (denied(reason)) { setView(undefined); setEdit(undefined); setMenu(undefined) }
      }
    } finally { if (!controller.signal.aborted && live.current) setLoading(false) }
  }
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') { setLoading(false); return }
    live.current = true; valid.current = true
    const checkAccount = () => {
      if (account() === accountKey) return
      valid.current = false; pending.current?.abort(); setView(undefined); setEdit(undefined); setMenu(undefined); setLoading(false); setError(tr('登录账号已变化，请重新打开此窗口'))
    }
    const stop = arkmeAuthStore.subscribe(checkAccount)
    checkAccount()
    void load()
    const refresh = () => { if (document.visibilityState === 'visible') void load() }
    window.addEventListener('focus', refresh); window.addEventListener('online', refresh)
    const timer = setInterval(refresh, 60_000)
    return () => { live.current = false; stop(); pending.current?.abort(); clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh) }
  }, [accountKey, teamRef])
  return <div className="arkme-team-features-container">
    <div className="arkme-team-features-heading"><h2>{tr('团队功能')}</h2>
      {view?.canManage && <button type="button" className="arkme-team-action" disabled={view.items.length >= view.maxItems} title={view.items.length >= view.maxItems ? tr('最多添加 20 个团队入口') : undefined} onClick={() => setEdit({ kind: 'add' })}>{tr('＋ 添加入口')}</button>}
    </div>
    <div className="arkme-team-feature-list">{children}{view?.items.map(item => <div className="arkme-team-feature arkme-team-custom-feature" key={item.id}>
      <a href={teamFeatureLinkURL(item.url)} target="_blank" rel="noopener noreferrer" title={item.url} aria-label={tr('打开 {name}', { name: item.name })}>
        <span className="arkme-team-feature-icon" aria-hidden><Link size={22}/></span><span className="arkme-team-custom-feature-copy"><span>{item.name}</span><small>{new URL(item.url).host}</small></span><ArrowSquareOut size={16} aria-hidden/>
      </a>
      {view.canManage && <ArkmeActionMenu label={tr('管理 {name}', { name: item.name })} open={menu === item.id} onClose={() => setMenu(undefined)} actions={[
        { id: 'edit', label: tr('编辑'), onSelect: () => { setMenu(undefined); setEdit({ kind: 'edit', item }) } },
        { id: 'delete', label: tr('删除'), danger: true, onSelect: () => { setMenu(undefined); setEdit({ kind: 'delete', item }) } },
      ]} anchor={<button type="button" className="arkme-team-feature-menu" aria-label={tr('管理 {name}', { name: item.name })} aria-haspopup="menu" aria-expanded={menu === item.id} onClick={() => setMenu(menu === item.id ? undefined : item.id)}><DotsThree size={20}/></button>}/>}
    </div>)}</div>
    {loading && !view && <p className="arkme-team-feature-status" role="status">{tr('正在读取自定义入口…')}</p>}
    {error && <p className="arkme-team-feature-status" role="alert">{error} <button type="button" disabled={loading || !valid.current} onClick={() => { void load() }}>{tr('重试')}</button></p>}
    {edit && view?.canManage && <FeatureLinkEditor key={edit.kind === 'add' ? 'add' : edit.item.id + edit.kind} edit={edit} initial={view} accountKey={accountKey} teamRef={teamRef} onClose={() => setEdit(undefined)} onSaved={value => { if (!live.current || !valid.current || account() !== accountKey) return; pending.current?.abort(); setLoading(false); setView(value); setError(''); setEdit(undefined) }}/>}
  </div>
}

function FeatureLinkEditor({ edit, initial, accountKey, teamRef, onClose, onSaved }: { edit: Edit; initial: Snapshot; accountKey: string; teamRef: string; onClose(): void; onSaved(value: Snapshot): void }) {
  const [base, setBase] = useState(initial), [name, setName] = useState(edit.kind === 'add' ? '' : edit.item.name), [url, setURL] = useState(edit.kind === 'add' ? '' : edit.item.url)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [conflict, setConflict] = useState(false)
  const id = useRef(edit.kind === 'add' ? crypto.randomUUID() : edit.item.id), dialog = useRef<HTMLDialogElement>(null), pending = useRef<AbortController>()
  const command = useRef<{ key: string; requestUid: string }>()
  useLayoutEffect(() => {
    dialog.current?.showModal()
    const stop = arkmeAuthStore.subscribe(() => { if (account() !== accountKey) pending.current?.abort() })
    return () => { stop(); pending.current?.abort() }
  }, [accountKey])
  const reload = async () => {
    if (pending.current || account() !== accountKey) return
    const controller = new AbortController(); pending.current = controller; setBusy(true)
    try {
      const value = snapshot(await callArkme<Snapshot>('team.app.feature-links.get', { teamRef, expectedAccountKey: accountKey }, controller.signal))
      if (controller.signal.aborted) return
      if (!value.canManage) throw new Error(tr('仅团队所有者或管理员可管理团队入口'))
      if (edit.kind !== 'add' && !value.items.some(item => item.id === id.current)) throw new Error(tr('该入口已被删除，请关闭此窗口'))
      setBase(value); setConflict(false); command.current = undefined; setError(tr('已加载最新列表，请核对后保存'))
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? tr(reason.message) : tr('加载失败，请重试')) }
    finally { if (!controller.signal.aborted) { pending.current = undefined; setBusy(false) } }
  }
  const save = async () => {
    if (pending.current || conflict || account() !== accountKey) return
    const target = teamFeatureLinkURL(url)
    if (edit.kind !== 'delete' && (!name.trim() || [...name.trim()].length > 40 || !target)) { setError(tr('请填写名称和有效的 HTTP 或 HTTPS 网址')); return }
    const item = { id: id.current, name: name.trim(), url: target! }
    const items = edit.kind === 'delete' ? base.items.filter(row => row.id !== id.current)
      : edit.kind === 'add' ? [...base.items, item] : base.items.map(row => row.id === id.current ? item : row)
    if (!readTeamFeatureLinks(items)) { setError(tr('请检查入口名称和网址')); return }
    const key = JSON.stringify([base.revision, items])
    if (command.current?.key !== key) command.current = { key, requestUid: crypto.randomUUID() }
    const controller = new AbortController(); pending.current = controller; setBusy(true); setError('')
    try {
      const value = snapshot(await callArkme<Snapshot>('team.app.feature-links.save', { teamRef, expectedAccountKey: accountKey, expectedRevision: base.revision, requestUid: command.current.requestUid, items }, controller.signal))
      if (!controller.signal.aborted && account() === accountKey) onSaved(value)
    } catch (reason) {
      if (!controller.signal.aborted) { setError(reason instanceof Error ? tr(reason.message) : tr('保存失败，请重试')); setConflict(code(reason) === 'team-feature_links_version_conflict' || denied(reason)) }
    } finally { if (!controller.signal.aborted) { pending.current = undefined; setBusy(false) } }
  }
  const title = edit.kind === 'add' ? tr('添加团队入口') : edit.kind === 'edit' ? tr('编辑团队入口') : tr('删除团队入口')
  return <dialog ref={dialog} className="arkme-team-feature-editor" aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <form onSubmit={event => { event.preventDefault(); void save() }}><h3>{title}</h3>
      {edit.kind === 'delete' ? <p>{tr('确认删除“{name}”？团队成员将不再看到此入口。', { name })}</p> : <>
        <label>{tr('名称')}<input aria-label={tr('入口名称')} autoFocus required maxLength={80} value={name} disabled={busy} onChange={event => setName(event.currentTarget.value)}/></label>
        <label>{tr('网址')}<input aria-label={tr('入口网址')} type="url" required maxLength={2048} placeholder="https://" value={url} disabled={busy} onChange={event => setURL(event.currentTarget.value)}/></label>
      </>}
      {error && <p role="alert" className="arkme-team-profile-error">{error}</p>}
      <div className="arkme-team-profile-actions"><button type="button" disabled={busy} onClick={onClose}>{tr('取消')}</button>
        {conflict ? <button type="button" disabled={busy} onClick={() => { void reload() }}>{tr('重新加载')}</button> : <button type="submit" disabled={busy}>{busy ? tr('保存中…') : edit.kind === 'delete' ? tr('确认删除') : tr('保存')}</button>}
      </div>
    </form>
  </dialog>
}
