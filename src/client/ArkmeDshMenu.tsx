import {
  IconCheckOutline16, IconPersonalizationOutline16, Menu, Tooltip, type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactNode } from 'react'

const conversationMenuCss = `
.arkme-conversation-actions-menu [role="menu"] {
  width: 248px; min-width: 248px; max-width: calc(100vw - 24px);
  padding: 6px 8px; box-sizing: border-box; border-radius: 4px;
  border: 1px solid var(--dsw-alias-border-l1, #e2e5e9);
  background: var(--dsw-alias-bg-base, #fff);
  box-shadow: 0 4px 10px rgba(0,0,0,.1);
}
.arkme-conversation-actions-menu [role="menuitem"] {
  min-height: 32px; height: auto; margin: 0; width: 100%;
  padding: 2px 8px; gap: 10px; border-radius: 4px; box-sizing: border-box;
  font-size: 14px !important; font-weight: 400; line-height: 20px !important;
}
.arkme-conversation-actions-menu [role="menuitem"] > span { font-size: inherit; line-height: inherit; }
.arkme-conversation-actions-menu [role="menuitem"] > span:has(> .arkme-conversation-actions-menu-icon) {
  width: 20px; height: 20px; flex: 0 0 20px; color: inherit;
}
.arkme-conversation-actions-menu [role="separator"] {
  margin: 8px 0; height: 1px; background: var(--dsw-alias-border-l1, #e2e5e9);
}
.arkme-conversation-actions-menu [role="menu"] > [role="presentation"] > [role="presentation"] {
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
  conversationAppearance?: boolean
}) {
  if (typeof document !== 'undefined') {
    return <>
      {props.conversationAppearance && <style>{conversationMenuCss}</style>}
      <Menu
      open={props.open}
      anchor={props.anchor}
      items={props.conversationAppearance ? props.items.map(entry => isSeparator(entry) || isLabel(entry)
        ? entry : {
          ...entry,
          label: <span style={{ display: 'block', width: '100%', fontSize: 14, fontWeight: 400, lineHeight: '20px' }}>{entry.label}</span>,
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
