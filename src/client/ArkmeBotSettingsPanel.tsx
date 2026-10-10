import { tr, useArkmeLocale, arkmeIntlLocale } from './locale.js'
import { ArkmeRightPanelHeader } from './ArkmeRightPanelHeader.js'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { PencilSimpleIcon } from '@phosphor-icons/react/dist/csr/PencilSimple'
import { RobotIcon } from '@phosphor-icons/react/dist/csr/Robot'
import type { ArkmeBotManageProfile, ArkmeBotNotificationPreference, ArkmeBotSummary } from '../types.js'
import { projectArkmeChatAttentionFromMuted } from '../chat-attention.js'
import { callArkme } from './api.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { botAvatarMimeType, uploadBotAvatar } from './ArkmeBotCreateDialog.js'
import { arkmeTheme } from './arkme-theme.js'

const MAX_AVATAR_BYTES = 5 * 1024 * 1024

const styles: Record<string, CSSProperties> = {
  backdrop: { position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(20, 23, 28, .18)' },
  panel: { position: 'absolute', top: 0, right: 0, width: 'min(405px, 100vw)', height: '100%', display: 'flex', flexDirection: 'column', background: arkmeTheme.menu, color: arkmeTheme.text, boxShadow: '-8px 0 28px rgba(20,23,31,.14)' },
  scroll: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 20px 24px' },
  summary: { display: 'flex', gap: 12, alignItems: 'flex-start' },
  identity: { display: 'flex', gap: 14, alignItems: 'center', padding: '22px 0 20px' },
  avatarButton: { width: 68, height: 68, flex: 'none', position: 'relative', display: 'grid', placeItems: 'center', padding: 0, overflow: 'visible', border: 0, borderRadius: '50%', background: 'transparent', cursor: 'pointer' },
  avatarEdit: { position: 'absolute', right: -2, bottom: -2, width: 22, height: 22, display: 'grid', placeItems: 'center', border: `2px solid ${arkmeTheme.menu}`, borderRadius: '50%', background: arkmeTheme.primaryAction, color: arkmeTheme.onPrimaryAction },
  summaryText: { minWidth: 0, flex: 1 },
  nameLine: { display: 'flex', minWidth: 0, alignItems: 'center', gap: 5 },
  summaryName: { margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 18, fontWeight: 700 },
  titleEdit: { width: 24, height: 24, flex: 'none', display: 'grid', placeItems: 'center', padding: 0, border: 0, borderRadius: 6, background: 'transparent', color: arkmeTheme.tertiary, cursor: 'pointer' },
  meta: { margin: '5px 0 0', color: arkmeTheme.secondary, fontSize: 12, lineHeight: '18px' },
  label: { display: 'block', marginBottom: 6, color: arkmeTheme.secondary, fontSize: 12, fontWeight: 600 },
  input: { width: '100%', height: 38, padding: '0 10px', boxSizing: 'border-box', border: `1px solid ${arkmeTheme.border}`, borderRadius: 9, outline: 0, background: arkmeTheme.base, color: arkmeTheme.text, font: 'inherit', fontSize: 13 },
  textarea: { width: '100%', minHeight: 72, padding: 10, boxSizing: 'border-box', border: `1px solid ${arkmeTheme.border}`, borderRadius: 9, outline: 0, resize: 'vertical', background: arkmeTheme.base, color: arkmeTheme.text, font: 'inherit', fontSize: 13, lineHeight: '20px' },
  field: { marginTop: 14 },
  section: { borderTop: `1px solid ${arkmeTheme.borderSoft}` },
  row: { minHeight: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, color: arkmeTheme.text, fontSize: 13 },
  rowButton: { width: '100%', minHeight: 52, display: 'flex', alignItems: 'center', gap: 10, padding: 0, border: 0, borderBottom: `1px solid ${arkmeTheme.borderSoft}`, background: 'transparent', color: arkmeTheme.text, cursor: 'pointer', font: 'inherit', textAlign: 'left' },
  rowMain: { minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 3 },
  rowTitle: { fontSize: 14, fontWeight: 500 },
  rowValue: { overflow: 'hidden', color: arkmeTheme.secondary, textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 },
  switch: { width: 38, height: 22, padding: 2, display: 'flex', alignItems: 'center', border: 0, borderRadius: 99, cursor: 'pointer' },
  knob: { width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'transform .15s ease' },
  sectionTitle: { margin: '20px 0 8px', fontSize: 12, fontWeight: 600, color: arkmeTheme.secondary },
  code: { margin: '6px 0 0', padding: 8, overflowWrap: 'anywhere', borderRadius: 8, background: arkmeTheme.base, color: arkmeTheme.secondary, fontSize: 12, lineHeight: '18px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  action: { height: 34, padding: '0 11px', border: `1px solid ${arkmeTheme.border}`, borderRadius: 8, background: arkmeTheme.menu, color: arkmeTheme.text, cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 600 },
  primary: { width: '100%', height: 40, marginTop: 20, border: 0, borderRadius: 10, background: arkmeTheme.primaryAction, color: arkmeTheme.onPrimaryAction, cursor: 'pointer', font: 'inherit', fontSize: 14, fontWeight: 700 },
  danger: { width: '100%', minHeight: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 0, border: 0, borderBottom: `1px solid ${arkmeTheme.borderSoft}`, background: 'transparent', color: arkmeTheme.danger, cursor: 'pointer', font: 'inherit', fontSize: 14, textAlign: 'left' },
  error: { margin: '10px 0 0', color: arkmeTheme.danger, fontSize: 12, lineHeight: '18px' },
  hint: { margin: '5px 0 0', color: arkmeTheme.secondary, fontSize: 12, lineHeight: '18px' },
  hidden: { display: 'none' },
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }

function Toggle({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange(value: boolean): void }) {
  return <button data-arkme-feedback="neutral" type="button" role="switch" aria-checked={checked} disabled={disabled} style={{ ...styles.switch, background: checked ? arkmeTheme.primaryAction : arkmeTheme.border, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? .55 : 1 }} onClick={() => { onChange(!checked) }}>
    <span style={{ ...styles.knob, transform: checked ? 'translateX(16px)' : 'translateX(0)' }} />
  </button>
}

export function ArkmeBotSettingsPanel({ bot, onClose, onUpdated, onDeleted }: {
  bot: ArkmeBotSummary
  onClose(): void
  onUpdated(bot: ArkmeBotSummary): void
  onDeleted(): void
}) {
  useArkmeLocale()
  const [profile, setProfile] = useState<ArkmeBotManageProfile>()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [mentionEntryEnabled, setMentionEntryEnabled] = useState(true)
  const [keywordEnabled, setKeywordEnabled] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [tokenEnabled, setTokenEnabled] = useState(false)
  const [ipWhitelistEnabled, setIpWhitelistEnabled] = useState(false)
  const [ipWhitelist, setIpWhitelist] = useState('')
  const [avatarFile, setAvatarFile] = useState<File>()
  const [avatarPreview, setAvatarPreview] = useState('')
  const [token, setToken] = useState('')
  const [muted, setMuted] = useState(false)
  const [notificationLoading, setNotificationLoading] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [detail, setDetail] = useState<'profile' | 'connection' | 'security' | 'groups'>()
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const notificationInFlightRef = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    void callArkme<ArkmeBotManageProfile>('bots.manage.profile', { botRef: bot.botRef }, controller.signal).then(next => {
      if (controller.signal.aborted) return
      setProfile(next); setName(next.name); setDescription(next.description); setMentionEntryEnabled(next.mentionEntryEnabled)
      setKeywordEnabled(next.webhookSecurity.keywordEnabled); setKeyword(next.webhookSecurity.keyword)
      setTokenEnabled(next.webhookSecurity.tokenEnabled); setIpWhitelistEnabled(next.webhookSecurity.ipWhitelistEnabled); setIpWhitelist(next.webhookSecurity.ipWhitelist.join('\n'))
    }).catch(caught => { if (!controller.signal.aborted) setError(errorMessage(caught)) })
    return () => { controller.abort() }
  }, [bot.botRef])
  useEffect(() => {
    const controller = new AbortController()
    void callArkme<ArkmeBotNotificationPreference>('bots.private-chat.notification.status', { botRef: bot.botRef }, controller.signal)
      .then(value => { if (!controller.signal.aborted) setMuted(value.muted) })
      .catch(caught => { if (!controller.signal.aborted) setError(errorMessage(caught)) })
    return () => { controller.abort() }
  }, [bot.botRef])
  useEffect(() => () => { if (avatarPreview !== '') URL.revokeObjectURL(avatarPreview) }, [avatarPreview])

  const chooseAvatar = (file: File | undefined) => {
    if (file === undefined) return
    if (botAvatarMimeType(file) === '') { setError('请选择 PNG、JPG、WebP 或 HEIC 图片'); return }
    if (file.size <= 0 || file.size > MAX_AVATAR_BYTES) { setError('Bot 头像不能超过 5MB'); return }
    if (avatarPreview !== '') URL.revokeObjectURL(avatarPreview)
    setAvatarFile(file); setAvatarPreview(URL.createObjectURL(file)); setError(''); setDetail('profile')
  }

  const save = async () => {
    if (profile === undefined || busy !== '') return
    setBusy('保存中…'); setError('')
    try {
      const avatar = avatarFile === undefined ? undefined : await uploadBotAvatar(avatarFile)
      const updated = await callArkme<ArkmeBotManageProfile>('bots.manage.update', {
        botRef: bot.botRef, name, description, ...(avatar === undefined ? {} : { avatar }), mentionEntryEnabled,
        ...(profile.provider === 'webhook' ? { webhookSecurity: {
          keywordEnabled, keyword, tokenEnabled, ipWhitelistEnabled,
          ipWhitelist: ipWhitelist.split(/\r?\n/).map(item => item.trim()).filter(item => item !== ''),
        } } : {}),
      })
      setProfile(updated); setName(updated.name); setDescription(updated.description); setAvatarFile(undefined); setAvatarPreview(''); onUpdated(updated); setDetail(undefined)
    } catch (caught) { setError(errorMessage(caught)) } finally { setBusy('') }
  }

  const revealToken = async () => {
    if (busy !== '' || !window.confirm('完整凭据仅应在安全环境中查看。确认显示吗？')) return
    setBusy('正在显示凭据…'); setError('')
    try { setToken((await callArkme<{ token: string }>('bots.manage.reveal-token', { botRef: bot.botRef })).token) }
    catch (caught) { setError(errorMessage(caught)) } finally { setBusy('') }
  }

  const deleteBot = async () => {
    if (busy !== '') return
    const confirmationName = window.prompt(tr("删除后不可恢复。请输入「{v0}」确认删除：", { v0: profile?.name ?? bot.name }))
    if (confirmationName === null) return
    setBusy('删除中…'); setError('')
    try {
      await callArkme<void>('bots.manage.delete', { botRef: bot.botRef, confirmationName })
      window.dispatchEvent(new CustomEvent('arkme-bot-deleted', { detail: { botRef: bot.botRef } }))
      onDeleted()
    } catch (caught) { setError(errorMessage(caught)) } finally { setBusy('') }
  }

  const updateMuted = async (nextMuted: boolean) => {
    if (notificationInFlightRef.current) return
    notificationInFlightRef.current = true
    setNotificationLoading(true); setError('')
    try {
      const value = await callArkme<ArkmeBotNotificationPreference>('bots.private-chat.notification.update', { botRef: bot.botRef, muted: nextMuted })
      setMuted(value.muted)
      onUpdated({ ...bot, ...projectArkmeChatAttentionFromMuted(bot.unreadCount ?? 0, value.muted) })
    } catch (caught) { setError(errorMessage(caught)) } finally {
      notificationInFlightRef.current = false
      setNotificationLoading(false)
    }
  }

  const leaveDetail = () => {
    if (detail === 'profile' && profile !== undefined) {
      setName(profile.name); setDescription(profile.description); setAvatarFile(undefined)
      if (avatarPreview !== '') URL.revokeObjectURL(avatarPreview)
      setAvatarPreview('')
    }
    setDetail(undefined)
  }

  const disabled = busy !== ''
  const avatar = avatarPreview === '' ? profile?.avatarRef : undefined
  const detailTitle = detail === 'profile' ? '编辑资料'
    : detail === 'connection' ? '连接信息'
      : detail === 'security' ? '安全设置'
        : detail === 'groups' ? '已加入群聊' : 'Bot 设置'
  return <div style={styles.backdrop} role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !disabled) onClose() }}>
    <aside role="dialog" aria-modal="true" aria-label={tr("Bot 设置")} style={styles.panel} onMouseDown={event => { event.stopPropagation() }}>
      <ArkmeRightPanelHeader title={detailTitle} onClose={onClose} closeLabel={tr("关闭")} closeDisabled={disabled}
        onBack={detail === undefined ? undefined : leaveDetail} backLabel={tr("返回 Bot 设置")} backDisabled={disabled} />
      <div style={styles.scroll}>
        {profile === undefined ? <p style={styles.hint}>{error === '' ? tr("正在加载 Bot 设置…") : error}</p> : <>
          {detail === undefined && <><section style={styles.identity}><div style={styles.summary}>
            <input ref={avatarInputRef} type="file" accept=".png,.jpg,.jpeg,.webp,.heic,image/png,image/jpeg,image/webp,image/heic,image/heif" style={styles.hidden} onChange={event => { chooseAvatar(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} />
            <button type="button" style={styles.avatarButton} disabled={disabled} aria-label={tr("更换 Bot 头像")} onClick={() => { avatarInputRef.current?.click() }}>
              {avatar === undefined ? <span style={{ width: 66, height: 66, display: 'grid', placeItems: 'center', borderRadius: '50%', background: arkmeTheme.active }}><RobotIcon size={28} weight="fill" /></span> : avatarPreview !== '' ? <img src={avatarPreview} alt="" style={{ width: 66, height: 66, objectFit: 'cover', borderRadius: '50%' }} /> : <ArkmeUserAvatar avatarRef={avatar} size={66} label={profile.name} />}
              <span aria-hidden style={styles.avatarEdit}><PencilSimpleIcon size={12} weight="bold" /></span>
            </button>
            <div style={styles.summaryText}><div style={styles.nameLine}><h3 style={styles.summaryName}>{profile.name}</h3><button data-arkme-feedback="neutral" type="button" aria-label={tr("编辑 Bot 资料")} title={tr("编辑 Bot 资料")} style={styles.titleEdit} onClick={() => { setDetail('profile') }}><PencilSimpleIcon size={14} weight="bold" /></button></div>{profile.description !== '' && <p style={styles.meta}>{profile.description}</p>}</div>
          </div></section>
          <section style={styles.section}><div style={{ ...styles.row, borderBottom: `1px solid ${arkmeTheme.borderSoft}` }}><span style={styles.rowTitle}>{tr("消息免打扰")}</span><Toggle checked={muted} disabled={disabled || notificationLoading} onChange={value => { void updateMuted(value) }} /></div></section>
          <section style={styles.section}><button data-arkme-feedback="neutral" type="button" style={styles.rowButton} onClick={() => { setDetail('connection') }}><span style={styles.rowMain}><span style={styles.rowTitle}>{tr("接入方式")}</span><span style={styles.rowValue}>{profile.provider === 'openclaw' ? 'OpenClaw' : 'Webhook'}</span></span><CaretRight size={15} color={arkmeTheme.tertiary} aria-hidden /></button><button data-arkme-feedback="neutral" type="button" style={styles.rowButton} onClick={() => { setDetail('connection') }}><span style={styles.rowMain}><span style={styles.rowTitle}>{tr("连接信息")}</span></span><CaretRight size={15} color={arkmeTheme.tertiary} aria-hidden /></button>{profile.provider === 'webhook' && <button data-arkme-feedback="neutral" type="button" style={styles.rowButton} onClick={() => { setDetail('security') }}><span style={styles.rowMain}><span style={styles.rowTitle}>{tr("安全设置")}</span></span><CaretRight size={15} color={arkmeTheme.tertiary} aria-hidden /></button>}<button data-arkme-feedback="neutral" type="button" style={styles.rowButton} onClick={() => { setDetail('groups') }}><span style={styles.rowMain}><span style={styles.rowTitle}>{tr("已加入群聊")}</span><span style={styles.rowValue}>{profile.joinedGroups.length === 0 ? '未加入群聊' : tr("{v0} 个", { v0: String(profile.joinedGroups.length) })}</span></span><CaretRight size={15} color={arkmeTheme.tertiary} aria-hidden /></button></section>
          <section style={styles.section}><button data-arkme-feedback="danger" type="button" style={styles.danger} disabled={disabled} onClick={() => { void deleteBot() }}><span>{tr("删除 Bot")}</span><CaretRight size={15} aria-hidden /></button></section></>}
          {detail === 'profile' && <><section><input ref={avatarInputRef} type="file" accept=".png,.jpg,.jpeg,.webp,.heic,image/png,image/jpeg,image/webp,image/heic,image/heif" style={styles.hidden} onChange={event => { chooseAvatar(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} /><label style={styles.field}><span style={styles.label}>{tr("名称")}</span><input style={styles.input} value={name} maxLength={50} disabled={disabled} onChange={event => { setName(event.target.value) }} /></label><label style={styles.field}><span style={styles.label}>{tr("简介（可选）")}</span><textarea style={styles.textarea} value={description} maxLength={200} disabled={disabled} onChange={event => { setDescription(event.target.value) }} /></label><button data-arkme-feedback="neutral" type="button" style={{ ...styles.action, marginTop: 12 }} disabled={disabled} onClick={() => { avatarInputRef.current?.click() }}>{tr("更换头像")}</button></section><button data-arkme-feedback="primary" type="button" style={{ ...styles.primary, ...(disabled ? { opacity: .5, cursor: 'default' } : {}) }} disabled={disabled} onClick={() => { void save() }}>{busy === '' ? tr("保存") : busy}</button></>}
          {detail === 'security' && profile.provider === 'webhook' && <><section>
            <div style={styles.row}><span>{tr("启用关键词校验")}</span><Toggle checked={keywordEnabled} disabled={disabled} onChange={setKeywordEnabled} /></div>
            {keywordEnabled && <label style={styles.field}><span style={styles.label}>{tr("关键词")}</span><input style={styles.input} value={keyword} disabled={disabled} onChange={event => { setKeyword(event.target.value) }} /></label>}
            <div style={styles.row}><span>{tr("启用签名 Token 校验")}</span><Toggle checked={tokenEnabled} disabled={disabled} onChange={setTokenEnabled} /></div>
            <div style={styles.row}><span>{tr("启用 IP 白名单")}</span><Toggle checked={ipWhitelistEnabled} disabled={disabled} onChange={setIpWhitelistEnabled} /></div>
            {ipWhitelistEnabled && <label style={styles.field}><span style={styles.label}>{tr("IP 白名单（每行一个）")}</span><textarea style={styles.textarea} value={ipWhitelist} disabled={disabled} onChange={event => { setIpWhitelist(event.target.value) }} /></label>}
          </section><button data-arkme-feedback="primary" type="button" style={{ ...styles.primary, ...(disabled ? { opacity: .5, cursor: 'default' } : {}) }} disabled={disabled} onClick={() => { void save() }}>{busy === '' ? tr("保存") : busy}</button></>}
          {detail === 'connection' && <section>
            <p style={styles.sectionTitle}>{tr("接入方式")}</p><p style={styles.code}>{profile.provider === 'openclaw' ? 'OpenClaw' : 'Webhook'}</p>
            {profile.gatewayUrl !== '' && <><span style={styles.label}>Gateway</span><p style={styles.code}>{profile.gatewayUrl}</p></>}
            {profile.webhookUrl !== '' && <><span style={{ ...styles.label, marginTop: 10 }}>{tr("Webhook 地址")}</span><p style={styles.code}>{profile.webhookUrl}</p></>}
            {profile.tokenPreview !== '' && <><span style={{ ...styles.label, marginTop: 10 }}>{tr("凭据预览")}</span><p style={styles.code}>{token === '' ? profile.tokenPreview : token}</p>{token === '' && profile.canRevealToken && profile.tokenRevealEnabled && <button data-arkme-feedback="neutral" type="button" style={styles.action} disabled={disabled} onClick={() => { void revealToken() }}>{tr("显示完整凭据")}</button>}</>}
            {profile.provider === 'openclaw' && <><div style={styles.row}><span>{tr("群聊中允许 @ 此 Bot")}</span><Toggle checked={mentionEntryEnabled} disabled={disabled} onChange={setMentionEntryEnabled} /></div><button data-arkme-feedback="primary" type="button" style={{ ...styles.primary, ...(disabled ? { opacity: .5, cursor: 'default' } : {}) }} disabled={disabled} onClick={() => { void save() }}>{busy === '' ? tr("保存") : busy}</button></>}
          </section>}
          {detail === 'groups' && <section style={styles.section}>{profile.joinedGroups.length === 0 ? <p style={styles.hint}>{tr("尚未加入群聊")}</p> : profile.joinedGroups.map((group, index) => <div key={`${group.title}:${index}`} style={{ ...styles.row, borderBottom: `1px solid ${arkmeTheme.borderSoft}` }}><span>{group.title}</span><span style={styles.meta}>{group.installedAtMillis > 0 ? new Date(group.installedAtMillis).toLocaleDateString(arkmeIntlLocale()) : ''}</span></div>)}</section>}
          {error !== '' && <p role="alert" style={styles.error}>{error}</p>}
        </>}
      </div>
    </aside>
  </div>
}
