import { ArkmeCloseButton } from './ArkmeCloseButton.js'
import { useEffect, useRef, type CSSProperties } from 'react'
import type { TeamWorldPublisherState } from './TeamWorldPublisher.js'
import { ArkmeTeamAvatar } from './ArkmeTeamAvatar.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { arkmeTheme as c } from './arkme-theme.js'
import { tr } from './locale.js'

/** Publishing an existing message selects a principal; its content stays immutable. */
export function WorldPublishIdentityDialog({
  publisher,
  actorName,
  actorAvatarRef,
  busy,
  pending,
  loading,
  error,
  message,
  blockedReason,
  onRetry,
  onSelect,
  onClose,
  onPublish,
}: {
  publisher: TeamWorldPublisherState
  actorName?: string | undefined
  actorAvatarRef?: string | undefined
  busy: boolean
  pending: boolean
  loading: boolean
  error?: string | undefined
  message?: string | undefined
  blockedReason?: string | undefined
  onRetry(): void
  onSelect(id: string): void
  onClose(): void
  onPublish(): void
}) {
  const panelRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    panelRef.current?.querySelector<HTMLInputElement>('input[type=radio]:checked')?.focus()
    return () => previous?.focus()
  }, [])
  const teams =
    publisher.displayTeam && !publisher.teams.some((team) => team.jotmoId === publisher.displayTeam!.jotmoId)
      ? [publisher.displayTeam, ...publisher.teams]
      : publisher.teams
  const identityUnavailable = !!publisher.selected && (publisher.loading || !publisher.team)
  const disabled = busy || (!pending && (loading || !!error || !!blockedReason || identityUnavailable))
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={tr('选择发布身份')}
      style={backdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <section
        ref={panelRef}
        style={panel}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) {
            event.stopPropagation()
            onClose()
          }
          if (event.key === 'Tab') {
            const controls = [
              ...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)'),
            ]
            const first = controls[0],
              last = controls[controls.length - 1]
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault()
              last?.focus()
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault()
              first?.focus()
            }
          }
        }}
        data-world-publish-dialog="identity-only"
      >
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>{tr('选择发布身份')}</h2>
          <ArkmeCloseButton type="button" aria-label={tr('关闭发布窗口')} disabled={busy} style={close} onClick={onClose} />
        </header>
        <p style={{ margin: '12px 0 16px', color: c.secondary, fontSize: 12, lineHeight: 1.7 }}>
          {tr('将完整原消息公开到所选身份的世界。')}
        </p>
        <fieldset disabled={busy || pending} style={{ margin: 0, padding: 0, border: 0 }} aria-label={tr('发布身份')}>
          <label style={row}>
            <input
              type="radio"
              name="world-publish-identity"
              checked={!publisher.selected}
              onChange={() => onSelect('')}
            />
            <ArkmeUserAvatar avatarRef={actorAvatarRef} size={32} label={tr('我的头像')} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ display: 'block', fontSize: 14 }}>{actorName || tr('我')}</strong>
              <small style={{ color: c.secondary }}>{tr('个人身份')}</small>
            </span>
          </label>
          {teams.map((team) => (
            <label
              key={team.jotmoId}
              style={{ ...row, opacity: publisher.loading || !publisher.teams.includes(team) ? 0.6 : 1 }}
            >
              <input
                type="radio"
                name="world-publish-identity"
                checked={publisher.selected === team.jotmoId}
                disabled={publisher.loading || !publisher.teams.includes(team)}
                onChange={() => onSelect(team.jotmoId)}
              />
              <ArkmeTeamAvatar name={team.name} avatar={team.avatar} size={32} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ display: 'block', fontSize: 14, overflowWrap: 'anywhere' }}>{team.name}</strong>
                <small style={{ color: c.secondary }}>{tr('团队身份 · 由我发布')}</small>
              </span>
            </label>
          ))}
        </fieldset>
        {publisher.loading && (
          <p role="status" style={hint}>
            {tr('正在核验团队身份…')}
          </p>
        )}
        {publisher.error && (
          <p role="alert" style={hint}>
            {publisher.error}{' '}
            <button type="button" style={textButton} disabled={busy || pending} onClick={publisher.refresh}>
              {tr('重试加载团队身份')}
            </button>
          </p>
        )}
        {loading && (
          <p role="status" style={hint}>
            {tr('正在读取原内容…')}
          </p>
        )}
        {error && (
          <p role="alert" style={hint}>
            {error}{' '}
            {!pending && (
              <button type="button" style={textButton} disabled={busy} onClick={onRetry}>
                {tr('重试')}
              </button>
            )}
          </p>
        )}
        {message && (
          <p role={busy ? 'status' : 'alert'} style={hint}>
            {message}
          </p>
        )}
        {blockedReason && (
          <p role="alert" style={hint}>
            {blockedReason}
          </p>
        )}
        {!publisher.loading && identityUnavailable && (
          <p role="alert" style={hint}>
            {tr('当前团队身份不可用，请重新选择。')}
          </p>
        )}
        <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button type="button" disabled={busy} style={secondary} onClick={onClose}>
            {tr('取消')}
          </button>
          <button
            type="button"
            disabled={disabled}
            style={{ ...primary, opacity: disabled ? 0.55 : 1 }}
            onClick={onPublish}
          >
            {tr(busy ? '发布中…' : pending ? '确认发布结果' : '发布')}
          </button>
        </footer>
      </section>
    </div>
  )
}
const backdrop: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
  background: 'rgba(0,0,0,.22)',
}
const panel: CSSProperties = {
  width: 360,
  maxWidth: '100%',
  maxHeight: 'calc(100vh - 48px)',
  overflowY: 'auto',
  padding: 20,
  borderRadius: 14,
  background: c.base,
  color: c.text,
  boxShadow: '0 18px 60px rgba(0,0,0,.16)',
  boxSizing: 'border-box',
}
const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', cursor: 'pointer' }
const close: CSSProperties = {
  border: 0,
  padding: 5,
  background: 'transparent',
  color: c.secondary,
  cursor: 'pointer',
  display: 'inline-flex',
}
const hint: CSSProperties = {
  margin: '10px 0 0',
  fontSize: 12,
  color: c.secondary,
  lineHeight: 1.7,
  overflowWrap: 'anywhere',
}
const textButton: CSSProperties = {
  border: 0,
  padding: 0,
  font: 'inherit',
  background: 'transparent',
  color: c.text,
  textDecoration: 'underline',
  cursor: 'pointer',
}
const secondary: CSSProperties = {
  padding: '8px 14px',
  border: `1px solid ${c.borderSoft}`,
  borderRadius: 8,
  background: c.base,
  color: c.text,
  font: 'inherit',
  cursor: 'pointer',
}
const primary: CSSProperties = {
  ...secondary,
  borderColor: 'transparent',
  background: c.primaryAction,
  color: c.onPrimaryAction,
}
