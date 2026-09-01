import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { CheckCircleIcon } from '@phosphor-icons/react/dist/csr/CheckCircle'
import { CircleIcon } from '@phosphor-icons/react/dist/csr/Circle'
import { PencilSimpleIcon } from '@phosphor-icons/react/dist/csr/PencilSimple'
import { RobotIcon } from '@phosphor-icons/react/dist/csr/Robot'
import { WebhooksLogoIcon } from '@phosphor-icons/react/dist/csr/WebhooksLogo'
import type {
  ArkmeBotProvider,
  ArkmeBotSummary,
  ArkmePluginResponse,
  ArkmeUploadedAsset,
} from '../types.js'
import { ArkmeClientError, callArkme } from './api.js'
import { arkmeTheme } from './arkme-theme.js'

const MAX_BOT_AVATAR_BYTES = 5 * 1024 * 1024
const BOT_AVATAR_ACCEPT = '.png,.jpg,.jpeg,.webp,.heic,image/png,image/jpeg,image/webp,image/heic,image/heif'

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', padding: 16, overflowY: 'auto',
    boxSizing: 'border-box', background: 'var(--dsw-alias-bg-mask-1, rgba(19, 22, 26, 0.34))',
    backdropFilter: 'var(--dsw-mask-blur, blur(2px))', WebkitBackdropFilter: 'var(--dsw-mask-blur, blur(2px))',
  },
  dialog: {
    width: 'min(440px, calc(100vw - 32px))', height: 'auto', margin: 'auto', flex: 'none',
    display: 'flex', flexDirection: 'column', overflow: 'hidden', boxSizing: 'border-box', borderRadius: 14,
    border: `1px solid ${arkmeTheme.borderSoft}`, background: arkmeTheme.menu, color: arkmeTheme.text,
    boxShadow: 'var(--dsw-shadow-lv3, 0 18px 50px rgba(18, 22, 27, 0.24))',
  },
  header: { minHeight: 49, padding: '8px 12px 8px 16px', display: 'flex', alignItems: 'center', boxSizing: 'border-box', borderBottom: `1px solid ${arkmeTheme.borderSoft}` },
  heading: { flex: 1, margin: 0, fontSize: 16, lineHeight: '24px', fontWeight: 600 },
  close: {
    width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0,
    border: 0, borderRadius: 7, background: 'transparent', color: arkmeTheme.tertiary,
    cursor: 'pointer', font: 'inherit', fontSize: 24, lineHeight: 1,
  },
  body: { flex: 'none', minHeight: 0, overflow: 'visible', padding: '16px 20px 18px', boxSizing: 'border-box' },
  avatarPicker: { width: 76, height: 76, position: 'relative', margin: '0 auto', flex: 'none' },
  avatarButton: {
    width: 72, height: 72, display: 'grid', placeItems: 'center', padding: 0,
    boxSizing: 'border-box', border: `1px solid ${arkmeTheme.border}`, borderRadius: '50%',
    background: arkmeTheme.layer1, color: arkmeTheme.secondary, cursor: 'pointer',
  },
  avatar: {
    width: 70, height: 70, display: 'grid', placeItems: 'center', overflow: 'hidden', boxSizing: 'border-box',
    borderRadius: '50%', background: arkmeTheme.active, color: arkmeTheme.text,
  },
  avatarImage: { width: '100%', height: '100%', display: 'block', objectFit: 'cover' },
  avatarEdit: {
    width: 26, height: 26, position: 'absolute', right: 0, bottom: 0, display: 'grid', placeItems: 'center',
    boxSizing: 'border-box', border: `2px solid ${arkmeTheme.menu}`, borderRadius: '50%',
    background: arkmeTheme.primaryAction, color: arkmeTheme.onPrimaryAction, pointerEvents: 'none',
  },
  field: { display: 'grid', gap: 6, marginTop: 16 },
  label: { color: arkmeTheme.text, fontSize: 13, lineHeight: '18px', fontWeight: 600 },
  input: {
    width: '100%', minHeight: 42, padding: '0 10px', boxSizing: 'border-box', outline: 0,
    border: `1px solid ${arkmeTheme.border}`, borderRadius: 12, background: arkmeTheme.base,
    color: arkmeTheme.text, font: 'inherit', fontSize: 15, lineHeight: 1.45,
  },
  textarea: { minHeight: 72, paddingTop: 10, paddingBottom: 10, resize: 'none' },
  providerList: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 },
  providerOption: {
    minHeight: 42, padding: '0 10px', display: 'flex', alignItems: 'center', gap: 8,
    boxSizing: 'border-box', border: `1px solid ${arkmeTheme.borderSoft}`, borderRadius: 10,
    background: arkmeTheme.layer1, color: arkmeTheme.text, textAlign: 'left', cursor: 'pointer', font: 'inherit', fontSize: 14,
  },
  providerIcon: {
    width: 22, height: 22, flex: 'none', display: 'grid', placeItems: 'center', color: arkmeTheme.secondary, fontSize: 16,
  },
  radio: { width: 18, height: 18, flex: 'none', marginLeft: 'auto', color: arkmeTheme.tertiary },
  radioSelected: { color: arkmeTheme.primaryAction },
  providerHint: { margin: '7px 0 0', color: arkmeTheme.secondary, fontSize: 12, lineHeight: '18px' },
  error: { margin: '12px 0 0', color: arkmeTheme.danger, fontSize: 12, lineHeight: '18px' },
  footer: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginTop: 20 },
  cancel: {
    height: 40, padding: '0 14px', border: 0, borderRadius: 10, background: 'transparent', color: arkmeTheme.secondary,
    cursor: 'pointer', font: 'inherit', fontSize: 14,
  },
  submit: {
    height: 40, padding: '0 16px', border: 0, borderRadius: 10,
    background: arkmeTheme.primaryAction, color: arkmeTheme.onPrimaryAction,
    cursor: 'pointer', font: 'inherit', fontSize: 14, fontWeight: 600,
  },
  hiddenInput: { display: 'none' },
}

const providerCopy: Record<ArkmeBotProvider, { title: string; hint: string }> = {
  openclaw: {
    title: 'OpenClaw',
    hint: '连接本地 OpenClaw，在桌面运行 Bot。',
  },
  webhook: {
    title: 'Webhook',
    hint: '创建后生成 Webhook 地址，供外部系统推送。',
  },
}

function botErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function botAvatarMimeType(file: File): string {
  const mediaType = file.type.trim().toLowerCase()
  if (['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'].includes(mediaType)) return mediaType
  const fileName = file.name.trim().toLowerCase()
  if (fileName.endsWith('.png')) return 'image/png'
  if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) return 'image/jpeg'
  if (fileName.endsWith('.webp')) return 'image/webp'
  if (fileName.endsWith('.heic')) return 'image/heic'
  return ''
}

export async function uploadBotAvatar(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', '/arkme-self/api/upload')
    request.setRequestHeader('Content-Type', botAvatarMimeType(file))
    request.setRequestHeader('X-Arkme-File-Name', encodeURIComponent(file.name || 'bot-avatar'))
    request.onerror = () => { reject(new Error('Bot 头像上传网络错误')) }
    request.onload = () => {
      try {
        const payload = JSON.parse(request.responseText) as ArkmePluginResponse<ArkmeUploadedAsset>
        if (!payload.ok) { reject(new ArkmeClientError(payload.error)); return }
        const fileAssetUid = payload.value.fileAssetUid.trim()
        if (fileAssetUid === '') { reject(new Error('Bot 头像上传响应无效')); return }
        resolve(`file_asset://${fileAssetUid}`)
      } catch (error) { reject(error) }
    }
    request.send(file)
  })
}

function ProviderOption({ provider, selected, disabled, onSelect }: {
  provider: ArkmeBotProvider
  selected: boolean
  disabled: boolean
  onSelect(): void
}) {
  const copy = providerCopy[provider]
  return <button
    type="button" role="radio" aria-checked={selected} disabled={disabled}
    data-arkme-bot-provider={provider}
    style={{ ...styles.providerOption, ...(selected ? { borderColor: arkmeTheme.primaryAction, background: arkmeTheme.active } : {}) }}
    onClick={onSelect}
  >
    <span aria-hidden style={{ ...styles.providerIcon, ...(selected ? { color: arkmeTheme.primaryAction } : {}) }}>
      {provider === 'openclaw' ? <span>🦞</span> : <WebhooksLogoIcon size={20} />}
    </span>
    <span>{copy.title}</span>
    {selected
      ? <CheckCircleIcon aria-hidden size={20} weight="fill" style={{ ...styles.radio, ...styles.radioSelected }} />
      : <CircleIcon aria-hidden size={20} style={styles.radio} />}
  </button>
}

export function ArkmeBotCreateDialog({ onClose, onBotCreated, onBusyChange }: {
  onClose(): void
  onBotCreated?(bot: ArkmeBotSummary): void | Promise<void>
  onBusyChange?(busy: boolean): void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [provider, setProvider] = useState<ArkmeBotProvider>('openclaw')
  const [avatarFile, setAvatarFile] = useState<File>()
  const [avatarPreview, setAvatarPreview] = useState('')
  const [avatarPreviewFailed, setAvatarPreviewFailed] = useState(false)
  const [created, setCreated] = useState(false)
  const [busyLabel, setBusyLabel] = useState('')
  const [error, setError] = useState('')
  const nameInput = useRef<HTMLInputElement>(null)
  const avatarInput = useRef<HTMLInputElement>(null)
  const busy = busyLabel !== ''
  const canSubmit = !busy && !created && name.trim() !== ''

  useEffect(() => { nameInput.current?.focus() }, [])
  useEffect(() => { onBusyChange?.(busy) }, [busy, onBusyChange])
  useEffect(() => () => { if (avatarPreview !== '') URL.revokeObjectURL(avatarPreview) }, [avatarPreview])
  useEffect(() => {
    if (typeof document === 'undefined') return
    const closeFromKeyboard = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', closeFromKeyboard)
    return () => { document.removeEventListener('keydown', closeFromKeyboard) }
  }, [busy, onClose])

  const chooseAvatar = (file: File | undefined) => {
    if (file === undefined) return
    if (botAvatarMimeType(file) === '') { setError('请选择 PNG、JPG、WebP 或 HEIC 图片'); return }
    if (file.size <= 0 || file.size > MAX_BOT_AVATAR_BYTES) { setError('Bot 头像不能超过 5MB'); return }
    setAvatarFile(file)
    setAvatarPreviewFailed(false)
    setAvatarPreview(URL.createObjectURL(file))
    setError('')
  }

  const submit = async () => {
    const normalizedName = name.trim()
    if (busy || created) return
    if (normalizedName === '') { setError('请输入 Bot 名称'); nameInput.current?.focus(); return }
    setError('')
    try {
      let avatar = ''
      if (avatarFile !== undefined) {
        setBusyLabel('头像处理中...')
        avatar = await uploadBotAvatar(avatarFile)
      }
      setBusyLabel('创建中...')
      const bot = await callArkme<ArkmeBotSummary>('bots.create', {
        name: normalizedName,
        provider,
        ...(description.trim() === '' ? {} : { description: description.trim() }),
        ...(avatar === '' ? {} : { avatar }),
      })
      try {
        await onBotCreated?.(bot)
      } catch (caught) {
        setCreated(true)
        setError(`Bot 已创建，但无法打开私聊：${botErrorMessage(caught)}`)
        return
      }
      onClose()
    } catch (caught) {
      setError(botErrorMessage(caught))
    } finally {
      setBusyLabel('')
    }
  }

  return <div
    data-arkme-notification-blocking-overlay="true"
    role="presentation" style={styles.overlay}
    onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}
  >
    <section role="dialog" aria-modal="true" aria-labelledby="arkme-add-bot-title" style={styles.dialog}>
      <header style={styles.header}>
        <h2 id="arkme-add-bot-title" style={styles.heading}>创建 Bot</h2>
        <button type="button" style={styles.close} aria-label="关闭" disabled={busy} onClick={onClose}>×</button>
      </header>
      <div style={styles.body}>
        <input
          ref={avatarInput} type="file" tabIndex={-1} style={styles.hiddenInput} accept={BOT_AVATAR_ACCEPT}
          aria-label="选择 Bot 头像文件" disabled={busy}
          onChange={event => { chooseAvatar(event.currentTarget.files?.[0]); event.currentTarget.value = '' }}
        />

        <div style={styles.avatarPicker}>
          <button type="button" style={styles.avatarButton} disabled={busy} aria-label="上传 Bot 头像" title="上传头像" onClick={() => { avatarInput.current?.click() }}>
            <span style={styles.avatar} aria-hidden>
              {avatarPreview !== '' && !avatarPreviewFailed
                ? <img src={avatarPreview} alt="" style={styles.avatarImage} onError={() => { setAvatarPreviewFailed(true) }} />
                : <RobotIcon size={32} weight="fill" />}
            </span>
          </button>
          <span style={styles.avatarEdit} aria-hidden><PencilSimpleIcon size={14} weight="bold" /></span>
        </div>

        <input
          ref={nameInput} style={{ ...styles.input, marginTop: 16 }} value={name} disabled={busy} maxLength={64}
          placeholder="给 Bot 起个名字" onChange={event => { setName(event.currentTarget.value); setError('') }}
          onKeyDown={event => { if (event.key === 'Enter') void submit() }}
        />

        <fieldset style={{ ...styles.field, marginInline: 0, padding: 0, border: 0 }}>
          <legend style={{ ...styles.label, padding: 0 }}>接入方式</legend>
          <div role="radiogroup" aria-label="Bot 接入方式" style={styles.providerList}>
            <ProviderOption provider="openclaw" selected={provider === 'openclaw'} disabled={busy} onSelect={() => { setProvider('openclaw') }} />
            <ProviderOption provider="webhook" selected={provider === 'webhook'} disabled={busy} onSelect={() => { setProvider('webhook') }} />
          </div>
          <p style={styles.providerHint}>{providerCopy[provider].hint}</p>
        </fieldset>
        <label style={styles.field}>
          <span style={styles.label}>简介（可选）</span>
          <textarea
            style={{ ...styles.input, ...styles.textarea }} value={description} disabled={busy} maxLength={200}
            rows={3} placeholder="描述这个 Bot 的用途" onChange={event => { setDescription(event.currentTarget.value); setError('') }}
          />
        </label>
        {error !== '' && <p role="alert" style={styles.error}>{error}</p>}
        <footer style={styles.footer}>
          <button type="button" style={styles.cancel} disabled={busy} onClick={onClose}>取消</button>
          <button
            type="button" style={{ ...styles.submit, ...(canSubmit ? {} : { opacity: .45, cursor: 'not-allowed' }) }} disabled={!canSubmit}
            onClick={() => { void submit() }}
          >{busyLabel || '创建 Bot'}</button>
        </footer>
      </div>
    </section>
  </div>
}
