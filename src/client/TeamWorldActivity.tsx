import { WorldManagementStyles, WorldEmpty, worldManagementTime, TeamWorldContentPreview } from './world-management-ui.js'
import { ClockCounterClockwise } from '@phosphor-icons/react/dist/icons/ClockCounterClockwise'
import { ArrowClockwise } from '@phosphor-icons/react/dist/icons/ArrowClockwise'
import { WorldPreviewImages } from './WorldPreviewImages.js'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { TeamWorldActivity as Activity, TeamWorldOriginal } from '../team-world-contract.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { ArkmeDetailShell } from './ArkmeDetailShell.js'

import { tr } from './locale.js'

export function TeamWorldActivity({ onClose }: { onClose(): void }) {
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot).auth
  const accountKey = auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : ''
  return <ArkmeDetailShell title={tr('我的团队操作')} label={tr('团队发布活动')} onClose={onClose}>
    {accountKey ? <TeamWorldActivityContent key={accountKey} accountKey={accountKey} /> : <p>{tr('请先登录')}</p>}
  </ArkmeDetailShell>
}

export function TeamWorldActivityContent({ accountKey }: { accountKey: string }) {
  const [items, setItems] = useState<Activity[]>([]), [cursor, setCursor] = useState<string>()
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [original, setOriginal] = useState<TeamWorldOriginal>(), [image, setImage] = useState<string>()
  const request = useRef<AbortController>()
  const load = async (more = false) => {
    request.current?.abort(); const c = new AbortController(); request.current = c; setBusy(true); setError(''); setItems([])
    try {
      const page = await callArkme<{ items: Activity[]; hasMore: boolean; nextCursor?: string }>('team.world', { action: 'activity', accountKey, limit: 20, ...(more && cursor ? { cursor } : {}) }, c.signal)
      if (!c.signal.aborted) { setItems(page.items); setCursor(page.nextCursor) }
    } catch (e) { if (!c.signal.aborted) { setItems([]); setCursor(undefined); setError(e instanceof Error ? e.message : tr('活动读取失败')) } }
    finally { if (!c.signal.aborted) setBusy(false) }
  }
  useEffect(() => { void load(); return () => request.current?.abort() }, [accountKey])
  useEffect(() => { const clear = () => { setOriginal(undefined); setImage(undefined); void load() }; window.addEventListener('focus', clear); return () => window.removeEventListener('focus', clear) }, [accountKey])
  const open = async (item: Activity) => {
    request.current?.abort(); const c = new AbortController(); request.current = c
    setBusy(true); setError(''); setOriginal(undefined); setImage(undefined)
    try {
      const current = await callArkme<TeamWorldOriginal>('team.world', { action: 'original', accountKey, contentRef: item.contentRef }, c.signal)
      if (!c.signal.aborted) setOriginal(current)
    } catch (e) { if (!c.signal.aborted) { setItems(items => items.map(({ preview: _preview, ...item }) => item)); setError(e instanceof Error ? e.message : tr('当前没有查看团队原稿的权限')) } }
    finally { if (!c.signal.aborted) setBusy(false) }
  }
  const action = { publish: '发布', edit: '编辑', unpublish: '撤回公开', delete: '删除', restore: '恢复' }
  const visibility = { published: '已公开', pending: '待审核', rejected: '审核未通过', unpublished: '未公开', deleted: '已删除' }
  if (original) return <div className="wm"><WorldManagementStyles /><button className="wm-button" data-kind="quiet" type="button" onClick={() => { setOriginal(undefined); setImage(undefined) }}>{tr('返回团队操作')}</button>
    <section className="wm-card" style={{ marginTop:20 }} aria-label={tr('当前团队原稿')}><h3 className="wm-title">{original.title || tr('团队内容')}</h3><p className="wm-card-body">{original.text}</p>
      <WorldPreviewImages imageRefs={original.assets.map(asset => asset.imageRef)} detail />
    </section>
  </div>
  return <section className="wm"><WorldManagementStyles />
    <p className="wm-muted" style={{ marginTop:0, marginBottom:20 }}>{tr('你代表团队完成的操作，点击查看详情。')}</p>
    <button className="wm-button wm-icon-button" data-kind="quiet" aria-label={tr('刷新')} title={tr('刷新')} type="button" disabled={busy} onClick={() => { setOriginal(undefined); setImage(undefined); void load() }}><ArrowClockwise size={17} /></button>
    {busy && <p className="wm-notice" role="status">{tr('正在读取…')}</p>}{error && <p className="wm-notice" role="alert">{error}</p>}
    {items.map(item => <div className="wm-activity-row" role="button" tabIndex={0} onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); if (!busy) void open(item) } }} key={item.requestUid} aria-disabled={busy} aria-label={tr('查看当前原稿')} onClick={() => { if (!busy) void open(item) }}>
      <span className="wm-spread"><strong className="wm-title">{item.preview?.title || item.preview?.text || tr('团队操作')}</strong><time className="wm-caption">{worldManagementTime(item.acceptedAt)}</time></span>
      <span className="wm-content-preview">{item.preview?.teamName || tr('团队')} · {tr(action[item.action])}</span>
      <TeamWorldContentPreview preview={item.preview} />
      {item.preview && <WorldPreviewImages imageRefs={item.preview.imageRefs ?? []} />}
      <span className="wm-caption">{tr('当时结果')}：{tr(item.result ? visibility[item.result.visibility] : '处理中')}</span>
    </div>)}
    {cursor && <button className="wm-button" type="button" disabled={busy} onClick={() => void load(true)}>{tr('下一页')}</button>}
    {!busy && !error && !items.length && <WorldEmpty icon={<ClockCounterClockwise size={24} />} title={tr('暂无团队操作')} />}

  </section>
}
