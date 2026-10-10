import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { X } from '@phosphor-icons/react/dist/icons/X'
import type { ArkmeWorldFeedItem } from '../types.js'
import { createArkmeSdk } from '../sdk/index.js'
import { WorldCard } from './ArkmeWorldSurface.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr, useArkmeLocale } from './locale.js'

const sdk = createArkmeSdk()
function detailCard(item: ArkmeWorldFeedItem): ArkmeWorldFeedItem {
  const { authorRef: _authorRef, ...card } = item
  return card
}

/** Mobile-style publication entry. Full content is fetched only after an explicit open. */
export function ArkmeTimelinePublicNote({ recordRef, authorName, isGroup = false }: { recordRef: string; authorName: string; isGroup?: boolean }) {
  useArkmeLocale()
  const [open, setOpen] = useState(false)
  return <>
    <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 18px' }}>
      <button type="button" aria-label={tr('查看{v0}的公开快记', { v0: authorName })} onClick={() => setOpen(true)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%', border: 0, borderRadius: 12, padding: '6px 8px', background: 'transparent', color: arkmeTheme.secondary, cursor: 'pointer', font: 'inherit', fontSize: 13 }}>
        <span aria-hidden>✨</span><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{isGroup ? <><strong>{authorName}</strong> {tr('的世界有更新')}</> : tr('对方发布了一条新的公开快记')}</span><CaretRight size={16} aria-hidden />
      </button>
    </div>
    {open && <PublicNoteDialog key={recordRef} recordRef={recordRef} onClose={() => setOpen(false)} />}
  </>
}

function PublicNoteDialog({ recordRef, onClose }: { recordRef: string; onClose(): void }) {
  const [item, setItem] = useState<ArkmeWorldFeedItem>()
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [comments, setComments] = useState(true)
  const dialog = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const controller = new AbortController()
    setError(''); setItem(undefined)
    void sdk.readWorldRecord(recordRef, controller.signal).then(value => {
      if (!controller.signal.aborted) setItem(value)
    }).catch(caught => {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : tr('公开快记暂不可用'))
    })
    return () => controller.abort()
  }, [recordRef, revision])
  useEffect(() => {
    const previous = document.activeElement
    dialog.current?.focus({ preventScroll: true })
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  return createPortal(<div style={{ position: 'fixed', inset: 0, zIndex: 950, background: 'rgba(0,0,0,.3)', display: 'grid', placeItems: 'center', padding: 24 }}
    onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-label={tr('公开快记详情')} tabIndex={-1}
      style={{ background: arkmeTheme.base, color: arkmeTheme.text, width: 680, maxWidth: '100%', maxHeight: 'calc(100dvh - 48px)', overflowY: 'auto', borderRadius: 16, boxShadow: arkmeTheme.shadow }}
      onKeyDown={event => {
        if (event.target instanceof Element && event.target.closest('[aria-modal="true"]') !== dialog.current) return
        event.stopPropagation()
        // The shared image viewer owns Escape while it is open.
        if (dialog.current?.querySelector('[data-world-image-preview-zoomed]')) return
        if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); onClose() }
        if (event.key === 'Tab') {
          const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],textarea,input,[tabindex="0"]')
          const first = controls?.[0], last = controls?.[controls.length - 1]
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus() }
          else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first?.focus() }
        }
      }}>
      <header style={{ display: 'flex', alignItems: 'center', padding: '12px 20px', borderBottom: `1px solid ${arkmeTheme.borderSoft}` }}>
        <strong>{tr('公开快记')}</strong><button type="button" aria-label={tr('关闭公开快记详情')} onClick={onClose} style={{ marginLeft: 'auto', border: 0, background: 'transparent', color: arkmeTheme.text, padding: 6, cursor: 'pointer' }}><X size={20} /></button>
      </header>
      {error ? <div role="alert" style={{ padding: 24 }}>{error}<button type="button" onClick={() => setRevision(value => value + 1)}>{tr('重试')}</button></div>
        : item === undefined ? <div role="status" style={{ padding: 24 }}>{tr('正在加载公开快记…')}</div>
          : <WorldCard item={detailCard(item)} playable={false} voiceprintActive={false} voiceprintLoading={false} interactionsOpen={comments}
            onOpenInteractions={() => setComments(value => !value)} onInteractionCreated={() => {}} onToggleVoiceprint={() => {}} />}
    </div>
  </div>, document.body)
}
