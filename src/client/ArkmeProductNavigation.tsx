import { useSyncExternalStore, type CSSProperties } from 'react'
import { ChatCircleText } from '@phosphor-icons/react/dist/icons/ChatCircleText'
import { CalendarBlank } from '@phosphor-icons/react/dist/icons/CalendarBlank'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/icons/MagnifyingGlass'
import { PuzzlePiece } from '@phosphor-icons/react/dist/icons/PuzzlePiece'
import { PhoneCall } from '@phosphor-icons/react/dist/icons/PhoneCall'
import { Waveform } from '@phosphor-icons/react/dist/icons/Waveform'
import { GlobeHemisphereWest } from '@phosphor-icons/react/dist/icons/GlobeHemisphereWest'
import type { Icon } from '@phosphor-icons/react/lib'
import { ArkmeAccountMenu } from './ArkmeAccountMenu.js'
import { arkmeUi } from './ui-controller.js'

interface ArkmeProductNavigationProps {
  compact: boolean
  currentSessionId?: string | undefined
}

type NavigationItem = {
  id: 'conversations' | 'calls' | 'recordings' | 'search' | 'calendar' | 'world' | 'extensions'
  label: string
  icon: Icon
}

const items: NavigationItem[] = [
  { id: 'conversations', label: '对话', icon: ChatCircleText },
  { id: 'calls', label: '通话', icon: PhoneCall },
  { id: 'recordings', label: '录音', icon: Waveform },
  { id: 'search', label: '搜索', icon: MagnifyingGlass },
  { id: 'calendar', label: '日历', icon: CalendarBlank },
  { id: 'world', label: '世界', icon: GlobeHemisphereWest },
  { id: 'extensions', label: '市集', icon: PuzzlePiece },
]

const styles: Record<string, CSSProperties> = {
  rail: {
    width: 72,
    minWidth: 72,
    height: '100%',
    padding: '24px 8px 14px',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 5,
    borderRight: '1px solid #e7e7e9',
    background: '#fbfbfc',
    color: '#3e4149',
  },
  compactRail: {
    width: '100%',
    minWidth: 0,
    height: 58,
    padding: '6px 10px',
    flexDirection: 'row',
    alignItems: 'center',
    borderRight: 0,
    borderBottom: '1px solid #e7e7e9',
  },
  button: {
    position: 'relative',
    minHeight: 57,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    padding: '7px 4px',
    border: 0,
    borderRadius: 15,
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    font: 'inherit',
    outline: 0,
    boxShadow: 'none',
  },
  compactButton: { minHeight: 42, height: 42, flex: 1, flexDirection: 'row', gap: 6, padding: '0 8px', borderRadius: 12 },
  activeButton: { background: '#f1f2f6', color: '#151722' },
  activeMarker: {
    position: 'absolute',
    left: -9,
    width: 3,
    height: 33,
    borderRadius: 3,
    background: '#151722',
  },
  compactMarker: { left: '50%', bottom: -6, width: 30, height: 3, transform: 'translateX(-50%)' },
  label: { fontSize: 11, lineHeight: '15px', whiteSpace: 'nowrap' },
}

/** Arkme-owned navigation rendered wholly inside the plugin surface. */
export function ArkmeProductNavigation({ compact, currentSessionId }: ArkmeProductNavigationProps) {
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getSnapshot, arkmeUi.getSnapshot)
  const activeId = ui.mode === 'extensions' ? 'extensions'
    : ui.mode === 'world' ? 'world'
    : ui.mode === 'calendar' ? 'calendar'
    : ui.mode === 'calls' ? 'calls'
      : ui.mode === 'recordings' ? 'recordings'
      : ui.mode === 'search' ? 'search'
        : 'conversations'

  const activate = (id: NavigationItem['id']) => {
    if (id === 'extensions') {
      arkmeUi.showExtensions()
      return
    }
    if (id === 'calls') arkmeUi.showCalls()
    else if (id === 'recordings') arkmeUi.showRecordings()
    else if (id === 'world') arkmeUi.showWorld()
    else if (id === 'calendar') arkmeUi.showCalendar()
    else if (id === 'search') arkmeUi.showSearch()
    else arkmeUi.showConversations()
  }

  return <nav
      data-arkme-owned="product-navigation"
      aria-label="Arkme 功能导航"
      style={{ ...styles.rail, ...(compact ? styles.compactRail : {}) }}
    >
      {items.map(item => {
        const ItemIcon = item.icon
        const active = item.id === activeId
        return <button
          key={item.id}
          type="button"
          aria-current={active ? 'page' : undefined}
          style={{ ...styles.button, ...(compact ? styles.compactButton : {}), ...(active ? styles.activeButton : {}) }}
          onClick={() => { activate(item.id) }}
        >
          {active && <span aria-hidden style={{ ...styles.activeMarker, ...(compact ? styles.compactMarker : {}) }} />}
          <ItemIcon size={22} weight="regular" aria-hidden />
          <span style={styles.label}>{item.label}</span>
        </button>
      })}
      <ArkmeAccountMenu compact={compact} />
    </nav>
}
