import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Heart } from '@phosphor-icons/react/dist/icons/Heart'
import { arkmeTheme } from './arkme-theme.js'
import { ArkmeComposerToolButton } from './ArkmeComposerToolButton.js'
import { ArkmeComposerEmojiIcon } from './ArkmeComposerToolIcon.js'
import {
  arkmeDefaultEmojis, arkmeEmojiById, nextArkmeRecentEmojiIds, type ArkmeEmoji,
} from './arkme-emoji.js'

const recentStorageKey = 'arkme:composer:recent-emojis:v1'

const styles: Record<string, CSSProperties> = {
  host: { flex: 'none' },
  panel: {
    position: 'absolute', left: 0, bottom: 'calc(100% + 8px)', zIndex: 30,
    width: 'min(372px, calc(100vw - 48px))', maxHeight: 'min(410px, calc(100vh - 180px))',
    overflowY: 'auto', padding: '14px 14px 10px', boxSizing: 'border-box',
    border: `1px solid ${arkmeTheme.border}`, borderRadius: 13,
    background: arkmeTheme.menu, color: arkmeTheme.text, boxShadow: arkmeTheme.shadow,
  },
  sectionHeader: { margin: '0 2px 8px', display: 'flex', alignItems: 'center', gap: 10 },
  sectionTitle: { flex: 1, fontSize: 12, lineHeight: '18px', fontWeight: 500, color: arkmeTheme.secondary },
  attribution: { color: arkmeTheme.tertiary, fontSize: 11, lineHeight: '16px', whiteSpace: 'nowrap' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(10, minmax(0, 1fr))', gap: 4 },
  emoji: {
    minWidth: 0, width: '100%', aspectRatio: '1', display: 'grid', placeItems: 'center', padding: 0,
    border: 0, borderRadius: 8, background: 'transparent', cursor: 'pointer',
  },
  emojiImage: { width: 24, height: 24, display: 'block', objectFit: 'contain', pointerEvents: 'none' },
  sectionGap: { height: 16 },
  tabs: { display: 'flex', alignItems: 'center', gap: 4, height: 38, marginTop: 12, paddingTop: 8, borderTop: `1px solid ${arkmeTheme.borderSoft}` },
  tab: { width: 34, height: 30, display: 'grid', placeItems: 'center', border: 0, borderRadius: 9, background: arkmeTheme.active, color: arkmeTheme.secondary },
  disabledTab: { background: 'transparent', color: arkmeTheme.tertiary, opacity: 0.48 },
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
    ><img src={emoji.assetUrl} alt="" style={styles.emojiImage} /></button>)}
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
      {recent.length > 0 && <>
        <div style={styles.sectionHeader}><span style={styles.sectionTitle}>最近使用</span></div>
        <ArkmeEmojiGrid emojis={recent} onSelect={select} />
        <div style={styles.sectionGap} />
      </>}
      <div style={styles.sectionHeader}>
        <span style={styles.sectionTitle}>默认表情</span>
        <span style={styles.attribution}>创作者：牛mo王</span>
      </div>
      <ArkmeEmojiGrid emojis={arkmeDefaultEmojis} onSelect={select} />
      <div style={styles.tabs} aria-label="表情分类">
        <button type="button" style={styles.tab} aria-label="默认表情" aria-pressed="true"><ArkmeComposerEmojiIcon /></button>
        <button type="button" style={{ ...styles.tab, ...styles.disabledTab }} aria-label="收藏表情（暂不可用）" disabled><Heart size={20} weight="regular" /></button>
      </div>
    </section>}
    <ArkmeComposerToolButton
      disabled={disabled}
      aria-label="选择表情"
      aria-haspopup="dialog"
      aria-expanded={open}
      data-arkme-composer-tool="emoji"
      onMouseDown={event => { event.preventDefault() }}
      onClick={() => { setOpen(value => !value) }}
    ><ArkmeComposerEmojiIcon /></ArkmeComposerToolButton>
  </div>
}
