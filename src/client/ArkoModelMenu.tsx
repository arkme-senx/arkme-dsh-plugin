import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check'
import type { ArkmeArkoModelCatalog } from '../types.js'
import { tr } from './locale.js'
import css from './arkme-model-select.css?inline'

export function ArkoModelMenu({ anchor, catalog, busy, error, onSelect, onClose }: {
  anchor: HTMLButtonElement
  catalog: ArkmeArkoModelCatalog
  busy: boolean
  error: string
  onSelect: (routeKey: string) => Promise<boolean>
  onClose: () => void
}) {
  const menu = useRef<HTMLDivElement>(null)
  const mounted = useRef(false)
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' })
  const close = (focus = false) => { onClose(); if (focus) anchor.focus() }
  useLayoutEffect(() => {
    mounted.current = true
    const place = () => {
      const rect = anchor.getBoundingClientRect()
      const width = Math.min(320, window.innerWidth - 24)
      const above = rect.top - 20
      const below = window.innerHeight - rect.bottom - 20
      const upwards = above >= Math.min(400, menu.current?.scrollHeight ?? 400) || above >= below
      setPosition({
        position: 'fixed', width, minWidth: 0, maxWidth: width, zIndex: 1100,
        left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)), right: 'auto',
        ...(upwards ? { bottom: window.innerHeight - rect.top + 8, top: 'auto' } : { top: rect.bottom + 8, bottom: 'auto' }),
        maxHeight: Math.max(40, Math.min(400, upwards ? above : below)),
      })
    }
    place()
    const outside = (event: Event) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target) && !anchor.contains(event.target)) onClose()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', outside)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      mounted.current = false
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('focusin', outside)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchor, onClose])
  useLayoutEffect(() => {
    if (position.visibility !== 'hidden') {
      if (busy) menu.current?.focus()
      else menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
    }
  }, [position.visibility, busy])
  const keyboard = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
    if (!items.length) return
    event.preventDefault()
    event.stopPropagation()
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  }
  return createPortal(<>
    <style>{css}</style>
    <div ref={menu} className="arkme-model-menu" style={position} role="menu" tabIndex={-1} aria-label={tr('模型选择')} aria-busy={busy} onKeyDown={keyboard}>
      {catalog.options.map(option => {
        const selected = option.routeKey === catalog.effectiveRouteKey
        return <button key={option.routeKey} type="button" className="arkme-model-option" role="menuitemradio"
          aria-checked={selected} disabled={busy} onClick={() => {
            if (selected) { close(true); return }
            void onSelect(option.routeKey).then(success => { if (success && mounted.current) close(true) })
          }}>
          <span>{option.displayName}{option.description && <small>{option.description}</small>}</span>
          {selected && <CheckIcon size={18} style={{ flex: 'none' }} aria-hidden />}
        </button>
      })}
      {busy && <div className="arkme-model-status" role="status">{tr('正在切换模型')}</div>}
      {error && <div className="arkme-model-error" role="alert">{error}</div>}
    </div>
  </>, document.body)
}
