import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { arkmeTheme } from '../../arkme-theme.js'
import { codexQuoteNote, codexSelfDelivery } from './codex-message-actions.js'
export interface CodexSelfQuote { text: string; title: string; sender: string; at: number }
export function CodexQuoteToSelf({ quote, userId, signal, onClose, onSent }: { quote: CodexSelfQuote; userId: number; signal: AbortSignal; onClose(): void; onSent(): void }) {
  const [value,setValue]=useState(''), [error,setError]=useState(''), [busy,setBusy]=useState(false), [frozen,setFrozen]=useState(false)
  const saving=useRef(false), delivery=useRef<ReturnType<typeof codexSelfDelivery>>(), panel=useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous=document.activeElement as HTMLElement | null
    panel.current?.querySelector('textarea')?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])
  const send = async () => {
    if (saving.current || !value.trim() || signal.aborted) return
    saving.current=true;setBusy(true);setError('');setFrozen(true)
    delivery.current ??= codexSelfDelivery(userId, codexQuoteNote(value,quote))
    try { await delivery.current(signal); if (!signal.aborted) onSent() }
    catch(e) { if (!signal.aborted) setError(e instanceof Error ? e.message : '发送失败，输入已保留，请重试') }
    finally { saving.current=false;if (!signal.aborted) setBusy(false) }
  }
  return createPortal(<div style={{position:'fixed',inset:0,zIndex:12010,background:'#0005',display:'grid',placeItems:'center'}} onMouseDown={e=>{if(e.target===e.currentTarget&&!busy&&!value)onClose()}}>
    <div ref={panel} role="dialog" aria-modal="true" aria-label="发给自己" style={{width:440,maxWidth:'calc(100vw - 32px)',maxHeight:'80vh',overflowY:'auto',padding:20,boxSizing:'border-box',borderRadius:12,background:arkmeTheme.menu,color:arkmeTheme.text,boxShadow:arkmeTheme.shadow}}
      onKeyDown={e=>{ if(e.key==='Escape'&&!busy&&!e.nativeEvent.isComposing){e.stopPropagation();onClose()} if(e.key==='Tab'){const items=Array.from(panel.current!.querySelectorAll<HTMLElement>('textarea,button:not(:disabled)'));const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}} }}>
      <strong>发给自己</strong>
      <div style={{fontSize:12,color:arkmeTheme.secondary,marginTop:14}}>引用 · Codex · {quote.title}</div>
      <div style={{fontSize:12,color:arkmeTheme.secondary,marginTop:4}}>{quote.sender} · {new Date(quote.at).toLocaleString('zh-CN')}</div>
      <blockquote style={{margin:'8px 0 12px',padding:'8px 12px',borderLeft:`3px solid ${arkmeTheme.accent}`,background:arkmeTheme.layer2,maxHeight:140,overflowY:'auto',whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontSize:13}}>{quote.text}</blockquote>
      <textarea aria-label="写下你的内容" placeholder="写下你的内容…" rows={4} value={value} readOnly={frozen} disabled={busy} maxLength={10000} onChange={e=>setValue(e.target.value)} style={{width:'100%',boxSizing:'border-box',resize:'vertical',minHeight:85,padding:10,font:'inherit',fontSize:14,borderRadius:8,border:`1px solid ${arkmeTheme.border}`,background:arkmeTheme.input,color:arkmeTheme.text}} />
      {error&&<p role="alert" style={{fontSize:12,color:arkmeTheme.danger}}>{error}</p>}
      {frozen&&error&&<p style={{fontSize:12,color:arkmeTheme.secondary}}>重试将发送原内容，避免重复创建。</p>}
      <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:12}}><button type="button" disabled={busy} onClick={onClose} style={button}>取消</button><button type="button" disabled={busy||!value.trim()} onClick={()=>{void send()}} style={{...button,color:arkmeTheme.accent}}>{busy?'发送中…':frozen?'重试发送':'发送'}</button></div>
    </div>
  </div>,document.body)
}
const button={border:0,borderRadius:6,padding:'7px 12px',background:arkmeTheme.layer2,color:arkmeTheme.text,cursor:'pointer'}
