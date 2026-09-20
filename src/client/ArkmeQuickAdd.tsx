import { tr, useArkmeLocale } from './locale.js'
import { IconNewChatOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { PhoneCall } from '@phosphor-icons/react/dist/icons/PhoneCall'
import { ArkmeActionMenu } from './ArkmeDshMenu.js'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

import type { ArkmeBotSummary, ArkmeSourceItem } from '../types.js'
import arkmeBotIconBase64 from '../../assets/icons/cpu-linear.svg'
import arkmeGroupIconBase64 from '../../assets/icons/profile-2user-linear.svg'
import arkmeUserAddIconBase64 from '../../assets/icons/user-add-linear.svg'
import { callArkme } from './api.js'
import { ArkmeBotCreateDialog } from './ArkmeBotCreateDialog.js'
import { ArkmeCallSurface } from './ArkmeCallSurface.js'
import { arkmeTheme } from './arkme-theme.js'


type QuickAddDialogKind = 'group' | 'call' | 'bot'

const style: Record<string, CSSProperties> = {
  // Keep the menu above later sidebar rows without escaping the frame-wide overlay layer.
  anchor: { position: 'relative', zIndex: 10, flex: 'none' },
  trigger: {
    width: 40, height: 40, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    border: `1px solid ${arkmeTheme.borderSoft}`, borderRadius: 11, background: arkmeTheme.menu, color: '#555a64',
    cursor: 'pointer', font: 'inherit', fontSize: 23, lineHeight: 1, fontWeight: 300, outline: 0,
  },

  overlay: {
    position: 'fixed', inset: 0, zIndex: 1000, display: 'grid', placeItems: 'center', padding: 16,
    boxSizing: 'border-box', background: 'var(--dsw-alias-bg-mask-1, rgba(19, 22, 26, 0.34))',
    backdropFilter: 'var(--dsw-mask-blur, blur(2px))', WebkitBackdropFilter: 'var(--dsw-mask-blur, blur(2px))',
  },
  dialog: {
    width: 420, maxWidth: 'calc(100vw - 32px)', padding: 16, boxSizing: 'border-box', borderRadius: 12,
    border: '1px solid var(--dsw-alias-border-inverted, rgba(0, 0, 0, 0.04))',
    background: arkmeTheme.menu, color: arkmeTheme.text,
    boxShadow: 'var(--dsw-shadow-lv3, 0 18px 50px rgba(18, 22, 27, 0.24))',
  },
  dialogHeader: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 },
  heading: { flex: 1, margin: 0, fontSize: 18, lineHeight: '25px', fontWeight: 600 },
  close: {
    width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    padding: 0, border: 0, borderRadius: 6, background: 'transparent', color: arkmeTheme.text,
    cursor: 'pointer', font: 'inherit', fontSize: 24, lineHeight: 1,
  },
  label: { display: 'grid', gap: 8, marginBottom: 12, color: arkmeTheme.secondary, fontSize: 13, lineHeight: '18px' },
  input: {
    width: '100%', height: 40, padding: '0 12px', boxSizing: 'border-box', outline: 0,
    border: `1px solid ${arkmeTheme.borderSoft}`, borderRadius: 8,
    background: arkmeTheme.input, color: arkmeTheme.text, font: 'inherit', fontSize: 14,
  },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 20 },
  button: {
    minWidth: 65, height: 36, padding: '0 14px', border: `1px solid ${arkmeTheme.borderSoft}`,
    borderRadius: 8, background: 'transparent', color: arkmeTheme.text, cursor: 'pointer', font: 'inherit', fontSize: 14, fontWeight: 500,
  },
  primary: { borderColor: arkmeTheme.primaryAction, background: arkmeTheme.primaryAction, color: arkmeTheme.onPrimaryAction },
  error: { margin: '10px 0 0', color: arkmeTheme.danger, fontSize: 12, lineHeight: '18px' },
}

function maskIcon(base64: string, iconStyle: CSSProperties): CSSProperties {
  const source = `url(data:image/svg+xml;base64,${base64})`
  return {
    ...iconStyle,
    display: 'inline-block', background: 'currentColor',
    WebkitMaskImage: source, maskImage: source,
    WebkitMaskPosition: 'center', maskPosition: 'center',
    WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
    WebkitMaskSize: 'contain', maskSize: 'contain',
  }
}

export function ArkmeQuickAddMenu({ onContactAdd, onCreateGroup, onStartCall, onAddBot, onNewDshSession, error,
  anchor, open = true, onClose = () => {}, getAnchorRect,
}: {
  onContactAdd(): void
  onCreateGroup(): void
  onStartCall?: () => void
  onAddBot(): void
  onNewDshSession?: (() => void) | undefined
  error?: string
  open?: boolean
  anchor?: ReactNode
  onClose?: () => void
  getAnchorRect?: () => DOMRect | null
}) {
  const icon = (base64: string) => <span aria-hidden style={maskIcon(base64, { width: 16, height: 16 })} />
  return <span data-arkme-notification-blocking-overlay={open ? 'true' : undefined}>
    <ArkmeActionMenu label={tr("添加")} open={open} anchor={anchor} align="end" onClose={onClose}
      {...(getAnchorRect === undefined ? {} : { getAnchorRect })}
      actions={[
        onNewDshSession !== undefined && { id: 'dsh', label: '新建 DSH 会话', icon: <IconNewChatOutline16 />, onSelect: onNewDshSession },
        { id: 'contact', label: '添加联系人', icon: icon(arkmeUserAddIconBase64), onSelect: onContactAdd },
        { id: 'group', label: '创建群聊', icon: icon(arkmeGroupIconBase64), onSelect: onCreateGroup },
        { id: 'bot', label: '添加 Bot', icon: icon(arkmeBotIconBase64), onSelect: onAddBot },
        onStartCall !== undefined && { id: 'call', label: '发起通话', icon: <PhoneCall size={16} />, onSelect: onStartCall },
        error ? { id: 'error', label: <span role="alert">{error}</span>, disabled: true, onSelect: () => {} } : false,
      ]}
    />
  </span>
}

export function ArkmeQuickAddButton({
  onContactAdd,
  onSourceCreated,
  onBotCreated,
  onNewDshSession,
  notificationActivationRevision = 0,
  onBlockingOverlayChange,
}: {
  onContactAdd(): void
  onSourceCreated(source: ArkmeSourceItem): void | Promise<void>
  onBotCreated?(bot: ArkmeBotSummary): void | Promise<void>
  onNewDshSession?: (() => void) | undefined
  notificationActivationRevision?: number
  onBlockingOverlayChange?(open: boolean): void
}) {
  useArkmeLocale()
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuError, setMenuError] = useState('')
  const [dialogKind, setDialogKind] = useState<QuickAddDialogKind>()
  const [dialogBusy, setDialogBusy] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const restoreCallFocus = useRef(false)
  useEffect(() => {
    if (dialogKind === undefined && restoreCallFocus.current) {
      restoreCallFocus.current = false
      triggerRef.current?.focus({ preventScroll: true })
    }
  }, [dialogKind])

  const notificationRevisionRef = useRef(notificationActivationRevision)
  const pendingNotificationDismissRef = useRef(false)
  const blockingOverlayOpen = menuOpen || dialogKind !== undefined


  useLayoutEffect(() => {
    onBlockingOverlayChange?.(blockingOverlayOpen)
  }, [blockingOverlayOpen, onBlockingOverlayChange])

  useEffect(() => {
    if (notificationRevisionRef.current === notificationActivationRevision) return
    notificationRevisionRef.current = notificationActivationRevision
    pendingNotificationDismissRef.current = true
    setMenuOpen(false)
    if (!dialogBusy) {
      pendingNotificationDismissRef.current = false
      setDialogKind(undefined)
    }
  }, [notificationActivationRevision])
  useEffect(() => {
    if (dialogBusy || !pendingNotificationDismissRef.current) return
    pendingNotificationDismissRef.current = false
    setDialogKind(undefined)
  }, [dialogBusy])


  const chooseDialog = (kind: QuickAddDialogKind) => {
    setMenuOpen(false)
    setDialogBusy(false)
    setDialogKind(kind)
  }

  const menu = <ArkmeQuickAddMenu
      open={menuOpen} onClose={() => setMenuOpen(false)}
      anchor={<button data-arkme-feedback="neutral"
        ref={triggerRef} type="button" aria-label={onNewDshSession ? '新建 DSH 会话、添加联系人、群聊、发起通话或添加 Bot' : '添加联系人、群聊、发起通话或添加 Bot'} title={tr("添加")}
        aria-haspopup="menu" aria-expanded={menuOpen} style={style.trigger}
        onClick={() => { setMenuError(''); setMenuOpen(open => !open) }}
      >＋</button>}
      error={menuError}
      onNewDshSession={onNewDshSession === undefined ? undefined : () => {
        try { onNewDshSession(); setMenuError(''); setMenuOpen(false) }
        catch (error) { setMenuError(error instanceof Error ? error.message : '暂时无法新建 DSH 会话，请稍后再试') }
      }}
      onContactAdd={() => {
        setMenuOpen(false)
        onContactAdd()
      }}
      onCreateGroup={() => { chooseDialog('group') }}
      onStartCall={() => { chooseDialog('call') }}
      onAddBot={() => { chooseDialog('bot') }}
    />
  return <div ref={anchorRef} style={style.anchor}>
    {menu}
    {dialogKind === 'call' && <ArkmeCallSurface presentation="dialog" initialPickerOpen onClose={() => {
      pendingNotificationDismissRef.current = false
      restoreCallFocus.current = true
      setDialogKind(undefined)
    }} />}
    {dialogKind === 'group' && <ArkmeGroupCreateDialog
      onClose={() => {
        pendingNotificationDismissRef.current = false
        setDialogBusy(false)
        setDialogKind(undefined)
        triggerRef.current?.focus()
      }}
      onBusyChange={setDialogBusy}
      onSourceCreated={onSourceCreated}
    />}
    {dialogKind === 'bot' && <ArkmeBotCreateDialog
      onClose={() => {
        pendingNotificationDismissRef.current = false
        setDialogBusy(false)
        setDialogKind(undefined)
        triggerRef.current?.focus()
      }}
      onBusyChange={setDialogBusy}
      {...(onBotCreated === undefined ? {} : { onBotCreated })}
    />}
  </div>
}

function ArkmeGroupCreateDialog({ onClose, onSourceCreated, onBusyChange }: {
  onClose(): void
  onSourceCreated(source: ArkmeSourceItem): void | Promise<void>
  onBusyChange?(busy: boolean): void
}) {
  useArkmeLocale()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const firstInput = useRef<HTMLInputElement>(null)

  useEffect(() => { firstInput.current?.focus() }, [])
  useEffect(() => { onBusyChange?.(busy) }, [busy, onBusyChange])
  useEffect(() => {
    if (typeof document === 'undefined') return
    const closeFromKeyboard = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', closeFromKeyboard)
    return () => { document.removeEventListener('keydown', closeFromKeyboard) }
  }, [busy, onClose])

  const submit = async () => {
    const normalizedName = name.trim()
    if (busy || normalizedName === '') return
    setBusy(true)
    setError('')
    try {
      const source = await callArkme<ArkmeSourceItem>('group.create', {
        title: normalizedName,
        clientMutationId: crypto.randomUUID(),
      })
      await onSourceCreated(source)
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  return <div
    data-arkme-notification-blocking-overlay="true"
    role="presentation" style={style.overlay}
    onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}
  >
    <div role="dialog" aria-modal="true" aria-labelledby="arkme-quick-add-title" style={style.dialog}>
      <div style={style.dialogHeader}>
        <h2 id="arkme-quick-add-title" style={style.heading}>{tr("创建群聊")}</h2>
        <button data-arkme-feedback="neutral" type="button" style={style.close} aria-label={tr("关闭")} disabled={busy} onClick={onClose}>×</button>
      </div>
      <label style={style.label}>{tr("群聊名称")}<input
          ref={firstInput} style={style.input} value={name} disabled={busy}
          maxLength={80}
          onChange={event => { setName(event.target.value) }}
          onKeyDown={event => { if (event.key === 'Enter') void submit() }}
        />
      </label>
      {error !== '' && <div role="alert" style={style.error}>{error}</div>}
      <div style={style.actions}>
        <button data-arkme-feedback="neutral" type="button" style={style.button} disabled={busy} onClick={onClose}>{tr("取消")}</button>
        <button data-arkme-feedback="primary"
          type="button" style={{ ...style.button, ...style.primary }} disabled={busy || name.trim() === ''}
          onClick={() => { void submit() }}
        >{busy ? tr("处理中…") : tr("确认")}</button>
      </div>
    </div>
  </div>
}
