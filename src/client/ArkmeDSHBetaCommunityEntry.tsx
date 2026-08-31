import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import type {
  ArkmeDSHBetaCommunityEntryState,
  ArkmeDSHBetaCommunityJoinResult,
} from '../dsh-beta-community.js'
import type { ArkmeGroupAvatarPresentation, ArkmeSourceItem } from '../types.js'
import { callArkme } from './api.js'
import { ArkmeAvatarMosaic, ArkmeSourceAvatar } from './ArkmeAvatar.js'

type EntryPhase = 'loading' | 'hidden' | 'ready' | 'joining'

interface ReadyEntry {
  groupAvatar: ArkmeGroupAvatarPresentation
}

export interface ArkmeDSHBetaCommunityEntryProps {
  onJoined(source: ArkmeSourceItem): void | Promise<void>
}

const colors = {
  text: 'var(--dsw-alias-label-primary, #242629)',
  secondary: 'var(--dsw-alias-label-secondary, #8a9099)',
  caption: 'var(--dsw-alias-label-caption, #b0b5bc)',
  border: 'var(--dsw-alias-border-l1, #eceef0)',
  accent: 'var(--dsw-alias-state-business-primary, #20c66a)',
  surface: 'var(--dsw-alias-bg-base, #fff)',
  mask: 'rgba(23, 25, 28, .32)',
}

const styles: Record<string, CSSProperties> = {
  loading: { height: 80, flex: 'none' },
  section: { boxSizing: 'border-box' },
  sectionHeader: { display: 'flex', alignItems: 'center', padding: '8px 0 2px 12px' },
  sectionLabel: {
    flex: 'none', color: colors.caption, fontSize: 11, lineHeight: '16px', fontWeight: 500, letterSpacing: '.4px',
  },
  sectionLine: { height: 1, flex: 1, marginLeft: 10, background: colors.border },
  row: {
    width: '100%', minHeight: 55, display: 'flex', alignItems: 'center', gap: 12,
    border: 0, padding: '6px 12px 9px', background: 'transparent', color: 'inherit',
    textAlign: 'left', cursor: 'pointer', font: 'inherit', boxSizing: 'border-box',
  },
  content: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 },
  title: {
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    color: colors.text, fontSize: 15, lineHeight: '20px', fontWeight: 500,
  },
  subtitle: {
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    color: colors.secondary, fontSize: 12, lineHeight: '17px',
  },
  action: { flex: 'none', color: colors.accent, fontSize: 13, lineHeight: '18px', fontWeight: 500 },
  chevron: { flex: 'none', marginLeft: -6, color: colors.caption, fontSize: 20, lineHeight: '20px' },
  bottomLine: { height: 1, background: colors.border },
  backdrop: {
    position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: colors.mask,
  },
  sheet: {
    width: 'min(460px, calc(100% - 32px))', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto',
    borderRadius: 34, padding: '10px 20px 22px', boxSizing: 'border-box',
    background: colors.surface, color: colors.text, boxShadow: '0 12px 40px rgba(23, 25, 28, .16)',
  },
  handle: { width: 48, height: 5, margin: '0 auto', borderRadius: 999, background: colors.caption, opacity: .88 },
  cancel: {
    width: 38, height: 38, marginTop: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    border: 0, borderRadius: 18, padding: 0, background: 'transparent', color: colors.text,
    cursor: 'pointer', font: 'inherit', fontSize: 22, lineHeight: '22px',
  },
  sheetContent: { display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 8 },
  sheetTitle: {
    maxWidth: '100%', margin: '24px 0 0', overflow: 'hidden', textOverflow: 'ellipsis',
    color: colors.text, fontSize: 22, lineHeight: '26px', fontWeight: 700, textAlign: 'center',
  },
  sheetSubtitle: {
    margin: '14px 18px 0', color: colors.secondary, fontSize: 14, lineHeight: '20px', fontWeight: 500, textAlign: 'center',
  },
  confirm: {
    minWidth: 220, height: 58, marginTop: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10,
    border: 0, borderRadius: 999, padding: '0 28px', background: colors.text, color: '#fff',
    cursor: 'pointer', font: 'inherit', fontSize: 16, lineHeight: '18px', fontWeight: 700,
  },
  confirmArrow: {
    width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: 999, background: 'rgba(255,255,255,.20)', color: '#fff', fontSize: 19, lineHeight: '19px',
  },
}

export function ArkmeDSHBetaCommunityEntryContent({
  avatarUrls,
  groupAvatar,
  joining,
  onActivate,
}: {
  avatarUrls: readonly string[]
  groupAvatar?: ArkmeGroupAvatarPresentation
  joining: boolean
  onActivate(): void
}) {
  return <div style={styles.section} role="none">
    <div style={styles.sectionHeader} aria-hidden>
      <span style={styles.sectionLabel}>DSH 内测</span>
      <span style={styles.sectionLine} />
    </div>
    <button
      type="button"
      role="treeitem"
      aria-label="加入 DSH 内测群"
      aria-busy={joining}
      style={{ ...styles.row, cursor: joining ? 'default' : 'pointer' }}
      disabled={joining}
      onClick={onActivate}
    >
      {groupAvatar === undefined
        ? <ArkmeAvatarMosaic urls={avatarUrls} size={40} fallback={false} />
        : <ArkmeSourceAvatar kind="group" groupAvatar={groupAvatar} size={40} />}
      <span style={styles.content}>
        <span style={styles.title}>还没加入 DSH 内测群？</span>
        <span style={styles.subtitle}>和内测用户一起聊聊</span>
      </span>
      <span style={styles.action}>{joining ? '加入中…' : '去加入'}</span>
      {!joining && <span style={styles.chevron} aria-hidden>›</span>}
    </button>
    <div style={styles.bottomLine} aria-hidden />
  </div>
}

export function ArkmeDSHBetaCommunityJoinConfirmation({
  avatarUrls,
  groupAvatar,
  onCancel,
  onConfirm,
}: {
  avatarUrls: readonly string[]
  groupAvatar?: ArkmeGroupAvatarPresentation
  onCancel(): void
  onConfirm(): void
}) {
  const confirmRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    confirmRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [onCancel])
  const cancelFromBackdrop = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) onCancel()
  }
  return <div style={styles.backdrop} onMouseDown={cancelFromBackdrop}>
    <section style={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="arkme-community-join-title">
      <div style={styles.handle} aria-hidden />
      <button type="button" style={styles.cancel} aria-label="取消加入群聊" onClick={onCancel}>‹</button>
      <div style={styles.sheetContent}>
        {groupAvatar === undefined
          ? <ArkmeAvatarMosaic urls={avatarUrls} size={86} fallback={false} />
          : <ArkmeSourceAvatar kind="group" groupAvatar={groupAvatar} size={86} />}
        <h2 id="arkme-community-join-title" style={styles.sheetTitle}>DSH 内测群</h2>
        <p style={styles.sheetSubtitle}>和内测用户一起聊聊</p>
        <button ref={confirmRef} type="button" style={styles.confirm} onClick={onConfirm}>
          <span>加入群聊</span>
          <span style={styles.confirmArrow} aria-hidden>›</span>
        </button>
      </div>
    </section>
  </div>
}

export function ArkmeDSHBetaCommunityEntry({ onJoined }: ArkmeDSHBetaCommunityEntryProps) {
  const [phase, setPhase] = useState<EntryPhase>('loading')
  const [ready, setReady] = useState<ReadyEntry>()
  const [confirmationOpen, setConfirmationOpen] = useState(false)
  const epochRef = useRef(0)
  const joinInFlightRef = useRef<Promise<void>>()

  useEffect(() => {
    const epoch = ++epochRef.current
    void callArkme<ArkmeDSHBetaCommunityEntryState>('dsh-beta-community.entry-state')
      .then(async entry => {
        if (!entry.visible || entry.status !== 'ready' || entry.memberCount <= 0) return undefined
        const groupAvatar = entry.groupAvatar ?? {
          memberCount: entry.memberCount,
          strategy: 'legacy',
          computedAtMillis: 0,
          slots: entry.avatarRefs.slice(0, 5).map(avatarRef => ({ avatarRef })),
        }
        return { groupAvatar }
      })
      .then(result => {
        if (epochRef.current !== epoch) return
        if (result === undefined) {
          setReady(undefined)
          setPhase('hidden')
          return
        }
        setReady(result)
        setPhase('ready')
      })
      .catch(() => {
        if (epochRef.current === epoch) {
          setReady(undefined)
          setPhase('hidden')
        }
      })
    return () => { epochRef.current += 1 }
  }, [])

  const confirmJoin = (): void => {
    if (phase !== 'ready' || ready === undefined || joinInFlightRef.current !== undefined) return
    setConfirmationOpen(false)
    setPhase('joining')
    const epoch = epochRef.current
    let pending: Promise<void>
    pending = callArkme<ArkmeDSHBetaCommunityJoinResult>('dsh-beta-community.join')
      .then(async result => {
        if (epochRef.current !== epoch) return
        setPhase('hidden')
        setReady(undefined)
        try {
          await onJoined(result.source)
        } catch {
          // Chat has committed membership; opening/refreshing the surface cannot resurrect the entry.
        }
      })
      .catch(() => {
        if (epochRef.current === epoch) setPhase('ready')
      })
      .finally(() => {
        if (joinInFlightRef.current === pending) joinInFlightRef.current = undefined
      })
    joinInFlightRef.current = pending
  }

  if (phase === 'hidden') return null
  if (phase === 'loading' || ready === undefined) return <div style={styles.loading} aria-hidden />
  return <>
    <ArkmeDSHBetaCommunityEntryContent
      avatarUrls={[]}
      groupAvatar={ready.groupAvatar}
      joining={phase === 'joining'}
      onActivate={() => { if (phase === 'ready') setConfirmationOpen(true) }}
    />
    {confirmationOpen && typeof document !== 'undefined' && createPortal(
      <ArkmeDSHBetaCommunityJoinConfirmation
        avatarUrls={[]}
        groupAvatar={ready.groupAvatar}
        onCancel={() => { setConfirmationOpen(false) }}
        onConfirm={confirmJoin}
      />,
      document.body,
    )}
  </>
}
