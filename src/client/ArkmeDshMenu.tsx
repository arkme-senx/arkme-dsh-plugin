import {
  IconCheckOutline16, IconPersonalizationOutline16, Menu, Tooltip, type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactNode } from 'react'

function isSeparator(entry: MenuEntry): entry is Extract<MenuEntry, { type: 'separator' }> {
  return 'type' in entry && entry.type === 'separator'
}

function isLabel(entry: MenuEntry): entry is Extract<MenuEntry, { type: 'label' }> {
  return 'type' in entry && entry.type === 'label'
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
  className?: string
}) {
  if (typeof document !== 'undefined') {
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
          onClick={() => { if (!entry.disabled) props.onSelect(entry.id) }}>
          {entry.icon}<span>{entry.label}</span>{selected ? <IconCheckOutline16 /> : null}
        </button>
      })}
    </div>}
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
