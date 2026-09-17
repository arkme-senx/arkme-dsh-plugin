import { useEffect, useRef, useState } from 'react'
import { CaretRight } from '@phosphor-icons/react/CaretRight'
import type { ArkmeUploadedAsset, ArkmePluginResponse, ArkmeUserProfile, ArkmeUserProfileSnapshot } from '../types.js'
import { callArkme, ArkmeClientError } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { ArkmeExtensionAvatarCropDialog } from './ArkmeExtensionAvatarCropDialog.js'
import { publishProfileChange } from './profile-change-store.js'
import { tr, useArkmeLocale } from './locale.js'

function scope(): string | undefined {
  const auth = arkmeAuthStore.getSnapshot().auth
  return auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : undefined
}

export function ArkmeProfileEditor({ profile, accountScope, onUpdated }: {
  profile: ArkmeUserProfile
  accountScope: string
  onUpdated(snapshot: ArkmeUserProfileSnapshot): void
}) {
  useArkmeLocale()
  const input = useRef<HTMLInputElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const pending = useRef<AbortController>()
  const [editing, setEditing] = useState(false)
  const [nickname, setNickname] = useState(profile.nickname || profile.displayName)
  const [source, setSource] = useState<File>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => () => { pending.current?.abort() }, [accountScope])
  useEffect(() => { if (editing) dialog.current?.showModal() }, [editing])

  const save = async (field: 'nickname' | 'avatar', value: string | File) => {
    if (busy || scope() !== accountScope) return
    const controller = new AbortController()
    pending.current = controller
    setBusy(true); setError('')
    try {
      let text = typeof value === 'string' ? value.trim() : ''
      if (value instanceof File) {
        const response = await fetch('/arkme-self/api/upload', {
          method: 'POST', body: value, signal: controller.signal,
          headers: { 'Content-Type': value.type, 'X-Arkme-File-Name': encodeURIComponent(value.name) },
        })
        const payload = await response.json() as ArkmePluginResponse<ArkmeUploadedAsset>
        if (!payload.ok) throw new ArkmeClientError(payload.error)
        if (!response.ok || !/^[A-Za-z0-9_-]{8,128}$/.test(payload.value.fileAssetUid)) throw new Error(tr('头像上传失败'))
        text = `file_asset://${payload.value.fileAssetUid}`
      }
      if (scope() !== accountScope || controller.signal.aborted) return
      const snapshot = await callArkme<ArkmeUserProfileSnapshot>('user.profile.update', {
        field, value: text, expectedAccountScope: accountScope,
      }, controller.signal)
      if (scope() !== accountScope || controller.signal.aborted || snapshot.profile?.userId !== profile.userId) return
      onUpdated(snapshot); publishProfileChange(snapshot)
      setEditing(false); setSource(undefined)
    } catch (caught) {
      if (!controller.signal.aborted && scope() === accountScope) setError(caught instanceof Error ? caught.message : tr('保存失败，请重试'))
    } finally { if (!controller.signal.aborted && scope() === accountScope) setBusy(false) }
  }

  return <div className="arkme-profile-editor">
    <button type="button" className="arkme-profile-edit-row" disabled={busy} onClick={() => { setError(''); input.current?.click() }}>
      <span>{tr('头像')}</span><span className="arkme-profile-edit-value"><ArkmeUserAvatar avatarRef={profile.avatarRef} size={44} label={tr('当前用户头像')} /><CaretRight size={16} /></span>
    </button>
    <button type="button" className="arkme-profile-edit-row" disabled={busy} onClick={() => { setNickname(profile.nickname || profile.displayName); setError(''); setEditing(true) }}>
      <span>{tr('昵称')}</span><span className="arkme-profile-edit-value"><span>{profile.nickname || profile.displayName}</span><CaretRight size={16} /></span>
    </button>
    <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={event => {
      const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''
      if (!file) return
      if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) { setError(tr('请选择不超过 10MB 的 PNG、JPG 或 WebP 图片')); return }
      setSource(file)
    }} />
    {busy && <p role="status">{tr('保存中…')}</p>}
    {error && !editing && <p role="alert" className="arkme-profile-error">{error}</p>}
    {source && <ArkmeExtensionAvatarCropDialog title={tr('裁剪头像')} sourceFile={source} onCancel={() => { setSource(undefined) }} onConfirm={file => { setSource(undefined); void save('avatar', file) }} />}
    {editing && <dialog ref={dialog} className="arkme-profile-edit-dialog" aria-label={tr('修改昵称')} onCancel={event => { if(busy) event.preventDefault(); else setEditing(false) }}>
      <form onSubmit={event => { event.preventDefault(); void save('nickname', nickname) }}>
        <h3>{tr('修改昵称')}</h3>
        <input aria-label={tr('昵称')} value={nickname} maxLength={128} disabled={busy} onChange={event => { setNickname(event.target.value) }} autoFocus />
        <p>{tr('昵称需为 1–64 个字符')}</p>
        {error && <p role="alert" className="arkme-profile-error">{error}</p>}
        <footer><button type="button" disabled={busy} onClick={() => { setEditing(false) }}>{tr('取消')}</button><button type="submit" disabled={busy || !nickname.trim() || [...nickname.trim()].length > 64}>{tr(busy ? '保存中…' : '保存')}</button></footer>
      </form>
    </dialog>}
  </div>
}
