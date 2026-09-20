import { tr, useArkmeLocale } from './locale.js'
import {
  IconCheckOutline16, IconEllipsisOutline16, IconPersonalizationOutline16, Menu, Tooltip, type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import { watchFrameMenuDismissal } from './frame-menu-dismissal.js'
import { inMenuHoverRegion } from './menu-hover-region.js'

const conversationMenuCss = `
[role="menu"]:has(.arkme-conversation-actions-menu-label) {
  width: 248px; min-width: 248px; max-width: calc(100vw - 24px);
  padding: 6px 8px; box-sizing: border-box; border-radius: 4px;
  border: 1px solid var(--dsw-alias-border-l1, #e2e5e9);
  background: var(--dsw-alias-bg-base, #fff);
  box-shadow: 0 4px 10px rgba(0,0,0,.1);
}
[role="menu"]:has(.arkme-conversation-actions-menu-label) [role="menuitem"] {
  min-height: 32px; height: auto; margin: 0; width: 100%;
  padding: 2px 8px; gap: 10px; border-radius: 4px; box-sizing: border-box;
  font-size: 14px !important; font-weight: 400; line-height: 20px !important;
}
[role="menu"]:has(.arkme-conversation-actions-menu-label) [role="menuitem"] > span { font-size: inherit; line-height: inherit; }
[role="menu"]:has(.arkme-conversation-actions-menu-label) [role="menuitem"] > span:has(> .arkme-conversation-actions-menu-icon) {
  width: 20px; height: 20px; flex: 0 0 20px; color: inherit;
}
[role="menu"]:has(.arkme-conversation-actions-menu-label) [role="separator"] {
  margin: 8px 0; height: 1px; background: var(--dsw-alias-border-l1, #e2e5e9);
}
[role="menu"]:has(.arkme-conversation-actions-menu-label) > [role="presentation"] > [role="presentation"] {
  padding: 6px 8px; font-size: 13px; font-weight: 400; line-height: 20px;
  color: var(--dsw-alias-label-secondary);
}
.arkme-conversation-actions-menu-icon {
  display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; flex: 0 0 20px;
}
.arkme-conversation-actions-menu-icon > svg,
.arkme-conversation-actions-menu-icon > span { width: 20px !important; height: 20px !important; }
`

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
      title={tr("主题操作")} aria-label={props.label} aria-haspopup="menu" aria-expanded={props.open}
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
  conversationAppearance?: boolean
}) {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    return <>
      {props.conversationAppearance && <style>{conversationMenuCss}</style>}
      <Menu
      open={props.open}
      anchor={props.anchor}
      items={props.conversationAppearance ? props.items.map(entry => isSeparator(entry) || isLabel(entry)
        ? entry : {
          ...entry,
          label: <span className="arkme-conversation-actions-menu-label" style={{ display: 'block', width: '100%', fontSize: 14, fontWeight: 400, lineHeight: '20px' }}>{entry.label}</span>,
          ...(entry.icon === undefined ? {} : {
            icon: <span className="arkme-conversation-actions-menu-icon">{entry.icon}</span>,
          }),
        }) : props.items}
      {...(props.selectedIds === undefined ? {} : { selectedIds: props.selectedIds })}
      onSelect={props.onSelect}
      onClose={props.onClose}
      {...(props.align === undefined ? {} : { align: props.align })}
      {...(props.side === undefined ? {} : { side: props.side })}
      {...(props.portal === undefined ? {} : { portal: props.portal })}
      {...(props.closeOnPointerLeave === undefined ? {} : { closeOnPointerLeave: props.closeOnPointerLeave })}
      {...(props.dense === undefined ? {} : { dense: props.dense })}
      {...(props.getAnchorRect === undefined ? {} : { getAnchorRect: props.getAnchorRect })}
      {...(props.conversationAppearance
        ? { className: ['arkme-conversation-actions-menu', props.className].filter(Boolean).join(' ') }
        : props.className === undefined ? {} : { className: props.className })}
    /></>
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
  /** Hover menus dismiss immediately outside the trigger, menu and crossing gap. */
  hoverAnchor?: HTMLElement | undefined
}) {
  useArkmeLocale()
  const open = props.open ?? true
  const root = useRef<HTMLSpanElement>(null)
  const menu = useRef<HTMLElement | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const focused = useRef(false)
  const closeRef = useRef(props.onClose)
  closeRef.current = props.onClose
  const focusFirstItem = useCallback(() => {
    if (!props.autoFocus || focused.current) return
    const button = menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
    if (!button) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    button.focus({ preventScroll: true })
    // The native portal first mounts hidden to measure its placement. Hidden
    // items cannot take focus; retry after placement instead of marking success.
    if (document.activeElement === button) {
      returnFocus.current = previous
      focused.current = true
    }
  }, [props.autoFocus])
  useEffect(() => {
    if (!open || !props.autoFocus || focused.current) return
    const frame = requestAnimationFrame(focusFirstItem)
    return () => cancelAnimationFrame(frame)
  }, [open, props.autoFocus, focusFirstItem])
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
    if (!open || typeof document === 'undefined') return
    // The native Menu dismisses from a bubble-phase document listener, so one
    // stopPropagation() between the pointer target and document (custom scroll
    // thumbs, drag surfaces, card wrappers) silently disables outside dismissal
    // for the whole surface. Capture on document runs before every other handler
    // and cannot be blocked, so it arms a fallback; a bubble listener on the same
    // document cancels it whenever propagation arrives normally. That keeps the
    // native single-close contract instead of closing twice per click.
    const own = root.current?.ownerDocument ?? document
    if (typeof own?.addEventListener !== 'function') return
    let pending: ReturnType<typeof setTimeout> | undefined
    const cancel = () => { if (pending !== undefined) { clearTimeout(pending); pending = undefined } }
    const outside = (event: Event) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (root.current?.contains(target) === true) return
      if (menu.current?.contains(target) === true) return
      cancel()
      pending = setTimeout(() => { pending = undefined; closeRef.current() }, 0)
    }
    const arrived = () => cancel()
    own.addEventListener('pointerdown', outside, true)
    own.addEventListener('pointerdown', arrived)
    return () => {
      cancel()
      own.removeEventListener('pointerdown', outside, true)
      own.removeEventListener('pointerdown', arrived)
    }
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
  useEffect(() => {
    const anchor = props.hoverAnchor
    if (!open || !anchor || typeof document === 'undefined') return
    const doc = anchor.ownerDocument
    const close = () => closeRef.current()
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      const list = menu.current
      if (!anchor.isConnected || (list && !inMenuHoverRegion(event.clientX, event.clientY,
        anchor.getBoundingClientRect(), list.getBoundingClientRect()))) close()
    }
    const leave = (event: PointerEvent) => { if (event.relatedTarget === null) close() }
    const observer = new MutationObserver(() => { if (!anchor.isConnected) close() })
    observer.observe(doc.body, { childList: true, subtree: true })
    doc.addEventListener('pointermove', move, true)
    doc.addEventListener('pointerout', leave, true)
    doc.defaultView?.addEventListener('blur', close)
    return () => {
      observer.disconnect()
      doc.removeEventListener('pointermove', move, true)
      doc.removeEventListener('pointerout', leave, true)
      doc.defaultView?.removeEventListener('blur', close)
    }
  }, [open, props.hoverAnchor])
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
      focusFirstItem()
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
    label={tr("视图选项")}
    align="end"
    dense
    portal
    className="arkme-dsh-view-options-menu-root"
    items={props.items}
    {...(props.selectedIds === undefined ? {} : { selectedIds: props.selectedIds })}
    onSelect={props.onSelect}
    onClose={props.onClose}
    anchor={<Tooltip label={tr("视图选项")} side="bottom" delayMs={500}>
      <button
        type="button"
        className="arkme-dsh-view-options-button"
        aria-label={props.ariaLabel ?? tr("视图选项")}
        aria-haspopup="menu"
        aria-expanded={props.open}
        data-arkme-self-topic-sort-trigger={props.dataArkmeSelfTopicSortTrigger}
        onClick={() => { props.open ? props.onClose() : props.onOpen() }}
      ><IconPersonalizationOutline16 /></button>
    </Tooltip>}
  />
}
