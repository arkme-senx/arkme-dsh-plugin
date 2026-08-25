import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Smiley } from '@phosphor-icons/react/dist/icons/Smiley'
import { arkmeTheme } from './arkme-theme.js'
import {
  arkmeDefaultEmojis, arkmeEmojiById, nextArkmeRecentEmojiIds, type ArkmeEmoji,
} from './arkme-emoji.js'

const recentStorageKey = 'arkme:composer:recent-emojis:v1'

const styles: Record<string, CSSProperties> = {
  host: { position: 'relative', flex: 'none' },
  trigger: {
    width: 34, height: 34, display: 'grid', placeItems: 'center', padding: 0,
    border: 0, borderRadius: 9, background: 'transparent', color: arkmeTheme.secondary,
    cursor: 'pointer', transition: 'background-color 120ms ease, color 120ms ease',
  },
  panel: {
    position: 'absolute', left: 0, bottom: 42, zIndex: 30,
    width: 'min(344px, calc(100vw - 48px))', maxHeight: 'min(380px, calc(100vh - 180px))',
    overflowY: 'auto', padding: 12, boxSizing: 'border-box',
    border: `1px solid ${arkmeTheme.border}`, borderRadius: 13,
    background: arkmeTheme.menu, color: arkmeTheme.text, boxShadow: arkmeTheme.shadow,
  },
  title: { margin: '0 2px 10px', fontSize: 12, lineHeight: '18px', fontWeight: 600, color: arkmeTheme.secondary },
  sectionTitle: { margin: '0 2px 7px', fontSize: 11, lineHeight: '16px', fontWeight: 500, color: arkmeTheme.tertiary },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(8, minmax(0, 1fr))', gap: 3 },
  emoji: {
    minWidth: 0, width: '100%', aspectRatio: '1', display: 'grid', placeItems: 'center', padding: 0,
    border: 0, borderRadius: 8, background: 'transparent', cursor: 'pointer',
    fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif',
    fontSize: 22, lineHeight: 1,
  },
  divider: { height: 1, margin: '10px 2px', background: arkmeTheme.borderSoft },
}

function loadRecentEmojiIds(): string[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const value: unknown = JSON.parse(localStorage.getItem(recentStorageKey) ?? '[]')
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string' && arkmeEmojiById[id] !== undefined).slice(0, 8)
      : []
  } catch {
    return []
  }
}

function saveRecentEmojiIds(ids: readonly string[]): void {
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(recentStorageKey, JSON.stringify(ids)) } catch { /* storage is an optional enhancement */ }
}

function ArkmeEmojiGrid({ emojis, onSelect }: {
  emojis: readonly ArkmeEmoji[]
  onSelect(emoji: ArkmeEmoji): void
}) {
  return <div style={styles.grid} role="group">
    {emojis.map(emoji => <button
      key={emoji.id}
      type="button"
      style={styles.emoji}
      title={emoji.label}
      aria-label={emoji.label}
      data-arkme-emoji-id={emoji.id}
      onMouseDown={event => { event.preventDefault() }}
      onMouseEnter={event => { event.currentTarget.style.background = arkmeTheme.hover }}
      onMouseLeave={event => { event.currentTarget.style.background = 'transparent' }}
      onClick={() => { onSelect(emoji) }}
    >{emoji.unicode}</button>)}
  </div>
}

export function ArkmeEmojiPicker({ disabled, scopeKey, onSelect }: {
  disabled: boolean
  scopeKey: string | undefined
  onSelect(emoji: ArkmeEmoji): void
}) {
  const [open, setOpen] = useState(false)
  const [recentIds, setRecentIds] = useState<string[]>(loadRecentEmojiIds)
  const hostRef = useRef<HTMLDivElement>(null)
  const previousScopeKey = useRef(scopeKey)

  useEffect(() => {
    if (previousScopeKey.current !== scopeKey) setOpen(false)
    previousScopeKey.current = scopeKey
  }, [scopeKey])

  useEffect(() => {
    if (!open || typeof document === 'undefined') return
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && hostRef.current?.contains(event.target) !== true) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  const select = (emoji: ArkmeEmoji) => {
    const next = nextArkmeRecentEmojiIds(recentIds, emoji.id)
    setRecentIds(next)
    saveRecentEmojiIds(next)
    onSelect(emoji)
  }
  const recent = recentIds.map(id => arkmeEmojiById[id]).filter((emoji): emoji is ArkmeEmoji => emoji !== undefined)

  return <div ref={hostRef} style={styles.host} data-arkme-emoji-picker>
    {open && <section role="dialog" style={styles.panel} aria-label="表情选择器" data-arkme-emoji-panel>
      <h3 style={styles.title}>表情</h3>
      {recent.length > 0 && <>
        <div style={styles.sectionTitle}>最近使用</div>
        <ArkmeEmojiGrid emojis={recent} onSelect={select} />
        <div style={styles.divider} />
      </>}
      <div style={styles.sectionTitle}>全部表情</div>
      <ArkmeEmojiGrid emojis={arkmeDefaultEmojis} onSelect={select} />
    </section>}
    <button
      type="button"
      style={{ ...styles.trigger, ...(open ? { background: arkmeTheme.active, color: arkmeTheme.text } : {}) }}
      disabled={disabled}
      aria-label="选择表情"
      aria-haspopup="dialog"
      aria-expanded={open}
      onMouseDown={event => { event.preventDefault() }}
      onMouseEnter={event => { if (!event.currentTarget.disabled) event.currentTarget.style.background = arkmeTheme.hover }}
      onMouseLeave={event => { event.currentTarget.style.background = open ? arkmeTheme.active : 'transparent' }}
      onClick={() => { setOpen(value => !value) }}
    ><Smiley size={21} weight="regular" aria-hidden /></button>
  </div>
}
