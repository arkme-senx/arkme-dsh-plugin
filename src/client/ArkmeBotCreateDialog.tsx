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
    position: 'fixed', inset: 0, zIndex: 1000, display: 'grid', placeItems: 'center', padding: 16,
    boxSizing: 'border-box', background: 'var(--dsw-alias-bg-mask-1, rgba(19, 22, 26, 0.34))',
    backdropFilter: 'var(--dsw-mask-blur, blur(2px))', WebkitBackdropFilter: 'var(--dsw-mask-blur, blur(2px))',
  },
  dialog: {
    width: 460, height: 640, maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 32px)',
    display: 'flex', flexDirection: 'column', overflow: 'hidden', boxSizing: 'border-box', borderRadius: 16,
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
  body: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 16px 24px', boxSizing: 'border-box' },
  intro: { margin: 0, color: arkmeTheme.secondary, fontSize: 14, lineHeight: 1.5 },
  avatarCard: {
    width: '100%', marginTop: 16, padding: 16, display: 'flex', alignItems: 'center', gap: 12,
    boxSizing: 'border-box', border: `1px solid ${arkmeTheme.borderSoft}`, borderRadius: 16,
    background: arkmeTheme.layer1, color: arkmeTheme.text, textAlign: 'left', cursor: 'pointer', font: 'inherit',
  },
  avatarAction: { position: 'relative', width: 72, height: 72, flex: 'none', display: 'grid', placeItems: 'center' },
  avatar: {
    width: 64, height: 64, display: 'grid', placeItems: 'center', overflow: 'hidden', boxSizing: 'border-box',
    border: `2px solid ${arkmeTheme.border}`, borderRadius: '50%', background: arkmeTheme.active, color: arkmeTheme.text,
  },
  avatarImage: { width: '100%', height: '100%', display: 'block', objectFit: 'cover' },
  avatarEdit: {
    position: 'absolute', right: 4, bottom: 4, width: 20, height: 20, display: 'grid', placeItems: 'center',
    borderRadius: '50%', background: arkmeTheme.primaryAction, color: arkmeTheme.onPrimaryAction,
    boxShadow: '0 2px 6px rgba(0,0,0,.12)', transition: 'opacity 140ms ease',
  },
  cardCopy: { minWidth: 0, flex: 1 },
  cardTitle: { margin: 0, color: arkmeTheme.text, fontSize: 16, lineHeight: '22px', fontWeight: 700 },
  cardDescription: { margin: '4px 0 0', color: arkmeTheme.secondary, fontSize: 13, lineHeight: 1.45 },
  field: { display: 'grid', gap: 8, marginTop: 18 },
  label: { color: arkmeTheme.text, fontSize: 14, lineHeight: '20px', fontWeight: 700 },
  input: {
    width: '100%', minHeight: 48, padding: '0 10px', boxSizing: 'border-box', outline: 0,
    border: `1px solid ${arkmeTheme.border}`, borderRadius: 12, background: arkmeTheme.base,
    color: arkmeTheme.text, font: 'inherit', fontSize: 15, lineHeight: 1.45,
  },
  textarea: { minHeight: 92, paddingTop: 12, paddingBottom: 12, resize: 'vertical' },
  providerList: { display: 'grid', gap: 10 },
  providerCard: {
    width: '100%', minHeight: 78, padding: 16, display: 'flex', alignItems: 'center', gap: 12,
    boxSizing: 'border-box', border: `1px solid ${arkmeTheme.borderSoft}`, borderRadius: 16,
    background: arkmeTheme.layer1, color: arkmeTheme.text, textAlign: 'left', cursor: 'pointer', font: 'inherit',
  },
  providerIcon: {
    width: 40, height: 40, flex: 'none', display: 'grid', placeItems: 'center', borderRadius: '50%',
    background: arkmeTheme.base, color: arkmeTheme.secondary, fontSize: 20,
  },
  radio: { width: 20, height: 20, flex: 'none', color: arkmeTheme.tertiary },
  radioSelected: { color: arkmeTheme.text },
  error: { margin: '12px 0 0', color: arkmeTheme.danger, fontSize: 12, lineHeight: '18px' },
  submit: {
    width: '100%', height: 50, marginTop: 24, border: 0, borderRadius: 12,
    background: arkmeTheme.primaryAction, color: arkmeTheme.onPrimaryAction,
    cursor: 'pointer', font: 'inherit', fontSize: 16, fontWeight: 600,
  },
  hiddenInput: { display: 'none' },
}

const providerCopy: Record<ArkmeBotProvider, { title: string; description: string }> = {
  openclaw: {
    title: 'OpenClaw',
    description: '连接本地 OpenClaw，用对话方式驱动你的桌面运行时',
  },
  webhook: {
    title: 'Webhook Bot',
    description: '创建后自动生成 webhook 地址，外部系统可直接推送文本消息到这个 Bot',
  },
}

function botErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function botAvatarMimeType(file: File): string {
  const mediaType = file.type.trim().toLowerCase()
  if (['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'].includes(mediaType)) return mediaType
  const fileName = file.name.trim().toLowerCase()
  if (fileName.endsWith('.png')) return 'image/png'
  if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) return 'image/jpeg'
  if (fileName.endsWith('.webp')) return 'image/webp'
  if (fileName.endsWith('.heic')) return 'image/heic'
  return ''
}

async function uploadBotAvatar(file: File): Promise<string> {
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

function ProviderCard({ provider, selected, disabled, onSelect }: {
  provider: ArkmeBotProvider
  selected: boolean
  disabled: boolean
  onSelect(): void
}) {
  const copy = providerCopy[provider]
  return <button
    type="button" role="radio" aria-checked={selected} disabled={disabled}
    data-arkme-bot-provider={provider} style={styles.providerCard} onClick={onSelect}
  >
    <span aria-hidden style={{ ...styles.providerIcon, ...(selected ? { color: arkmeTheme.text } : {}) }}>
      {provider === 'openclaw' ? <span>🦞</span> : <WebhooksLogoIcon size={20} />}
    </span>
    <span style={styles.cardCopy}>
      <span style={{ ...styles.cardTitle, display: 'block' }}>{copy.title}</span>
      <span style={{ ...styles.cardDescription, display: 'block' }}>{copy.description}</span>
    </span>
    {selected
      ? <CheckCircleIcon aria-hidden size={20} weight="fill" style={{ ...styles.radio, ...styles.radioSelected }} />
      : <CircleIcon aria-hidden size={20} style={styles.radio} />}
  </button>
}

export function ArkmeBotCreateDialog({ onClose, onBotCreated }: {
  onClose(): void
  onBotCreated?(bot: ArkmeBotSummary): void | Promise<void>
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [provider, setProvider] = useState<ArkmeBotProvider>('openclaw')
  const [avatarFile, setAvatarFile] = useState<File>()
  const [avatarPreview, setAvatarPreview] = useState('')
  const [avatarPreviewFailed, setAvatarPreviewFailed] = useState(false)
  const [avatarHovered, setAvatarHovered] = useState(false)
  const [busyLabel, setBusyLabel] = useState('')
  const [error, setError] = useState('')
  const nameInput = useRef<HTMLInputElement>(null)
  const avatarInput = useRef<HTMLInputElement>(null)
  const busy = busyLabel !== ''

  useEffect(() => { nameInput.current?.focus() }, [])
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
    if (busy) return
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
      try { await onBotCreated?.(bot) } catch { /* Bot creation is authoritative; a list refresh failure must not invite a duplicate retry. */ }
      onClose()
    } catch (caught) {
      setError(botErrorMessage(caught))
    } finally {
      setBusyLabel('')
    }
  }

  return <div
    role="presentation" style={styles.overlay}
    onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}
  >
    <section role="dialog" aria-modal="true" aria-labelledby="arkme-add-bot-title" style={styles.dialog}>
      <header style={styles.header}>
        <h2 id="arkme-add-bot-title" style={styles.heading}>添加 Bot</h2>
        <button type="button" style={styles.close} aria-label="关闭" disabled={busy} onClick={onClose}>×</button>
      </header>
      <div style={styles.body}>
        <p style={styles.intro}>创建一个新的 Bot 入口。OpenClaw 适合本地驱动，Webhook Bot 适合外部系统推送。</p>
        <button
          type="button" style={styles.avatarCard} disabled={busy}
          aria-label="选择 Bot 头像" onClick={() => { avatarInput.current?.click() }}
          onMouseEnter={() => { if (!busy) setAvatarHovered(true) }}
          onMouseLeave={() => { setAvatarHovered(false) }}
        >
          <span style={styles.avatarAction}>
            <span style={styles.avatar} aria-hidden>
              {avatarPreview !== '' && !avatarPreviewFailed
                ? <img src={avatarPreview} alt="" style={styles.avatarImage} onError={() => { setAvatarPreviewFailed(true) }} />
                : <RobotIcon size={30} weight="fill" />}
            </span>
            <span style={{ ...styles.avatarEdit, opacity: avatarHovered ? 1 : 0 }} aria-hidden><PencilSimpleIcon size={12} weight="bold" /></span>
          </span>
          <span style={styles.cardCopy}>
            <span style={{ ...styles.cardTitle, display: 'block' }}>Bot 头像</span>
            <span style={{ ...styles.cardDescription, display: 'block' }}>
              {avatarFile === undefined ? '默认会使用统一 bot 头像，点此可改成自定义头像' : '已选择自定义头像，点此可重新更换'}
            </span>
          </span>
        </button>
        <input
          ref={avatarInput} type="file" tabIndex={-1} style={styles.hiddenInput} accept={BOT_AVATAR_ACCEPT}
          aria-label="选择 Bot 头像文件" disabled={busy}
          onChange={event => { chooseAvatar(event.currentTarget.files?.[0]); event.currentTarget.value = '' }}
        />

        <label style={styles.field}>
          <span style={styles.label}>Bot 名称</span>
          <input
            ref={nameInput} style={styles.input} value={name} disabled={busy} maxLength={64}
            placeholder="例如：我的自动化助手" onChange={event => { setName(event.currentTarget.value); setError('') }}
            onKeyDown={event => { if (event.key === 'Enter') void submit() }}
          />
        </label>

        <fieldset style={{ ...styles.field, marginInline: 0, padding: 0, border: 0 }}>
          <legend style={{ ...styles.label, padding: 0 }}>接入方式</legend>
          <div role="radiogroup" aria-label="Bot 接入方式" style={styles.providerList}>
            <ProviderCard provider="openclaw" selected={provider === 'openclaw'} disabled={busy} onSelect={() => { setProvider('openclaw') }} />
            <ProviderCard provider="webhook" selected={provider === 'webhook'} disabled={busy} onSelect={() => { setProvider('webhook') }} />
          </div>
        </fieldset>

        <label style={styles.field}>
          <span style={styles.label}>说明（可选）</span>
          <textarea
            style={{ ...styles.input, ...styles.textarea }} value={description} disabled={busy} maxLength={200}
            rows={3} placeholder="描述这个 Bot 的用途" onChange={event => { setDescription(event.currentTarget.value); setError('') }}
          />
        </label>
        {error !== '' && <p role="alert" style={styles.error}>{error}</p>}
        <button
          type="button" style={styles.submit} disabled={busy}
          onClick={() => { void submit() }}
        >{busyLabel || '确认创建'}</button>
      </div>
    </section>
  </div>
}
