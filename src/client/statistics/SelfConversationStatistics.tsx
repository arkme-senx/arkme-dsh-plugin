import { useEffect, useRef, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { ChartBar } from '@phosphor-icons/react/dist/icons/ChartBar'
import { ArkmeConversationHeaderIconButton } from '../ArkmeGroupChatControls.js'
import { ArkmeRightPanelHeader } from '../ArkmeRightPanelHeader.js'
import { ARKME_CONVERSATION_HEADER_HEIGHT } from '../arkme-layout.js'
import { arkmeTheme } from '../arkme-theme.js'
import { tr, useArkmeLocale } from '../locale.js'
import { useResizableNoteDetail } from '../use-resizable-note-detail.js'
import { StatisticsSurface } from './StatisticsSurface.js'

/** Personal-record statistics have account scope, even inside a selected topic. */
export function SelfConversationStatistics({ host, accountScope, open, onOpenChange }: {
  host: RefObject<HTMLElement>; accountScope: string; open: boolean; onOpenChange(open: boolean): void
}) {
  useArkmeLocale()
  const trigger = useRef<HTMLButtonElement>(null)
  return <>
    <ArkmeConversationHeaderIconButton buttonRef={trigger} label={tr('发给自己统计')} hasPopup="dialog" expanded={open}
      onClick={() => onOpenChange(!open)}><ChartBar size={22}/></ArkmeConversationHeaderIconButton>
    {open && host.current && createPortal(<SelfConversationStatisticsPanel key={accountScope} accountScope={accountScope}
      onClose={() => onOpenChange(false)} returnFocusRef={trigger}/>, host.current)}
  </>
}

function SelfConversationStatisticsPanel({ accountScope, onClose, returnFocusRef }: {
  accountScope: string; onClose(): void; returnFocusRef: RefObject<HTMLButtonElement>
}) {
  const panel = useRef<HTMLElement>(null), close = useRef<HTMLButtonElement>(null)
  const resize = useResizableNoteDetail(panel, 'arkme:self-statistics-width:v1', tr('调整发给自己统计宽度'), 480)
  useEffect(() => {
    const element = panel.current, trigger = returnFocusRef.current
    close.current?.focus({ preventScroll: true })
    return () => {
      if (document.activeElement === document.body || element?.contains(document.activeElement)) trigger?.focus({ preventScroll: true })
    }
  }, [returnFocusRef])
  return <aside ref={panel} role="dialog" aria-label={tr('发给自己统计')} style={{
    position: 'absolute', top: ARKME_CONVERSATION_HEADER_HEIGHT, right: 0, bottom: 0, zIndex: 30,
    ...resize.style, minWidth: 0, display: 'flex', flexDirection: 'column', boxSizing: 'border-box',
    background: arkmeTheme.base, color: arkmeTheme.text, borderLeft: `1px solid ${arkmeTheme.border}`,
  }} onKeyDown={event => {
    // Nested keyword / record drawers own Escape until the user returns here.
    if (event.key !== 'Escape' || event.nativeEvent.isComposing || event.defaultPrevented
      || panel.current?.querySelector('[role="dialog"]:not([hidden])')
      || document.querySelector('[aria-modal="true"], [role="menu"]')) return
    event.preventDefault(); event.stopPropagation(); onClose()
  }}>
    {resize.handle}
    <ArkmeRightPanelHeader title={tr('统计')} subtitle={tr('全部个人快记 · 不受当前主题筛选影响')}
      onClose={onClose} closeRef={close} closeLabel={tr('关闭发给自己统计')}/>
    <StatisticsSurface accountScope={accountScope} embedded/>
  </aside>
}
