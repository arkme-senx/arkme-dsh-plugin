import type {
  HostObservable, InjectFace, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import { useState, type CSSProperties } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { JotmoMark } from './JotmoFooterAction.js'

export const JOTMO_SURFACE_ID = 'jotmo-default-category'

export interface JotmoVirtualWorkspaceInjected {
  hooks: {
    surface: HostObservable<string | null>
  }
  open(): void
}

export type JotmoVirtualWorkspaceProps =
  PropsRuntime<'sidebar.workspaces.virtual'>
  & InjectFace<JotmoVirtualWorkspaceInjected>

const styles: Record<string, CSSProperties> = {
  group: { flex: 'none', margin: '0 0 6px', color: 'var(--dsw-alias-label-primary, #17191c)' },
  groupButton: {
    width: '100%', height: 34, display: 'flex', alignItems: 'center', gap: 6,
    boxSizing: 'border-box', border: 0, borderRadius: 8, outline: 0, padding: '0 8px', background: 'transparent',
    color: 'inherit', cursor: 'pointer', font: 'inherit', textAlign: 'left', userSelect: 'none',
  },
  leadingSlot: {
    flex: 'none', width: 16, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    color: 'var(--dsw-alias-label-caption, #adb2b8)',
  },
  chevron: {
    width: 0, height: 0, borderTop: '4px solid transparent', borderBottom: '4px solid transparent',
    borderLeft: '6px solid currentColor', transition: 'transform 150ms var(--ds-ease-in-out)',
  },
  title: {
    flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    fontSize: 14, lineHeight: '20px', fontWeight: 400,
  },
  childButton: {
    width: '100%', height: 32, marginTop: 2, display: 'flex', alignItems: 'center', gap: 0,
    boxSizing: 'border-box', border: 0, borderRadius: 8, outline: 0, padding: '0 8px', background: 'transparent',
    color: 'var(--dsw-alias-label-primary, #17191c)', cursor: 'pointer', font: 'inherit', textAlign: 'left', userSelect: 'none',
  },
  statusSlot: { flex: 'none', width: 16, height: 20 },
  childTitle: {
    flex: 1, minWidth: 0, margin: '0 6px 0 4px', overflow: 'hidden', textOverflow: 'ellipsis',
    whiteSpace: 'nowrap', fontSize: 14, lineHeight: '20px',
  },
  active: {
    background: 'var(--dsw-alias-interactive-bg-hover, #eef1f5)',
    color: 'var(--dsw-alias-label-primary, #17191c)',
  },
  hover: { background: 'var(--dsw-alias-interactive-bg-hover, #eef1f5)' },
  rail: { flex: 'none', display: 'flex', justifyContent: 'center', padding: '0 0 6px' },
  railButton: {
    width: 36, height: 36, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    border: 0, borderRadius: 8, outline: 0, background: 'transparent', cursor: 'pointer',
  },
}

export function JotmoVirtualWorkspace({ wide, useSurface, open }: JotmoVirtualWorkspaceProps) {
  const selected = useSurface(surface => surface === JOTMO_SURFACE_ID)
  const [expanded, setExpanded] = useState(true)
  const [groupHovered, setGroupHovered] = useState(false)
  const [childHovered, setChildHovered] = useState(false)
  if (!wide) {
    return (
      <div style={styles.rail}>
        <button
          type="button"
          style={{ ...styles.railButton, ...(selected ? styles.active : {}) }}
          aria-label="即我 · 默认分类"
          title="即我 · 默认分类"
          onClick={open}
        >
          <JotmoMark size={20} />
        </button>
      </div>
    )
  }

  return (
    <section style={styles.group} role="tree" aria-label="即我工作区">
      <button
        type="button"
        role="treeitem"
        aria-expanded={expanded}
        aria-label="即我"
        style={{ ...styles.groupButton, ...(groupHovered ? styles.hover : {}) }}
        onMouseEnter={() => { setGroupHovered(true) }}
        onMouseLeave={() => { setGroupHovered(false) }}
        onClick={() => { setExpanded(value => !value) }}
      >
        <span style={styles.leadingSlot} aria-hidden>
          {groupHovered
            ? <span style={{ ...styles.chevron, transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }} />
            : <JotmoMark size={16} />}
        </span>
        <span style={styles.title}>即我</span>
      </button>
      {expanded && (
        <button
          type="button"
          role="treeitem"
          aria-selected={selected}
          style={{ ...styles.childButton, ...(selected ? styles.active : childHovered ? styles.hover : {}) }}
          aria-current={selected ? 'page' : undefined}
          onMouseEnter={() => { setChildHovered(true) }}
          onMouseLeave={() => { setChildHovered(false) }}
          onClick={open}
        >
          <span style={styles.statusSlot} aria-hidden />
          <span style={styles.childTitle}>默认分类</span>
        </button>
      )}
    </section>
  )
}
