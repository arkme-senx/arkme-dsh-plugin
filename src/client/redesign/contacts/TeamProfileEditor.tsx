import { useEffect, useRef, useState } from 'react';
import type { ArkmeTeamProfile, ArkmeTeamProfileResult } from '../../../team-profile-contract.js';
import { ArkmeTeamAvatar, ArkmeTeamNameAvatar } from '../../ArkmeTeamAvatar.js';
import { ArkmeExtensionAvatarCropDialog } from '../../ArkmeExtensionAvatarCropDialog.js';
import { callArkme } from '../../api.js';
import { ArkmeActionMenu } from '../../ArkmeDshMenu.js';
import { Camera } from '@phosphor-icons/react/dist/icons/Camera';
import { Image } from '@phosphor-icons/react/dist/icons/Image';
import { arkmeTheme } from '../../arkme-theme.js';
export function TeamProfileEditor({ profile, onClose, onUpdated }: {
    profile: ArkmeTeamProfile;
    onClose(): void;
    onUpdated(profile: ArkmeTeamProfile): void;
}) {
    const [name, setName] = useState(profile.name), [file, setFile] = useState<File>(), [source, setSource] = useState<File>(), [preview, setPreview] = useState(''), [reset, setReset] = useState(false), [avatarMenu, setAvatarMenu] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [blocked, setBlocked] = useState(false);
    const input = useRef<HTMLInputElement>(null), dialog = useRef<HTMLDialogElement>(null), pending = useRef<AbortController>(), upload = useRef<{
        uid: string;
        ref?: string;
    }>(), requestUid = useRef(crypto.randomUUID()), saved = useRef(false);
    useEffect(() => { dialog.current?.showModal(); return () => { pending.current?.abort(); if (upload.current?.ref && !saved.current)
        void callArkme('team.app.profile.avatar.abort', { uploadRef: upload.current.ref }).catch(() => undefined); }; }, []);
    useEffect(() => { if (!file)
        return; const url = URL.createObjectURL(file); setPreview(url); return () => URL.revokeObjectURL(url); }, [file]);
    const abortPrevious = () => { if (upload.current?.ref)
        void callArkme('team.app.profile.avatar.abort', { uploadRef: upload.current.ref }).catch(() => undefined); upload.current = undefined; };
    const save = async () => {
        if (busy || blocked || !name.trim() || [...name.trim()].length > 64)
            return;
        const controller = new AbortController();
        pending.current = controller;
        setAvatarMenu(false);
        setBusy(true);
        setError('');
        try {
            let avatar: {
                action: 'default';
            } | {
                action: 'custom';
                uploadRef: string;
            } | undefined;
            if (reset)
                avatar = { action: 'default' };
            else if (file) {
                upload.current ??= { uid: crypto.randomUUID() };
                if (!upload.current.ref) {
                    const bytes = new Uint8Array(await file.arrayBuffer());
                    let binary = '';
                    for (const byte of bytes)
                        binary += String.fromCharCode(byte);
                    const result = await callArkme<{
                        uploadRef: string;
                    }>('team.app.profile.avatar.upload', { teamRef: profile.profileRef, contentBase64: btoa(binary), uploadUid: upload.current.uid }, controller.signal);
                    upload.current.ref = result.uploadRef;
                }
                avatar = { action: 'custom', uploadRef: upload.current.ref };
            }
            const result = await callArkme<ArkmeTeamProfileResult>('team.app.profile.update', { teamRef: profile.profileRef, expectedRevision: profile.profileRevision, requestUid: requestUid.current, name: name.trim(), ...(avatar ? { avatar } : {}) }, controller.signal);
            if (controller.signal.aborted)
                return;
            if (result.acceptedRevision <= 0)
                throw new Error('保存结果尚未确认，请重试');
            const current = result.profile ?? await callArkme<ArkmeTeamProfile>('team.app.profile.get', { teamRef: profile.profileRef }, controller.signal);
            if (controller.signal.aborted)
                return;
            saved.current = true;
            onUpdated(current);
        }
        catch (e) {
            if (!controller.signal.aborted) {
                const code = (e as {
                    code?: string;
                }).code;
                setBlocked(['team-version_conflict', 'team-not_owner', 'team-profile_edit_rejected'].includes(code ?? ''));
                setError(e instanceof Error ? e.message : '保存失败，请重试');
            }
        }
        finally {
            if (!controller.signal.aborted)
                setBusy(false);
        }
    };
    if (!profile.canEditProfile)
        return null;
    return <><dialog ref={dialog} className="arkme-team-profile-editor" aria-label="编辑团队" onKeyDown={event => {
        if (avatarMenu && event.key === 'Escape') {
            event.preventDefault(); event.stopPropagation(); setAvatarMenu(false);
            dialog.current?.querySelector<HTMLButtonElement>('.arkme-team-profile-avatar-trigger')?.focus();
        }
    }} onCancel={event => { if (busy || source)
        event.preventDefault();
    else
        onClose(); }}>
  <form onSubmit={event => { event.preventDefault(); void save(); }}>
   <h3>编辑团队</h3><p className="arkme-team-profile-description">修改团队名称和头像，仅所有者可编辑。</p>
   <div className="arkme-team-profile-identity">
    <div className="arkme-team-profile-avatar-field">
     <ArkmeActionMenu label="团队头像操作" open={avatarMenu} portal={false} autoFocus onClose={() => setAvatarMenu(false)}
      actions={[
       { id: 'upload', label: '上传图片', icon: <Image size={20}/>, onSelect: () => { setAvatarMenu(false); input.current?.click(); } },
       !reset && (profile.avatar.mode === 'custom' || !!file) && { id: 'default',
        icon: <span aria-hidden><ArkmeTeamNameAvatar name={name} size={28}/></span>,
        label: <span className="arkme-team-profile-avatar-option"><span>使用名称头像</span><small>随团队名称自动更新</small></span>,
        onSelect: () => { setAvatarMenu(false); abortPrevious(); setFile(undefined); setReset(true); requestUid.current = crypto.randomUUID(); setError(''); } },
      ]}
      anchor={<button type="button" className="arkme-team-profile-avatar-trigger" aria-label="更换团队头像" aria-haspopup="menu" aria-expanded={avatarMenu} disabled={busy || blocked} onClick={() => setAvatarMenu(!avatarMenu)}>
       {file && preview ? <img src={preview} alt="已选团队头像"/> : <ArkmeTeamAvatar name={name} avatar={reset ? { mode: 'default', key: 'draft-default' } : profile.avatar} size={52}/>}
       <span className="arkme-team-profile-avatar-add" style={{ background: arkmeTheme.text, color: arkmeTheme.base }}><Camera size={12}/></span>
      </button>}/>
    </div>
    <label>团队名称<input aria-label="团队名称" autoFocus value={name} disabled={busy || blocked} onChange={event => { const value = [...event.currentTarget.value].slice(0, 64).join(''); if (value === name) return; abortPrevious(); setName(value); requestUid.current = crypto.randomUUID(); setError(''); }}/></label>
   </div>
   <input ref={input} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { const selected = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (!selected)
        return; if (!['image/png', 'image/jpeg', 'image/webp'].includes(selected.type) || selected.size > 10 * 1024 * 1024) {
        setError('请选择小于 10MB 的 PNG、JPEG 或 WebP 图片');
        return;
    } setSource(selected); }}/>
   {error && <p role="alert" className="arkme-team-profile-error">{error}</p>}
   <div className="arkme-team-profile-actions"><button type="button" disabled={busy} onClick={onClose}>取消</button><button type="submit" disabled={busy || blocked || !name.trim() || [...name.trim()].length > 64}>{busy ? '保存中…' : '保存'}</button></div>
  </form>
 {source && <ArkmeExtensionAvatarCropDialog sourceFile={source} title="裁剪团队头像" onCancel={() => setSource(undefined)} onConfirm={value => { abortPrevious(); setSource(undefined); setFile(value); setReset(false); requestUid.current = crypto.randomUUID(); setError(''); }}/>}</dialog></>;
}
