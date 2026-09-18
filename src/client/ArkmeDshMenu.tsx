import {
  IconCheckOutline16, IconEllipsisOutline16, IconPersonalizationOutline16, Menu, Tooltip, type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import { watchFrameMenuDismissal } from './frame-menu-dismissal.js'

function isSeparator(entry: MenuEntry): entry is Extract<MenuEntry, { type: 'separator' }> {
  return 'type' in entry && entry.type === 'separator'
}

function isLabel(entry: MenuEntry): entry is Extract<MenuEntry, { type: 'label' }> {
  return 'type' in entry && entry.type === 'label'
}

/** Same recipe as DSH's SessionNodeItem: default-sized, portaled native Menu. */
export function ArkmeDshRowActionsMenu(props: {
  open: boolean
  label: string
  items: readonly MenuEntry[]
  onSelect(id: string): void
  onClose(): void
  onToggle(): void
}) {
  return <ArkmeDshMenu
    open={props.open} label={props.label} items={props.items}
    onSelect={props.onSelect} onClose={props.onClose} portal closeOnPointerLeave
    anchor={<button type="button" className="arkme-dsh-row-actions-button"
      title="主题操作" aria-label={props.label} aria-haspopup="menu" aria-expanded={props.open}
      onClick={event => { event.stopPropagation(); props.onToggle() }}
    ><IconEllipsisOutline16 /></button>}
  />
}

/**
 * Use the host's native DSH menu in browsers. The lightweight branch only keeps
 * server-side rendering and React's document-less renderer safe; production
 * interaction and styling always come from the shared primitive.
 */
export function ArkmeDshMenu(props: {
  open: boolean
  anchor: ReactNode
  items: readonly MenuEntry[]
  selectedIds?: readonly string[]
  onSelect(id: string): void
  onClose(): void
  label: string
  align?: 'start' | 'end'
  side?: 'top' | 'bottom' | 'right'
  portal?: boolean
  closeOnPointerLeave?: boolean
  dense?: boolean
  getAnchorRect?: () => DOMRect | null
  className?: string
}) {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    return <Menu
      open={props.open}
      anchor={props.anchor}
      items={props.items}
      {...(props.selectedIds === undefined ? {} : { selectedIds: props.selectedIds })}
      onSelect={props.onSelect}
      onClose={props.onClose}
      {...(props.align === undefined ? {} : { align: props.align })}
      {...(props.side === undefined ? {} : { side: props.side })}
      {...(props.portal === undefined ? {} : { portal: props.portal })}
      {...(props.closeOnPointerLeave === undefined ? {} : { closeOnPointerLeave: props.closeOnPointerLeave })}
      {...(props.dense === undefined ? {} : { dense: props.dense })}
      {...(props.getAnchorRect === undefined ? {} : { getAnchorRect: props.getAnchorRect })}
      {...(props.className === undefined ? {} : { className: props.className })}
    />
  }
  return <span>
    {props.anchor}
    {props.open && <div role="menu" aria-label={props.label}>
      {props.items.map(entry => {
        if (isSeparator(entry)) return <div key={entry.id} role="separator" />
        if (isLabel(entry)) return <div key={entry.id} role="presentation">{entry.text}</div>
        const selected = props.selectedIds?.includes(entry.id) === true
        return <button key={entry.id} type="button" role="menuitem" disabled={entry.disabled}
          aria-label={typeof entry.label === 'string' ? entry.label : undefined}
          onClick={() => { if (!entry.disabled) props.onSelect(entry.id) }}>
          {entry.icon}<span>{entry.label}</span>{selected ? <IconCheckOutline16 /> : null}
        </button>
      })}
    </div>}
  </span>
}

export type ArkmeMenuAction = {
  id: string
  label: ReactNode
  icon?: ReactNode
  disabled?: boolean
  danger?: boolean
  onSelect(): void
} | Extract<MenuEntry, { type: 'separator' | 'label' }>

/** All command menus use the host primitive, including pointer-anchored menus.
 * Only anchoring, accessibility and cross-frame dismissal live here; never copy
 * the native menu's surface, item, hover, shadow or placement styles. */
export function ArkmeActionMenu(props: {
  open?: boolean
  label: string
  actions: readonly (ArkmeMenuAction | false | undefined)[]
  onClose(): void
  anchor?: ReactNode
  point?: { x: number; y: number }
  /** Coordinates may originate in a same-origin embedded Harness document. */
  pointDocument?: Document
  getAnchorRect?: () => DOMRect | null
  selectedIds?: readonly string[]
  align?: 'start' | 'end'
  side?: 'top' | 'bottom' | 'right'
  autoFocus?: boolean
}) {
  const open = props.open ?? true
  const root = useRef<HTMLSpanElement>(null)
  const menu = useRef<HTMLElement | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const focused = useRef(false)
  const closeRef = useRef(props.onClose)
  closeRef.current = props.onClose
  const getAnchorRect = useCallback(() => {
    if (!props.point) return props.getAnchorRect?.() ?? root.current?.querySelector('button')?.getBoundingClientRect() ?? root.current?.getBoundingClientRect() ?? null
    let { x, y } = props.point
    let doc = props.pointDocument
    // Native Menu portals into the runtime document. Translate only the anchor;
    // native placement still owns sizing, clamping and scrolling behavior.
    while (doc && doc !== document) {
      const frame = doc.defaultView?.frameElement
      if (!frame) break
      const rect = frame.getBoundingClientRect()
      x += rect.left + frame.clientLeft; y += rect.top + frame.clientTop
      doc = frame.ownerDocument
    }
    return new DOMRect(x, y, 0, 0)
  }, [props.point?.x, props.point?.y, props.pointDocument, props.getAnchorRect])
  useEffect(() => {
    if (!open || typeof document === 'undefined' || typeof document.createElement !== 'function') { focused.current = false; return }
    if (!focused.current) returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const restore = () => {
      const trigger = root.current?.querySelector<HTMLButtonElement>('button')
      if (trigger) trigger.focus()
      else returnFocus.current?.focus()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') restore()
    }
    document.addEventListener('keydown', onKey)
    const stopFrames = watchFrameMenuDismissal(document, () => closeRef.current(), event => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); returnFocus.current?.focus() }
    })
    return () => { stopFrames(); document.removeEventListener('keydown', onKey) }
  }, [open])
  useEffect(() => {
    if (!open || !props.point || typeof document === 'undefined' || typeof document.createElement !== 'function') return
    const doc = props.pointDocument ?? document
    const closeOnScroll = (event: Event) => {
      // Scrolling a long native menu is allowed; scrolling its source dismisses
      // the pointer anchor rather than leaving commands over unrelated content.
      if (event.target && menu.current?.contains(event.target as Node)) return
      closeRef.current()
    }
    const close = () => closeRef.current()
    const visibility = () => { if (doc.visibilityState !== 'visible') close() }
    doc.addEventListener('scroll', closeOnScroll, true)
    doc.addEventListener('visibilitychange', visibility)
    doc.defaultView?.addEventListener('resize', close)
    return () => {
      doc.removeEventListener('scroll', closeOnScroll, true)
      doc.removeEventListener('visibilitychange', visibility)
      doc.defaultView?.removeEventListener('resize', close)
    }
  }, [open, props.point !== undefined, props.pointDocument])
  const actions = props.actions.filter((action): action is ArkmeMenuAction => !!action)
  const items: MenuEntry[] = actions.map(action => 'type' in action ? action : ({
    id: action.id, label: typeof document === 'undefined' || typeof document.createElement !== 'function' ? action.label : <span ref={node => {
      if (!node) return
      const list = node.closest<HTMLElement>('[role="menu"]')
      if (!list) return
      menu.current = list
      if (typeof action.label === 'string') node.closest('button')?.setAttribute('aria-label', action.label)
      list.setAttribute('aria-label', props.label)
      list.setAttribute('data-arkme-action-menu', 'true')
      // React portal events still bubble through this adapter, so keyboard
      // navigation also works without modifying the upstream component.
      if (props.autoFocus && !focused.current) {
        returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        focused.current = true
        list.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus()
      }
    }}>{action.label}</span>,
    ...(action.icon === undefined ? {} : { icon: action.icon }),
    ...(action.disabled === undefined ? {} : { disabled: action.disabled }),
    ...(action.danger === undefined ? {} : { danger: action.danger }),
  }))
  return <span ref={root} style={{ display: props.anchor ? 'inline-flex' : 'contents' }}
    data-arkme-command-menu={props.label}
    onContextMenu={event => { if (menu.current?.contains(event.target as Node)) event.preventDefault() }}
    onKeyDown={event => {
      if (!open) return
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); props.onClose()
        const trigger = root.current?.querySelector<HTMLButtonElement>('button')
        if (trigger) trigger.focus()
        else returnFocus.current?.focus()
        return
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      const buttons = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])]
      if (!buttons.length) return
      event.preventDefault(); event.stopPropagation()
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : current === -1 ? (event.key === 'ArrowDown' ? 0 : buttons.length - 1)
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
      buttons[index]?.focus()
    }}>
    <ArkmeDshMenu open={open} label={props.label} anchor={props.anchor ?? null}
      items={items} portal getAnchorRect={getAnchorRect}
      {...(props.selectedIds === undefined ? {} : { selectedIds: props.selectedIds })}
      {...(props.align === undefined ? {} : { align: props.align })}
      {...(props.side === undefined ? {} : { side: props.side })}
      onClose={props.onClose} onSelect={id => {
        const action = actions.find(entry => entry.id === id)
        if (action && !('type' in action) && !action.disabled) action.onSelect()
      }} />
  </span>
}

/**
 * DSH's native view-options recipe. Keep the exported primitives, placement,
 * tooltip and trigger styling in one shared component so Arkme surfaces do not
 * drift from the host workspace control again.
 */
export function ArkmeDshViewOptionsMenu(props: {
  open: boolean
  items: readonly MenuEntry[]
  selectedIds?: readonly string[]
  onSelect(id: string): void
  onClose(): void
  onOpen(): void
  ariaLabel?: string
  dataArkmeSelfTopicSortTrigger?: string
}) {
  return <ArkmeDshMenu
    open={props.open}
    label="视图选项"
    align="end"
    dense
    portal
    className="arkme-dsh-view-options-menu-root"
    items={props.items}
    {...(props.selectedIds === undefined ? {} : { selectedIds: props.selectedIds })}
    onSelect={props.onSelect}
    onClose={props.onClose}
    anchor={<Tooltip label="视图选项" side="bottom" delayMs={500}>
      <button
        type="button"
        className="arkme-dsh-view-options-button"
        aria-label={props.ariaLabel ?? '视图选项'}
        aria-haspopup="menu"
        aria-expanded={props.open}
        data-arkme-self-topic-sort-trigger={props.dataArkmeSelfTopicSortTrigger}
        onClick={() => { props.open ? props.onClose() : props.onOpen() }}
      ><IconPersonalizationOutline16 /></button>
    </Tooltip>}
  />
}
