import { useEffect, useRef, useState } from 'react'
import { FileText } from '@phosphor-icons/react/dist/icons/FileText'
import { ArkmeComposerSendButton } from './ArkmeComposerSendButton.js'
import { X } from '@phosphor-icons/react/dist/icons/X'
import type { ArkmeArrangementItem } from '../types.js'
import { callArkme } from './api.js'
import { tr } from './locale.js'
import { withArkmeReadDeadline } from './read-deadline.js'

type Draft = { texts: string[]; input: string; requestId: string; fingerprint: string }
const empty = (): Draft => ({ texts: [], input: '', requestId: '', fingerprint: '' })
function readDraft(key: string): Draft {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? 'null')
    if (value && Array.isArray(value.texts) && value.texts.every((v: unknown) => typeof v === 'string') && ['input','requestId','fingerprint'].every(k => typeof value[k] === 'string')) return value
  } catch { /* Session-only draft storage may be unavailable. */ }
  return empty()
}
export function useCreatedArrangements() {
  const [items, setItems] = useState<ArkmeArrangementItem[]>([])
  const [notice, setNotice] = useState('')
  const [revision, setRevision] = useState(0)
  const merge = (incoming: ArkmeArrangementItem[]) => setItems(previous => [...new Map([...previous, ...incoming].map(item => [item.arrangementRef, item])).values()])
  const refs = items.filter(item => item.recognitionState === 'recognizing').map(item => item.arrangementRef)
  const key = JSON.stringify(refs)
  useEffect(() => {
    if (!refs.length) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    const check = async () => {
      try {
        const result = await withArkmeReadDeadline(signal => callArkme<{items: ArkmeArrangementItem[]}>('arrangements.recognition', {arrangementRefs: refs}, signal), controller.signal)
        if (controller.signal.aborted) return
        if (!result.items.length) { setNotice(tr('安排已不可访问，请刷新确认。')); return }
        merge(result.items)
        if (!result.items.some(item => item.recognitionState === 'recognizing')) { setNotice(''); return }
        if (++attempts >= 10) { setNotice(tr('安排已保存，AI识别尚未结束，可稍后更新结果。')); return }
        timer = setTimeout(() => { void check() }, Math.min(15000, 2000 * 2 ** attempts))
      } catch {
        if (!controller.signal.aborted) setNotice(tr('安排已保存，暂未获取识别结果，请稍后重试。'))
      }
    }
    setNotice('')
    timer = setTimeout(() => { void check() }, 2000)
    return () => { controller.abort(); clearTimeout(timer) }
    // The identity set, rather than each title update, owns the bounded read cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, revision])
  return { items, merge, notice, retry: () => setRevision(value => value + 1) }
}

export function ArkmeArrangementCreate({ accountScope, open, onClose, onSaved }: {
  accountScope: string; open: boolean; onClose(): void; onSaved(items: ArkmeArrangementItem[]): void
}) {
  const key = `arkme:arrangement-create:${accountScope}`
  const [draft, setDraft] = useState(() => readDraft(key))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  const panel = useRef<HTMLElement>(null)
  const messages = useRef<HTMLDivElement>(null)
  const inFlight = useRef(false)
  const lifetime = useRef<AbortController>()
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => controller.abort() }, [])
  useEffect(() => { try { sessionStorage.setItem(key, JSON.stringify(draft)) } catch {} }, [key, draft])
  useEffect(() => {
    if (!open) return
    const previous = typeof document !== 'undefined' ? document.activeElement : null
    input.current?.focus()
    return () => { if (typeof HTMLElement !== 'undefined' && previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [open])
  useEffect(() => {
    const node = input.current
    if (!open || !node) return
    node.style.height = 'auto'
    node.style.height = `${Math.min(160, Math.max(28, node.scrollHeight))}px`
  }, [open, draft.input])
  useEffect(() => {
    const node = messages.current
    if (open && node) node.scrollTop = node.scrollHeight
  }, [open, draft.texts.length])
  const validation = (texts: string[]) => texts.length > 10 || texts.some(text => [...text].length > 500) || texts.reduce((n,text) => n + [...text].length,0) > 2000
  function send() {
    const text = draft.input.trim()
    if (!text || saving) return
    const texts = [...draft.texts, text]
    if (validation(texts)) { setError(tr('最多输入10条，每条500字，总计2000字')); return }
    setDraft({ ...draft, texts, input: '' }); setError(''); input.current?.focus()
  }
  async function finish() {
    if (inFlight.current || !accountScope) return
    const texts = [...draft.texts, ...(draft.input.trim() ? [draft.input.trim()] : [])]
    if (!texts.length || validation(texts)) { setError(tr('最多输入10条，每条500字，总计2000字')); return }
    const fingerprint = JSON.stringify(texts)
    const requestId = draft.fingerprint === fingerprint && draft.requestId ? draft.requestId : crypto.randomUUID()
    const submission = {...draft,requestId,fingerprint}
    setDraft(submission)
    // Persist identity before sending; ambiguous retries must address the same root.
    try { sessionStorage.setItem(key, JSON.stringify(submission)) } catch {}
    const signal = lifetime.current!.signal
    inFlight.current = true; setSaving(true); setError('')
    try {
      const result = await withArkmeReadDeadline(requestSignal => callArkme<{items: ArkmeArrangementItem[]}>('arrangements.create', { requestId, texts }, requestSignal), signal)
      if (signal.aborted) return
      if (!result.items.length) throw Error('Missing saved arrangement')
      onSaved(result.items)
      setDraft(empty()); try { sessionStorage.removeItem(key) } catch {}
      onClose()
    } catch {
      if (!signal.aborted) setError(tr('未能确认创建结果，输入已保留；重试不会重复创建。'))
    } finally {
      if (!signal.aborted) { inFlight.current = false; setSaving(false) }
    }
  }
  if (!open) return null
  return <div className="arkme-arrangement-create-overlay" onClick={event => { if (event.target === event.currentTarget && !saving) onClose() }}>
    <aside ref={panel} role="dialog" aria-modal="true" aria-busy={saving} aria-label={tr('添加安排')} className="arkme-arrangement-create" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!saving) onClose() }
      if (event.key === 'Tab') {
        const nodes = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled)')
        const first = nodes?.[0], last = nodes?.[nodes.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }}>
      <header><h2>{tr('添加安排')}</h2><button type="button" aria-label={tr('关闭')} disabled={saving} onClick={onClose}><X size={20} aria-hidden /></button></header>
      <div ref={messages} className="arkme-arrangement-create-messages" aria-label={tr('待创建的安排内容')}>
        {!draft.texts.length && <p>{tr('输入想做的事，完成后先保存，再由AI识别安排。')}</p>}
        {draft.texts.map((text,index) => <div className="arkme-arrangement-create-message" key={index}><span>{text}</span><button type="button" aria-label={tr('移除此条内容')} disabled={saving} onClick={() => setDraft({...draft,texts:draft.texts.filter((_,i)=>i!==index)})}><X size={14} aria-hidden /></button></div>)}
      </div>
      <footer>
        {error && <p role="alert">{error}</p>}
        <div className="arkme-arrangement-create-input"><FileText className="arkme-arrangement-create-input-icon" size={20} aria-hidden /><textarea ref={input} aria-label={tr('输入安排内容')} placeholder={tr('输入安排内容…')} value={draft.input} disabled={saving} rows={1} onChange={event => setDraft({...draft,input:event.target.value})} onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); send() }
        }} /><ArkmeComposerSendButton style={{ transform: 'none' }} ariaLabel={tr('发送')} disabled={saving || !draft.input.trim()} onClick={send} /></div>
        <button type="button" className="arkme-arrangement-create-finish" data-arkme-hover="none" disabled={saving || !accountScope || !draft.texts.length && !draft.input.trim()} onClick={() => { void finish() }}>{saving ? tr('正在创建…') : tr('完成')}</button>
      </footer>
    </aside>
  </div>
}
