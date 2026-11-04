import { ArkmeConfirmDialog } from './ArkmeConfirmDialog.js'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Globe } from '@phosphor-icons/react/dist/icons/Globe'
import { DotsThree } from '@phosphor-icons/react/dist/icons/DotsThree'
import type { WorldPublication } from '../world-publication-contract.js'
import { worldPublications, type PublicationTarget } from './world-publications.js'
import { arkmeAuthStore } from './auth-store.js'
import { callArkme } from './api.js'
import { arkmeTheme as c } from './arkme-theme.js'
import { tr } from './locale.js'
function usePublications(target?: PublicationTarget) {
  const auth = useSyncExternalStore(
    arkmeAuthStore.subscribe,
    arkmeAuthStore.getSnapshot,
    arkmeAuthStore.getSnapshot,
  ).auth
  const account = auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : ''
  const encoded = JSON.stringify(target),
    stable = useMemo(() => target, [encoded])
  const key = stable ? worldPublications.key(account, stable) : ''
  const subscribe = useCallback(
    (listener: () => void) => (account && stable ? worldPublications.subscribe(account, stable, listener) : () => {}),
    [account, stable],
  )
  const snapshot = useCallback(() => worldPublications.snapshot(key), [key])
  const state = useSyncExternalStore(subscribe, snapshot, snapshot)
  return { account, key, state, enabled: !!account && !!stable }
}
export function WorldPublicationBadge({ target }: { target?: PublicationTarget | undefined }) {
  const { state, enabled } = usePublications(target)
  const active = state.publications.filter((p) => p.requested)
  if (!enabled || !active.length) return null
  const label = tr('已发到世界') + ' · ' + active.map((p) => p.label).join('、')
  return (
    <span
      title={label}
      aria-label={label}
      data-world-publication-badge
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        marginLeft: 5,
        color: c.secondary,
        verticalAlign: 'middle',
      }}
    >
      <Globe size={13} aria-hidden />
    </span>
  )
}
/** The capability is a UI hint. Existing backend mutations recheck current owner/team rights. */
export function WorldPublicationActions({
  target,
  onUnpublished,
}: {
  target?: PublicationTarget | undefined
  onUnpublished?: () => void
}) {
  const { account, key, state, enabled } = usePublications(target)
  const [open, setOpen] = useState(false),
    [selected, setSelected] = useState<WorldPublication>(),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('')
  const command = useRef<{ ref: string; uid: string }>(),
    active = useRef<AbortController>()
  useEffect(() => {
    setOpen(false)
    setSelected(undefined)
    setMessage('')
    setBusy(false)
    command.current = undefined
    active.current?.abort()
    return () => active.current?.abort()
  }, [key, account])
  const candidates = state.publications.filter((p) => p.requested && p.canUnpublish)
  const cancel = async () => {
    if (!selected || busy) return
    if (!command.current || command.current.ref !== selected.ref)
      command.current = { ref: selected.ref, uid: crypto.randomUUID() }
    const controller = new AbortController()
    active.current = controller
    setBusy(true)
    setMessage('')
    try {
      const result = await callArkme<{ completed: boolean; pending: boolean }>(
        'world.publications',
        { action: 'unpublish', accountKey: account, publicationRef: selected.ref, requestUid: command.current.uid },
        controller.signal,
      )
      if (controller.signal.aborted) return
      if (!result.completed) {
        setMessage(result.pending ? '正在确认取消结果，请使用原请求重试。' : '取消未完成，请刷新状态后重试。')
        return
      }
      worldPublications.remove(selected.key)
      window.dispatchEvent(new Event('arkme-world-publications-changed'))
      window.dispatchEvent(new Event('arkme-reaction-policy-changed'))
      setSelected(undefined)
      setOpen(false)
      command.current = undefined
      onUnpublished?.()
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : '取消公开失败，请重试')
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  if (!enabled) return null
  return (
    <div style={{ position: 'relative' }}>
      {(state.error || candidates.length > 0) && (
        <button
          type="button"
          aria-label={tr('公开发布管理')}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          style={iconButton}
        >
          <DotsThree size={22} />
        </button>
      )}
      {open && (
        <div
          role="menu"
          aria-label={tr('公开发布管理')}
          style={{
            position: 'absolute',
            right: 0,
            top: 30,
            width: 240,
            padding: 8,
            border: `1px solid ${c.borderSoft}`,
            borderRadius: 10,
            background: c.base,
            boxShadow: '0 8px 28px #0002',
            zIndex: 5,
          }}
        >
          {candidates.map((p) => (
            <button
              type="button"
              role="menuitem"
              key={p.ref}
              onClick={() => {
                setSelected(p)
                setOpen(false)
                setMessage('')
              }}
              style={{ ...menuButton, color: c.danger }}
            >
              {tr('取消公开发布')}
              {candidates.length > 1 ? ` · ${p.label}` : ''}
            </button>
          ))}
          {state.error && (
            <div role="alert" style={{ fontSize: 12, lineHeight: 1.7 }}>
              {state.error}
              <button type="button" style={menuButton} onClick={() => worldPublications.retry(key)}>
                {tr('重试查询公开状态')}
              </button>
            </div>
          )}
        </div>
      )}
      {selected && (
        <ArkmeConfirmDialog
          titleId="world-unpublish-title"
          title={tr('取消公开发布')}
          description={tr('原消息保留，内容将从世界中取消公开。')}
          busy={busy}
          confirmTone="danger"
          confirmLabel={tr(message ? '重试取消公开' : '确认取消公开')}
          busyLabel={tr('正在取消…')}
          cancelLabel={tr('返回')}
          error={message}
          onClose={() => setSelected(undefined)}
          onConfirm={() => {
            void cancel()
          }}
        >
          <p style={{ fontSize: 12, color: c.secondary }}>{selected.label}</p>
        </ArkmeConfirmDialog>
      )}
    </div>
  )
}
const iconButton = {
  border: 0,
  background: 'transparent',
  color: c.secondary,
  cursor: 'pointer',
  padding: 5,
  display: 'inline-flex',
}
const menuButton = {
  display: 'block',
  width: '100%',
  border: 0,
  background: 'transparent',
  color: c.text,
  cursor: 'pointer',
  padding: '8px 10px',
  font: 'inherit',
  fontSize: 13,
  textAlign: 'left' as const,
}
