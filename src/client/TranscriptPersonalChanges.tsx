import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { PersonalTranscriptEntry, TranscriptViewSavedPage } from '../transcript-view-contract.js'
import { ArkmeConfirmDialog } from './ArkmeConfirmDialog.js'
import { ArkmeRightPanelHeader } from './ArkmeRightPanelHeader.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeTheme } from './arkme-theme.js'
import { copyText } from './clipboard-text.js'
import { tr, useArkmeLocale } from './locale.js'
import { withArkmeReadDeadline } from './read-deadline.js'

const buttonStyle = {
  border: '1px solid ' + arkmeTheme.border, borderRadius: 8, padding: '7px 12px',
  background: arkmeTheme.base, color: arkmeTheme.text, cursor: 'pointer', font: 'inherit', fontSize: 12,
}
const bodyStyle = {
  padding: '16px 22px 22px', overflowY: 'auto' as const,
  maxHeight: 'min(520px, calc(100dvh - 150px))', fontSize: 13, lineHeight: 1.65,
}
function TranscriptWords({ text }: { text: string }) {
  // Comparison and saved views show the stored wording, including literal URLs.
  return <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
    {text}
  </div>
}
function OriginalWords({ text }: { text: string }) {
  return <details style={{ marginTop: 12, color: arkmeTheme.secondary }}>
    <summary style={{ cursor: 'pointer', fontSize: 12 }}>{tr('查看原文')}</summary>
    <div style={{ marginTop: 8 }}><TranscriptWords text={text} /></div>
  </details>
}

/** Saved views belong to one explicit source, not to a sentence's revision history. */
export function TranscriptPersonalChanges({ sourceRef, onClose, onFailure }: {
  sourceRef: string
  onClose(): void
  onFailure?(error: unknown): void
}) {
  useArkmeLocale()
  const titleId = useId()
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot).auth
  const account = auth?.status === 'authenticated' ? auth.environment + ':' + auth.userId : ''
  const key = JSON.stringify([account, sourceRef]), currentKey = useRef(key)
  currentKey.current = key
  const [page, setPage] = useState<{ key: string; rows: TranscriptViewSavedPage['items']; cursor: string }>({ key, rows: [], cursor: '' })
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [copyError, setCopyError] = useState('')
  const lifetime = useRef<AbortController>(), pending = useRef(false)
  const load = async (after = '', signal = lifetime.current?.signal) => {
    if (!account || signal?.aborted || pending.current) return
    pending.current = true
    setBusy(true); setError('')
    try {
      const result = await withArkmeReadDeadline(
        child => callArkme<TranscriptViewSavedPage>('transcript.views.saved', { accountKey: account, ref: sourceRef, after }, child),
        signal,
      )
      if (signal?.aborted || currentKey.current !== key) return
      setPage(old => ({
        key,
        rows: [...new Map([...(after && old.key === key ? old.rows : []), ...result.items].map(row => [row.segment_uid, row])).values()],
        cursor: result.next_cursor,
      }))
    } catch (caught) {
      if (signal?.aborted || currentKey.current !== key) return
      const body = (caught as { body?: { code?: string; httpStatus?: number } })?.body
      if (body?.code === 'transcript-source-unavailable' || body?.code === 'transcript-account-changed' || [401, 403].includes(body?.httpStatus ?? 0)) {
        setPage({ key, rows: [], cursor: '' }); setCopyError('')
      }
      setError(caught instanceof Error ? caught.message : tr('读取失败，请重试'))
      onFailure?.(caught)
    } finally {
      if (!signal?.aborted && currentKey.current === key) { pending.current = false; setBusy(false) }
    }
  }
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller; pending.current = false
    setPage({ key, rows: [], cursor: '' }); setError(''); setCopyError('')
    void load('', controller.signal)
    return () => controller.abort()
  }, [key])
  if (!account) return null
  // A restored view remains durable for receipts; it is no longer a user change.
  const rows = page.key === key ? page.rows.filter(row => row.text !== row.original || row.marks.length > 0) : []
  const cursor = page.key === key ? page.cursor : ''
  return <ArkmeConfirmDialog layout="picker" titleId={titleId} title={tr('我的修改')}
    busy={busy} closeWhileBusy onClose={onClose} dialogStyle={{ width: 'min(560px, 100%)', overflow: 'hidden' }}>
    <ArkmeRightPanelHeader title={tr('我的修改')} subtitle={tr('更正和标记仅自己可见')} onClose={onClose} closeLabel={tr('关闭我的修改')} />
    <div style={bodyStyle} aria-busy={busy}>
      {rows.map(row => <article key={row.segment_uid} data-transcript-personal-change
        style={{ padding: 14, marginBottom: 12, border: '1px solid ' + arkmeTheme.borderSoft, borderRadius: 12, background: arkmeTheme.layer1 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
          <strong style={{ fontSize: 12 }}>{row.text !== row.original ? tr('文字更正') : tr('文字标记')}</strong>
          <button type="button" style={buttonStyle} onClick={() => {
            const signal = lifetime.current?.signal
            void copyText(row.text).then(() => { if (!signal?.aborted && currentKey.current === key) setCopyError('') },
              caught => { if (!signal?.aborted && currentKey.current === key) setCopyError(caught instanceof Error ? caught.message : tr('复制失败，请重试')) })
          }}>{tr('复制文字')}</button>
        </div>
        <TranscriptWords text={row.text} />
        {row.text !== row.original && <OriginalWords text={row.original} />}
        {row.marks.length > 0 && <div style={{ marginTop: 12 }}>
          <div style={{ color: arkmeTheme.secondary, fontSize: 12 }}>{tr('标记的文字')}</div>
          {row.marks.map(mark => <blockquote key={mark.id} style={{ margin: '6px 0 0', paddingLeft: 10, borderLeft: '2px solid ' + arkmeTheme.border, overflowWrap: 'anywhere' }}>
            <TranscriptWords text={mark.anchor.text} />
            {mark.state === 'stale' && <small style={{ color: arkmeTheme.secondary }}>{tr('对应的文字已有变化')}</small>}
          </blockquote>)}
        </div>}
      </article>)}
      {!rows.length && !busy && !error && !cursor && <p style={{ color: arkmeTheme.secondary }}>{tr('还没有更正或标记')}</p>}
      {busy && <p role="status" style={{ color: arkmeTheme.secondary }}>{tr('正在读取…')}</p>}
      {error && <div role="alert"><p>{error}</p><button type="button" style={buttonStyle} disabled={busy} onClick={() => { void load(cursor) }}>{tr('重试')}</button></div>}
      {copyError && <p role="alert">{copyError}</p>}
      {cursor && !error && <button type="button" style={buttonStyle} disabled={busy} onClick={() => { void load(cursor) }}>{tr('查看更多')}</button>}
    </div>
  </ArkmeConfirmDialog>
}

/** Compare the selected live row locally; never fetch the source list as row history. */
export function TranscriptCorrectionDetails({ entry, onRestore, onClose }: {
  entry: Pick<PersonalTranscriptEntry, 'original' | 'text'>
  onRestore(signal: AbortSignal): Promise<unknown>
  onClose(): void
}) {
  useArkmeLocale()
  const titleId = useId()
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const pending = useRef(false), lifetime = useRef<AbortController>()
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller
    return () => controller.abort()
  }, [])
  const restore = async () => {
    const signal = lifetime.current?.signal
    if (!signal || signal.aborted || pending.current) return
    pending.current = true; setBusy(true); setError('')
    try { await onRestore(signal); if (!signal.aborted) onClose() }
    catch (caught) { if (!signal.aborted) setError(caught instanceof Error ? caught.message : tr('恢复失败，请重试')) }
    finally { pending.current = false; if (!signal.aborted) setBusy(false) }
  }
  return <ArkmeConfirmDialog layout="picker" titleId={titleId} title={tr('这段文字的更正')} busy={busy} onClose={onClose}
    dialogStyle={{ width: 'min(520px, 100%)', overflow: 'hidden' }}>
    <ArkmeRightPanelHeader title={tr('这段文字的更正')} subtitle={tr('仅自己可见')}
      onClose={onClose} closeDisabled={busy} closeLabel={tr('关闭更正详情')} />
    <div style={bodyStyle}>
      <div style={{ marginBottom: 16 }}><div style={{ color: arkmeTheme.secondary, fontSize: 12, marginBottom: 6 }}>{tr('原文')}</div><TranscriptWords text={entry.original} /></div>
      <div style={{ padding: 12, borderRadius: 10, background: arkmeTheme.layer1 }}>
        <div style={{ color: arkmeTheme.secondary, fontSize: 12, marginBottom: 6 }}>{tr('我的更正')}</div>
        <TranscriptWords text={entry.text} />
      </div>
      {error && <p role="alert">{error}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
        <button type="button" style={buttonStyle} disabled={busy} onClick={() => { void restore() }}>{busy ? tr('正在恢复…') : tr('恢复原文')}</button>
      </div>
    </div>
  </ArkmeConfirmDialog>
}
