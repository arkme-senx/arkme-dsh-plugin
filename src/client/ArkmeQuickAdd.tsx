import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { ArkmeBotProvider, ArkmeBotSummary, ArkmeSourceItem } from '../types.js'
import arkmeBotIconBase64 from '../../assets/icons/cpu-linear.svg'
import arkmeGroupIconBase64 from '../../assets/icons/profile-2user-linear.svg'
import arkmeQuickAddIconBase64 from '../../assets/icons/quick-add-sidebar.svg'
import arkmeUserAddIconBase64 from '../../assets/icons/user-add-linear.svg'
import { callArkme } from './api.js'
import { arkmeTheme } from './arkme-theme.js'

type QuickAddDialogKind = 'group' | 'bot'

const style: Record<string, CSSProperties> = {
  anchor: { position: 'relative' },
  row: {
    position: 'relative', width: '100%', minHeight: 60, display: 'flex', alignItems: 'center', gap: 10,
    padding: '8px 12px', boxSizing: 'border-box', border: 0, borderBottom: `1px solid ${arkmeTheme.borderSoft}`,
    background: 'transparent', color: arkmeTheme.text, textAlign: 'left', cursor: 'pointer', font: 'inherit',
  },
  rowSelected: { background: arkmeTheme.accentSoft, boxShadow: `inset 3px 0 ${arkmeTheme.accent}` },
  rowIconShell: {
    width: 44, height: 44, flex: 'none', display: 'grid', placeItems: 'center', borderRadius: 12,
    color: arkmeTheme.text,
  },
  rowIcon: { width: 24, height: 20 },
  rowContent: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 },
  rowTitle: { fontSize: 15, lineHeight: '20px', fontWeight: 500 },
  rowSubtitle: {
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    color: arkmeTheme.secondary, fontSize: 12, lineHeight: '17px',
  },
  menu: {
    position: 'absolute', zIndex: 90, top: 54, left: 12, width: 220, padding: '6px 12px',
    boxSizing: 'border-box', border: `1px solid ${arkmeTheme.borderSoft}`, borderRadius: 12,
    background: arkmeTheme.sidebar, boxShadow: '0 8px 24px rgba(0, 0, 0, .16)', color: arkmeTheme.text,
  },
  menuItem: {
    width: '100%', minHeight: 52, display: 'flex', alignItems: 'center', gap: 12,
    padding: '0 4px', border: 0, background: 'transparent', color: 'inherit', textAlign: 'left',
    cursor: 'pointer', font: 'inherit', fontSize: 16, fontWeight: 500,
  },
  menuIcon: { width: 24, height: 24, flex: 'none' },
  divider: { height: 1, margin: '0 0', background: arkmeTheme.borderSoft },
  overlay: {
    position: 'fixed', inset: 0, zIndex: 220, display: 'grid', placeItems: 'center', padding: 20,
    boxSizing: 'border-box', background: 'rgba(0, 0, 0, .28)',
  },
  dialog: {
    width: 'min(420px, 100%)', padding: 20, boxSizing: 'border-box', borderRadius: 16,
    background: arkmeTheme.sidebar, color: arkmeTheme.text, boxShadow: '0 24px 70px rgba(0, 0, 0, .28)',
  },
  heading: { margin: '0 0 16px', fontSize: 18, lineHeight: '26px', fontWeight: 600 },
  label: { display: 'grid', gap: 6, marginBottom: 12, color: arkmeTheme.secondary, fontSize: 12 },
  input: {
    width: '100%', height: 40, padding: '0 11px', boxSizing: 'border-box',
    border: `1px solid ${arkmeTheme.borderSoft}`, borderRadius: 9,
    background: 'transparent', color: arkmeTheme.text, font: 'inherit',
  },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
  button: {
    minWidth: 76, height: 36, padding: '0 14px', border: `1px solid ${arkmeTheme.borderSoft}`,
    borderRadius: 9, background: 'transparent', color: arkmeTheme.text, cursor: 'pointer', font: 'inherit',
  },
  primary: { borderColor: arkmeTheme.accent, background: arkmeTheme.accent, color: '#fff' },
  error: { margin: '8px 0', color: '#d14343', fontSize: 12 },
  success: { margin: '4px 0 12px', color: arkmeTheme.text, fontSize: 14, lineHeight: '22px' },
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

function ArkmeQuickAddMenuItem({ icon, label, onClick }: {
  icon: string
  label: string
  onClick(): void
}) {
  return <button type="button" role="menuitem" style={style.menuItem} onClick={onClick}>
    <span aria-hidden style={maskIcon(icon, style.menuIcon!)} />
    <span>{label}</span>
  </button>
}

export function ArkmeQuickAddMenu({ onContactAdd, onCreateGroup, onAddBot }: {
  onContactAdd(): void
  onCreateGroup(): void
  onAddBot(): void
}) {
  return <div role="menu" aria-label="添加" style={style.menu}>
    <ArkmeQuickAddMenuItem icon={arkmeUserAddIconBase64} label="添加联系人" onClick={onContactAdd} />
    <div aria-hidden style={style.divider} />
    <ArkmeQuickAddMenuItem icon={arkmeGroupIconBase64} label="创建群聊" onClick={onCreateGroup} />
    <div aria-hidden style={style.divider} />
    <ArkmeQuickAddMenuItem icon={arkmeBotIconBase64} label="添加 Bot" onClick={onAddBot} />
  </div>
}

export function ArkmeQuickAddRow({ selected = false, onContactAdd, onSourceCreated, onBotCreated }: {
  selected?: boolean
  onContactAdd(): void
  onSourceCreated(source: ArkmeSourceItem): void | Promise<void>
  onBotCreated?(bot: ArkmeBotSummary): void | Promise<void>
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [dialogKind, setDialogKind] = useState<QuickAddDialogKind>()
  const anchorRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!menuOpen || typeof document === 'undefined') return
    const closeFromOutside = (event: PointerEvent) => {
      if (anchorRef.current !== null && !anchorRef.current.contains(event.target as Node)) setMenuOpen(false)
    }
    const closeFromKeyboard = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', closeFromOutside)
    document.addEventListener('keydown', closeFromKeyboard)
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside)
      document.removeEventListener('keydown', closeFromKeyboard)
    }
  }, [menuOpen])

  const chooseDialog = (kind: QuickAddDialogKind) => {
    setMenuOpen(false)
    setDialogKind(kind)
  }

  return <div ref={anchorRef} style={style.anchor}>
    <button
      ref={triggerRef} type="button" role="treeitem" aria-selected={selected}
      aria-haspopup="menu" aria-expanded={menuOpen}
      style={{ ...style.row, ...(selected ? style.rowSelected : {}) }}
      onClick={() => { setMenuOpen(open => !open) }}
    >
      <span style={style.rowIconShell} aria-hidden>
        <span style={maskIcon(arkmeQuickAddIconBase64, style.rowIcon!)} />
      </span>
      <span style={style.rowContent}>
        <span style={style.rowTitle}>添加</span>
        <span style={style.rowSubtitle}>联系人、群聊与 Bot</span>
      </span>
    </button>
    {menuOpen && <ArkmeQuickAddMenu
      onContactAdd={() => {
        setMenuOpen(false)
        onContactAdd()
      }}
      onCreateGroup={() => { chooseDialog('group') }}
      onAddBot={() => { chooseDialog('bot') }}
    />}
    {dialogKind !== undefined && <ArkmeQuickAddDialog
      kind={dialogKind}
      onClose={() => {
        setDialogKind(undefined)
        triggerRef.current?.focus()
      }}
      onSourceCreated={onSourceCreated}
      {...(onBotCreated === undefined ? {} : { onBotCreated })}
    />}
  </div>
}

function ArkmeQuickAddDialog({ kind, onClose, onSourceCreated, onBotCreated }: {
  kind: QuickAddDialogKind
  onClose(): void
  onSourceCreated(source: ArkmeSourceItem): void | Promise<void>
  onBotCreated?(bot: ArkmeBotSummary): void | Promise<void>
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [provider, setProvider] = useState<ArkmeBotProvider>('openclaw')
  const [createdBot, setCreatedBot] = useState<ArkmeBotSummary>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const firstInput = useRef<HTMLInputElement>(null)

  useEffect(() => { firstInput.current?.focus() }, [])
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
      if (kind === 'group') {
        const source = await callArkme<ArkmeSourceItem>('group.create', {
          title: normalizedName,
          clientMutationId: crypto.randomUUID(),
        })
        await onSourceCreated(source)
        onClose()
        return
      }
      const bot = await callArkme<ArkmeBotSummary>('bots.create', {
        name: normalizedName,
        provider,
        ...(description.trim() === '' ? {} : { description: description.trim() }),
      })
      await onBotCreated?.(bot)
      setCreatedBot(bot)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  const title = kind === 'group' ? '创建群聊' : '添加 Bot'
  return <div
    role="presentation" style={style.overlay}
    onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}
  >
    <div role="dialog" aria-modal="true" aria-labelledby="arkme-quick-add-title" style={style.dialog}>
      <h2 id="arkme-quick-add-title" style={style.heading}>{title}</h2>
      {createdBot === undefined ? <>
        <label style={style.label}>{kind === 'group' ? '群聊名称' : 'Bot 名称'}
          <input
            ref={firstInput} style={style.input} value={name} disabled={busy}
            maxLength={kind === 'group' ? 80 : 64}
            onChange={event => { setName(event.target.value) }}
            onKeyDown={event => { if (event.key === 'Enter') void submit() }}
          />
        </label>
        {kind === 'bot' && <>
          <label style={style.label}>Provider
            <select
              style={style.input} value={provider} disabled={busy}
              onChange={event => { setProvider(event.target.value as ArkmeBotProvider) }}
            >
              <option value="openclaw">OpenClaw</option>
              <option value="webhook">Webhook</option>
            </select>
          </label>
          <label style={style.label}>描述（可选）
            <input
              style={style.input} value={description} disabled={busy} maxLength={200}
              onChange={event => { setDescription(event.target.value) }}
            />
          </label>
        </>}
        {error !== '' && <div role="alert" style={style.error}>{error}</div>}
        <div style={style.actions}>
          <button type="button" style={style.button} disabled={busy} onClick={onClose}>取消</button>
          <button
            type="button" style={{ ...style.button, ...style.primary }} disabled={busy || name.trim() === ''}
            onClick={() => { void submit() }}
          >{busy ? '处理中…' : '确认'}</button>
        </div>
      </> : <>
        <p style={style.success}>Bot“{createdBot.name}”已创建。</p>
        <div style={style.actions}>
          <button type="button" style={{ ...style.button, ...style.primary }} onClick={onClose}>完成</button>
        </div>
      </>}
    </div>
  </div>
}
