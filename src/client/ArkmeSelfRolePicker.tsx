import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import type { ArkmePluginResponse, ArkmeSelfRole } from '../types.js'
import { ArkmeSelfRoleMenu } from './ArkmeSelfRoleMenu.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { ArkmeExtensionAvatarCropDialog } from './ArkmeExtensionAvatarCropDialog.js'
import { callArkme } from './api.js'
import { arkmeSelfRoleAvatarFallback } from './self-role-presentation.js'

const MAX_ROLES = 20
const MAX_NAME_LENGTH = 20
const MAX_AVATAR_BYTES = 8 * 1024 * 1024
const AVATAR_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

export function ArkmeSelfRoleAvatar({ role, size = 22 }: {
  role: Pick<ArkmeSelfRole, 'roleId' | 'name' | 'avatarRef'>
  size?: number
}) {
  return <ArkmeUserAvatar
    {...(role.avatarRef?.trim() ? { avatarRef: role.avatarRef } : {})}
    fallback={arkmeSelfRoleAvatarFallback(role)} size={size} label={`${role.name}的头像`} />
}

async function saveLocalRoleAvatar(file: File, expectedUserId: number, signal: AbortSignal): Promise<string> {
  const response = await fetch('/arkme-self/api/self-role-avatar', {
    method: 'POST', body: file, signal,
    headers: {
      'Content-Type': file.type,
      'X-Arkme-File-Name': encodeURIComponent(file.name),
      'X-Arkme-Expected-User-Id': String(expectedUserId),
    },
  })
  const payload = await response.json() as ArkmePluginResponse<{ avatarRef: string }>
  if (!response.ok || !payload.ok || !/^arkme-self-role-image-v1\./.test(payload.value?.avatarRef ?? '')) {
    throw new Error(payload.ok ? '头像保存失败，请重试' : payload.error.message || '头像保存失败，请重试')
  }
  return payload.value.avatarRef
}

export function ArkmeSelfRolePicker({ accountKey, userId, selectedRole, selfAvatarRef, onSelect, disabled = false }: {
  accountKey: string
  userId: number
  selectedRole?: ArkmeSelfRole | undefined
  selfAvatarRef?: string | undefined
  onSelect(role?: ArkmeSelfRole): void
  disabled?: boolean
}) {
  const scope = `${accountKey}\0${String(userId)}`
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const [roleState, setRoleState] = useState<{ scope: string; roles: ArkmeSelfRole[]; loading: boolean; error: string }>({
    scope, roles: [], loading: true, error: '',
  })
  const visibleState = roleState.scope === scope ? roleState : { scope, roles: [], loading: true, error: '' }
  const [refreshRevision, setRefreshRevision] = useState(0)
  useEffect(() => { if (typeof window === 'undefined') return; const refresh = () => setRefreshRevision(value => value + 1); window.addEventListener('arkme-self-roles-changed', refresh); return () => window.removeEventListener('arkme-self-roles-changed', refresh) }, [])
  const [menuOpen, setMenuOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [editingRole, setEditingRole] = useState<ArkmeSelfRole>()
  const [removeAvatar, setRemoveAvatar] = useState(false)
  const [avatarFile, setAvatarFile] = useState<File>()
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState('')
  const [cropSource, setCropSource] = useState<File>()
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const saveControllerRef = useRef<AbortController>()

  useEffect(() => {
    setMenuOpen(false)
    setCreateOpen(false)
    setName('')
    setEditingRole(undefined)
    setRemoveAvatar(false)
    setAvatarFile(undefined)
    setCropSource(undefined)
    setSaving(false)
    setFormError('')
    saveControllerRef.current?.abort()
    saveControllerRef.current = undefined
    return () => { saveControllerRef.current?.abort() }
  }, [scope])

  useEffect(() => {
    const controller = new AbortController()
    setRoleState({ scope, roles: roleState.scope === scope ? roleState.roles : [], loading: true, error: '' })
    void callArkme<ArkmeSelfRole[]>('self-roles.list', { expectedUserId: userId }, controller.signal)
      .then(roles => {
        if (controller.signal.aborted || scopeRef.current !== scope) return
        setRoleState({ scope, roles, loading: false, error: '' })
      })
      .catch(caught => {
        if (controller.signal.aborted || scopeRef.current !== scope) return
        setRoleState(current => ({
          scope, roles: current.scope === scope ? current.roles : [], loading: false,
          error: caught instanceof Error ? caught.message : '角色加载失败，请重试',
        }))
      })
    return () => { controller.abort() }
    // Preserve already shown roles while a manual refresh is pending.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, userId, refreshRevision])

  useEffect(() => {
    if (!avatarFile || typeof URL.createObjectURL !== 'function') { setAvatarPreviewUrl(''); return }
    const url = URL.createObjectURL(avatarFile)
    setAvatarPreviewUrl(url)
    return () => { URL.revokeObjectURL(url) }
  }, [avatarFile])

  useEffect(() => { if (disabled) setMenuOpen(false) }, [disabled])

  useEffect(() => {
    if (selectedRole === undefined || visibleState.loading || visibleState.error !== '') return
    const current = visibleState.roles.find(role => role.roleId === selectedRole.roleId)
    if (current === undefined) onSelect(undefined)
    else if (current.updatedAtMillis > selectedRole.updatedAtMillis) onSelect(current)
  }, [selectedRole, visibleState, onSelect])

  const closeCreate = () => {
    if (saveControllerRef.current !== undefined) return
    setCreateOpen(false)
    setName('')
    setEditingRole(undefined)
    setRemoveAvatar(false)
    setAvatarFile(undefined)
    setCropSource(undefined)
    setFormError('')
  }
  const createRole = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const roleName = name.trim()
    if (disabled || saveControllerRef.current !== undefined || visibleState.loading || visibleState.error !== ''
      || (editingRole === undefined && visibleState.roles.length >= MAX_ROLES) || !roleName || Array.from(roleName).length > MAX_NAME_LENGTH) return
    const controller = new AbortController()
    saveControllerRef.current = controller
    const submittingScope = scope
    setSaving(true)
    setFormError('')
    try {
      const avatarRef = avatarFile === undefined ? (removeAvatar ? '' : undefined) : await saveLocalRoleAvatar(avatarFile, userId, controller.signal)
      if (controller.signal.aborted || scopeRef.current !== submittingScope) return
      const created = await callArkme<ArkmeSelfRole>(editingRole === undefined ? 'self-roles.create' : 'self-roles.update', {
        ...(editingRole === undefined ? {} : { roleId: editingRole.roleId }),
        expectedUserId: userId, ...(editingRole?.name === roleName ? {} : {name: roleName}), ...(avatarRef === undefined ? {} : { avatarRef }),
      }, controller.signal)
      if (controller.signal.aborted || scopeRef.current !== submittingScope) return
      setRoleState(current => current.scope === submittingScope
        ? { ...current, roles: [...current.roles.filter(role => role.roleId !== created.roleId), created] } : current)
      setCreateOpen(false)
      setName('')
    setEditingRole(undefined)
    setRemoveAvatar(false)
      setAvatarFile(undefined)
      onSelect(created)
    } catch (caught) {
      if (!controller.signal.aborted && scopeRef.current === submittingScope) {
        setFormError(caught instanceof Error ? caught.message : '创建角色失败，请重试')
      }
    } finally {
      if (saveControllerRef.current === controller) saveControllerRef.current = undefined
      if (!controller.signal.aborted && scopeRef.current === submittingScope) setSaving(false)
    }
  }

  const activeName = selectedRole?.name || '我'
  const selectedId = selectedRole === undefined ? 'me' : `role:${selectedRole.roleId}`
  const trigger = <button type="button" disabled={disabled} data-arkme-feedback="neutral" aria-label={`当前发言角色：${activeName}`} aria-haspopup="menu"
    aria-expanded={menuOpen} title={`以${activeName}的身份发送`} data-arkme-self-role-trigger="true"
    data-arkme-self-role-id={selectedRole?.roleId ?? 'me'}
    style={styles.trigger} onPointerDown={event => { event.stopPropagation() }} onClick={() => {
      if (!menuOpen) setRefreshRevision(value => value + 1)
      setMenuOpen(value => !value)
    }}>
    <ArkmeSelfRoleAvatar role={selectedRole ?? { roleId: 'me', name: '我', ...(selfAvatarRef?.trim() ? { avatarRef: selfAvatarRef } : {}) }} size={20} />
    <span style={styles.triggerName}>{activeName}</span>
    <svg aria-hidden width="9" height="6" viewBox="0 0 9 6" style={{ flex: 'none' }}><path d="m1 1 3.5 3.5L8 1" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
  </button>
  const editRole = (role: ArkmeSelfRole) => {
    setMenuOpen(false); setEditingRole(role); setName(role.name); setAvatarFile(undefined)
    setRemoveAvatar(false); setFormError(''); setCreateOpen(true)
  }
  const deleteRole = (role: ArkmeSelfRole) => {
    setMenuOpen(false)
    void callArkme('self-roles.delete', { expectedUserId: userId, roleId: role.roleId }).then(() => {
      if (scopeRef.current !== scope) return
      setRoleState(current => current.scope === scope
        ? { ...current, roles: current.roles.filter(item => item.roleId !== role.roleId) } : current)
      setRefreshRevision(value => value + 1)
    }).catch(error => {
      if (scopeRef.current === scope) setRoleState(current => ({ ...current, error: error instanceof Error ? error.message : '删除失败' }))
    })
  }
  const menuActions = [
    { id: 'me', label: '我', icon: <ArkmeSelfRoleAvatar role={{ roleId: 'me', name: '我', ...(selfAvatarRef?.trim() ? { avatarRef: selfAvatarRef } : {}) }} size={20} />, onSelect: () => { setMenuOpen(false); onSelect(undefined) } },
    ...visibleState.roles.map(role => ({
      id: `role:${role.roleId}`, label: role.name, icon: <ArkmeSelfRoleAvatar role={role} size={20} />,
      onSelect: () => { setMenuOpen(false); onSelect(role) },
      managementActions: [
        { id: 'role-edit', label: '编辑', onSelect: () => editRole(role) },
        { id: 'role-delete', label: '删除', danger: true, onSelect: () => deleteRole(role) },
      ],
    })),
    ...(visibleState.loading ? [{ type: 'label' as const, id: 'role-loading', text: '正在加载角色…' }] : []),
    ...(visibleState.error ? [
      { type: 'label' as const, id: 'role-error', text: `加载失败：${visibleState.error}` },
      { id: 'role-retry', label: '重试', onSelect: () => { setRefreshRevision(value => value + 1) } },
    ] : []),
    { type: 'separator' as const, id: 'role-create-separator' },
    { id: 'role-create', label: '＋ 创建角色', disabled: visibleState.loading || visibleState.error !== '' || visibleState.roles.length >= MAX_ROLES,
      onSelect: () => { setMenuOpen(false); setEditingRole(undefined); setRemoveAvatar(false); setName(''); setAvatarFile(undefined); setFormError(''); setCreateOpen(true) } },
  ]

  return <>
    <ArkmeSelfRoleMenu open={menuOpen} selectedIds={[selectedId]}
      anchor={trigger} onClose={() => setMenuOpen(false)} actions={menuActions} />
    {createOpen && <div style={styles.backdrop} onPointerDown={event => { if (event.target === event.currentTarget) closeCreate() }}>
      <section role="dialog" aria-modal="true" aria-label={editingRole ? "编辑发言角色" : "创建发言角色"} style={styles.dialog}
        onKeyDown={event => { if (event.key === 'Escape' && !saving && cropSource === undefined) { event.stopPropagation(); closeCreate() } }}>
        <h3 style={styles.title}>{editingRole ? "编辑角色" : "创建角色"}</h3>
        <p style={styles.description}>给另一个“自己”取个名字，可选头像；留空时显示名称首字。</p>
        <form onSubmit={event => { void createRole(event) }}>
          <div style={styles.identityRow}>
            <button type="button" aria-label="选择角色头像" title="选择角色头像" disabled={saving}
              style={styles.avatarButton} onClick={() => fileInputRef.current?.click()}>
              {avatarPreviewUrl
                ? <img src={avatarPreviewUrl} alt="已选角色头像" style={styles.avatarPreview} />
                : <ArkmeSelfRoleAvatar role={{ roleId: 'draft', name: name.trim() || '角', ...(!removeAvatar && editingRole?.avatarRef ? {avatarRef:editingRole.avatarRef} : {}) }} size={48} />}
              <span style={styles.avatarAdd}>＋</span>
            </button>
            <label style={styles.nameLabel}>角色名称
              <input aria-label="角色名称" autoFocus value={name} maxLength={40} disabled={saving}
                placeholder="例如：理性我" style={styles.nameInput}
                onChange={event => { setName(Array.from(event.currentTarget.value).slice(0, MAX_NAME_LENGTH).join('')); setFormError('') }} />
            </label>
          </div>
          {(avatarFile !== undefined || (!removeAvatar && editingRole?.avatarRef)) && <button type="button" disabled={saving} onClick={()=>{setAvatarFile(undefined);setRemoveAvatar(true)}}>移除头像</button>}
          <input ref={fileInputRef} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={event => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (!file) return
            if (!AVATAR_MIME_TYPES.has(file.type) || file.size > MAX_AVATAR_BYTES) {
              setFormError('请选择不超过 8MB 的 PNG、JPG 或 WebP 图片')
              return
            }
            setCropSource(file)
          }} />
          {formError && <p role="alert" style={styles.error}>{formError}</p>}
          <div style={styles.actions}>
            <button type="button" style={styles.cancel} disabled={saving} onClick={closeCreate}>取消</button>
            <button type="submit" style={styles.submit} disabled={saving || !name.trim() || (editingRole === undefined && visibleState.roles.length >= MAX_ROLES)}>
              {saving ? '保存中…' : editingRole ? '保存并选用' : '创建并选用'}
            </button>
          </div>
        </form>
      </section>
    </div>}
    {createOpen && cropSource !== undefined && <ArkmeExtensionAvatarCropDialog sourceFile={cropSource} title="裁剪角色头像"
      onCancel={() => setCropSource(undefined)} onConfirm={file => { setAvatarFile(file); setCropSource(undefined); setFormError('') }} />}
  </>
}

const styles: Record<string, CSSProperties> = {
  trigger: { height: 28, maxWidth: 116, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
    padding: '3px 5px', border: '1px solid transparent', borderRadius: 14, background: 'transparent',
    color: 'var(--dsw-alias-label-secondary, #626a78)', cursor: 'pointer', font: 'inherit', fontSize: 11, lineHeight: '16px' },
  triggerName: { minWidth: 0, maxWidth: 72, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  backdrop: { position: 'fixed', zIndex: 110, inset: 0, display: 'grid', placeItems: 'center', padding: 20,
    background: 'rgba(17, 24, 39, .42)' },
  dialog: { width: 'min(360px, 100%)', padding: 20, boxSizing: 'border-box', borderRadius: 14,
    background: 'var(--dsw-specific-sidebar-fill, #fff)', color: 'var(--dsw-alias-label-primary, #292929)',
    boxShadow: '0 22px 65px rgba(0,0,0,.22)' },
  title: { margin: 0, fontSize: 17, fontWeight: 600 },
  description: { margin: '6px 0 18px', color: 'var(--dsw-alias-label-secondary, #717780)', fontSize: 12, lineHeight: '18px' },
  identityRow: { display: 'flex', alignItems: 'center', gap: 14 },
  avatarButton: { width: 52, height: 52, position: 'relative', flex: 'none', padding: 2,
    border: '1px solid var(--dsw-alias-border-l1, #e4e7ed)', borderRadius: '50%',
    background: 'var(--dsw-alias-bg-base, #fff)', cursor: 'pointer' },
  avatarPreview: { width: 48, height: 48, display: 'block', objectFit: 'cover', borderRadius: '50%' },
  avatarAdd: { position: 'absolute', right: -2, bottom: -2, width: 17, height: 17, display: 'grid', placeItems: 'center',
    borderRadius: '50%', background: '#343b48', color: '#fff', fontSize: 13, lineHeight: 1 },
  nameLabel: { minWidth: 0, flex: 1, display: 'grid', gap: 6, fontSize: 12, color: 'var(--dsw-alias-label-secondary, #717780)' },
  nameInput: { width: '100%', height: 36, padding: '0 10px', boxSizing: 'border-box',
    border: '1px solid var(--dsw-alias-border-l1, #dfe3e9)', borderRadius: 8,
    background: 'var(--dsw-alias-bg-base, #fff)', color: 'var(--dsw-alias-label-primary, #252b36)',
    font: 'inherit', fontSize: 13 },
  error: { margin: '10px 0 0', color: '#b42318', fontSize: 11, lineHeight: '17px' },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 },
  cancel: { height: 34, padding: '0 14px', border: '1px solid var(--dsw-alias-border-l1, #dfe3e9)', borderRadius: 8,
    background: 'var(--dsw-alias-bg-base, #fff)', color: 'inherit', cursor: 'pointer' },
  submit: { height: 34, padding: '0 14px', border: 0, borderRadius: 8, background: '#343b48', color: '#fff', fontWeight: 600, cursor: 'pointer' },
}
