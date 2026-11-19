import { useEffect, useRef, useState } from 'react'
import { BookmarkSimple } from '@phosphor-icons/react/dist/icons/BookmarkSimple'
import type { RecordingFavoriteStatus } from '../recording-favorite-contract.js'
import { recordingFavorites, favoriteChanges, useFavoriteAccount } from './recording-favorite-client.js'
import { arkmeTheme as theme } from './arkme-theme.js'
import { ArkmeConfirmDialog } from './ArkmeConfirmDialog.js'
import { tr } from './locale.js'

export function RecordingFavoriteAction({ sid }: { sid: string }) {
  const { accountKey } = useFavoriteAccount()
  return accountKey ? <ScopedAction key={`${accountKey}:${sid}`} accountKey={accountKey} sid={sid} /> : null
}
function ScopedAction({ sid, accountKey }: { sid: string; accountKey: string }) {
  const [status, setStatus] = useState<RecordingFavoriteStatus>(), [error, setError] = useState(''), [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false)
  const lifetime = useRef(new AbortController())
  const read = async () => {
    const result = await recordingFavorites({ action: 'status', sid, accountKey }, lifetime.current.signal)
    setStatus(result); return result
  }
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller
    const refresh = () => { void read().catch(error => { if (!controller.signal.aborted) { setStatus(undefined); setError(String(error.message ?? error)) } }) }
    refresh()
    const release = favoriteChanges.subscribe(account => { if (account === accountKey) refresh() })
    return () => { release(); controller.abort() }
  }, [sid, accountKey])
  const change = async () => {
    if (!status || busy) return
    setBusy(true); setError('')
    try {
      const result = status.saved && status.favoriteRef
        ? await recordingFavorites({ action: 'remove', accountKey, favoriteRef: status.favoriteRef, expectedVersion: status.version }, lifetime.current.signal)
        : await recordingFavorites({ action: 'save', accountKey, sid, expectedVersion: status.version }, lifetime.current.signal)
      setStatus(result); setConfirm(false); favoriteChanges.publish(accountKey)
    } catch (error) {
      if (!lifetime.current.signal.aborted) {
        setError(error instanceof Error ? error.message : tr('操作失败，请重试'))
        setConfirm(false); setStatus(undefined)
        try { await read() } catch { /* Keep writes disabled until status is known. */ }
      }
    } finally { if (!lifetime.current.signal.aborted) setBusy(false) }
  }
  return <div style={{ padding: '12px 20px', borderBottom: `1px solid ${theme.borderSoft}`, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
    <button type="button" aria-pressed={status?.saved ?? false} disabled={busy || !status || !status.available && !status.saved} onClick={() => status?.saved ? setConfirm(true) : void change()}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 12px', border: `1px solid ${theme.border}`, borderRadius: 8, background: status?.saved ? theme.layer2 : theme.base, color: theme.text, font: 'inherit', fontSize: 13, cursor: 'pointer' }}>
      <BookmarkSimple size={16} weight={status?.saved ? 'fill' : 'regular'} />{tr(busy ? '处理中…' : status?.saved ? '已收藏' : '收藏录音')}
    </button>
    {status?.saved && <span style={{ color: theme.secondary, fontSize: 12 }}>{tr('已保存到「我收藏的录音」')}</span>}
    {error && <span role="alert" style={{ fontSize: 12 }}>{error} {!status && <button type="button" onClick={() => { void read().then(() => setError('')).catch(error => setError(error.message)) }}>{tr('重试')}</button>}</span>}
    {confirm && <ArkmeConfirmDialog titleId="recording-unfavorite" title={tr('取消收藏？')} description={tr('取消后将从你的收藏列表移除。分享者的历史通知仍保留，且仍可播放。')} confirmLabel={tr('取消收藏')} busyLabel={tr('处理中…')} busy={busy} onClose={() => setConfirm(false)} onConfirm={() => { void change() }} />}
  </div>
}
