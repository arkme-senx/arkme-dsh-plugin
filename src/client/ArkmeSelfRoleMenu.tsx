import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconEllipsisOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { ArkmeActionMenu, type ArkmeMenuAction } from './ArkmeDshMenu.js'
import { watchFrameMenuDismissal } from './frame-menu-dismissal.js'

export type SelfRoleMenuAction = ArkmeMenuAction & { managementActions?: readonly ArkmeMenuAction[] }

/** A role selector has two sibling controls per row: selection and management.
 * Keep command menus native; don't nest interactive buttons inside native menu items. */
export function ArkmeSelfRoleMenu({ open, anchor, actions, selectedIds, onClose }: {
  open: boolean
  anchor: ReactNode
  actions: readonly SelfRoleMenuAction[]
  selectedIds: readonly string[]
  onClose(): void
}) {
  const host = useRef<HTMLSpanElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [managedId, setManagedId] = useState('')
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const browser = typeof document !== 'undefined' && typeof document.createElement === 'function'
  useLayoutEffect(() => {
    if (!open) { setManagedId(''); return }
    if (!browser) return
    const doc = host.current!.ownerDocument, win = doc.defaultView!
    const layout = () => {
      const rect = host.current?.getBoundingClientRect(), size = panel.current?.getBoundingClientRect()
      if (!rect || !size) return
      setPosition({ left: Math.max(8, Math.min(rect.right - size.width, win.innerWidth - size.width - 8)),
        top: Math.max(8, rect.top - size.height - 8) })
    }
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node
      if (host.current?.contains(target) || panel.current?.contains(target)) return
      if (target instanceof Element && target.closest('[role="menu"][aria-label="角色操作"]')) return
      onClose()
    }
    layout()
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(layout)
    if (panel.current) resize?.observe(panel.current)
    doc.addEventListener('pointerdown', dismiss, true)
    win.addEventListener('resize', layout)
    doc.addEventListener('scroll', layout, true)
    const stopFrames = watchFrameMenuDismissal(doc, onClose, event => { if (event.key === 'Escape') onClose() })
    return () => {
      resize?.disconnect(); stopFrames()
      doc.removeEventListener('pointerdown', dismiss, true)
      win.removeEventListener('resize', layout)
      doc.removeEventListener('scroll', layout, true)
    }
  }, [open, browser, onClose])
  useLayoutEffect(() => {
    if (open) panel.current?.querySelector<HTMLButtonElement>('[data-role-action]:not(:disabled)')?.focus()
  }, [open])
  const content = open && <div ref={panel} className="arkme-self-role-menu" role="dialog" aria-label="选择发言角色" style={{ ...styles.panel, ...position }}
    onKeyDown={event => {
      const choices = [...(panel.current?.querySelectorAll<HTMLButtonElement>('[data-role-action]:not(:disabled)') ?? [])]
      if (!managedId && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && choices.length) {
        event.preventDefault()
        const index = choices.indexOf(event.target as HTMLButtonElement)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length
        choices[next]?.focus()
      }
      if (event.key === 'Escape' && !managedId) {
        event.preventDefault(); event.stopPropagation(); onClose(); host.current?.querySelector('button')?.focus()
      }
    }}>
    {actions.map(action => {
      if ('type' in action) return action.type === 'separator'
        ? <div key={action.id} role="separator" style={styles.separator} />
        : <div key={action.id} style={styles.note}>{action.text}</div>
      const selected = selectedIds.includes(action.id)
      return <div key={action.id} style={{ ...styles.row, ...(selected ? styles.selected : {}) }}>
        <button type="button" data-role-action={action.id} disabled={action.disabled} aria-pressed={selected}
          style={styles.select} onClick={action.onSelect}>{action.icon}<span style={styles.name}>{action.label}</span></button>
        {action.managementActions && <ArkmeActionMenu open={managedId === action.id} label="角色操作" side="right"
          autoFocus onClose={() => setManagedId('')} actions={action.managementActions}
          anchor={<button type="button" style={styles.manage} aria-label={`管理${String(action.label)}`}
            title="管理角色" aria-haspopup="menu" aria-expanded={managedId === action.id}
            onClick={() => setManagedId(managedId === action.id ? '' : action.id)}><IconEllipsisOutline16 /></button>} />}
      </div>
    })}
  </div>
  return <><style>{`
    .arkme-self-role-menu button { border-radius: 6px; }
    .arkme-self-role-menu button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, #f1f2f4); }
    .arkme-self-role-menu button:disabled { opacity: .4; cursor: default; }
    .arkme-self-role-menu button:focus-visible { outline: 2px solid var(--dsw-alias-label-secondary, #68707c); outline-offset: -2px; }
  `}</style><span ref={host} style={{ display: 'inline-flex' }}>{anchor}</span>{browser && content ? createPortal(content, document.body) : content}</>
}

const styles: Record<string, CSSProperties> = {
  panel: { position: 'fixed', zIndex: 100, width: 248, maxWidth: 'calc(100vw - 16px)', maxHeight: 'calc(100vh - 16px)',
    overflowY: 'auto', boxSizing: 'border-box', padding: 6, borderRadius: 12,
    background: 'var(--dsw-alias-bg-base, #fff)', color: 'var(--dsw-alias-label-primary, #292929)',
    border: '1px solid var(--dsw-alias-border-l1, #e6e8ec)', boxShadow: '0 8px 28px rgba(0,0,0,.12)' },
  row: { display: 'flex', alignItems: 'center', borderRadius: 8, minHeight: 40 },
  selected: { background: 'var(--dsw-alias-bg-active, #eef0f3)' },
  select: { flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 8px',
    border: 0, background: 'transparent', color: 'inherit', font: 'inherit', fontSize: 13, textAlign: 'left', cursor: 'pointer' },
  name: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  manage: { display: 'grid', placeItems: 'center', width: 32, height: 32, border: 0, borderRadius: 6,
    background: 'transparent', color: 'var(--dsw-alias-label-secondary, #68707c)', cursor: 'pointer' },
  separator: { height: 1, margin: '4px 6px', background: 'var(--dsw-alias-border-l1, #e6e8ec)' },
  note: { padding: 8, fontSize: 12, color: 'var(--dsw-alias-label-secondary, #68707c)' },
}
