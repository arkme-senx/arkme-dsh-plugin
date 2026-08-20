import { useState, type CSSProperties, type FormEvent } from 'react'
import type { ArkmeExtensionEditableVisibility } from '../extensions/types.js'
import type { ArkmeMyExtensionItem } from '../extensions/owned-types.js'
import { ArkmeExtensionAvatarField } from './ArkmeExtensionAvatarField.js'
import { ArkmeExtensionPreviewField } from './ArkmeExtensionPreviewField.js'
import { createExtensionPreviewDraft, type ExtensionPreviewDraft } from './extension-preview-edit.js'

export interface ArkmeExtensionEditFormValue {
  name: string
  description: string
  visibility: ArkmeExtensionEditableVisibility
  iconFile?: File
  previewDraft?: ExtensionPreviewDraft
}

export function ArkmeExtensionEditDialog({ item, busy, error, previewDraft: controlledPreviewDraft, onPreviewDraftChange, onCancel, onSubmit }: {
  item: ArkmeMyExtensionItem
  busy: boolean
  error: string
  previewDraft?: ExtensionPreviewDraft
  onPreviewDraftChange?(draft: ExtensionPreviewDraft): void
  onCancel(): void
  onSubmit(value: ArkmeExtensionEditFormValue): void
}) {
  const [name, setName] = useState(item.name)
  const [description, setDescription] = useState(item.description)
  const initialVisibility = item.published?.visibility
  const [visibility, setVisibility] = useState<ArkmeExtensionEditableVisibility | ''>(
    initialVisibility === 'private' || initialVisibility === 'public' ? initialVisibility : '',
  )
  const [iconFile, setIconFile] = useState<File>()
  const [localPreviewDraft, setLocalPreviewDraft] = useState(() => createExtensionPreviewDraft(
    item.published?.previewImages ?? [], item.published?.previewRevision ?? 0,
  ))
  const previewDraft = controlledPreviewDraft ?? localPreviewDraft
  const setPreviewDraft = onPreviewDraftChange ?? setLocalPreviewDraft
  const legacyVisibility = initialVisibility === 'unlisted'
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (busy || visibility === '' || name.trim() === '' || [...name.trim()].length > 120 || [...description.trim()].length > 2_000) return
    onSubmit({
      name: name.trim(), description: description.trim(), visibility,
      ...(iconFile === undefined ? {} : { iconFile }),
      ...(item.published === undefined ? {} : { previewDraft }),
    })
  }
  return <div style={styles.backdrop}>
    <section style={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="arkme-extension-edit-title">
      <h3 id="arkme-extension-edit-title" style={styles.title}>编辑扩展</h3>
      <form onSubmit={submit}>
        <ArkmeExtensionAvatarField
          {...(item.published?.extensionId === undefined ? {} : { extensionId: item.published.extensionId })}
          {...(item.published?.iconRef === undefined ? {} : { iconRef: item.published.iconRef })}
          {...(iconFile === undefined ? {} : { selectedFile: iconFile })}
          disabled={busy}
          onSelect={setIconFile}
        />
        <ArkmeExtensionPreviewField
          {...(item.published?.extensionId === undefined ? {} : { extensionId: item.published.extensionId })}
          draft={previewDraft}
          disabled={busy}
          onChange={setPreviewDraft}
        />
        <label style={styles.label}>名称<input style={styles.input} value={name} maxLength={120} required disabled={busy} onChange={event => { setName(event.target.value) }} /></label>
        <label style={styles.label}>说明<textarea style={styles.textarea} value={description} maxLength={2000} disabled={busy} onChange={event => { setDescription(event.target.value) }} /></label>
        <label style={styles.label}>可见范围<select
          style={styles.input} value={visibility} required disabled={busy}
          onChange={event => { setVisibility(event.target.value as ArkmeExtensionEditableVisibility | '') }}
        >
          {visibility === '' && <option value="">请选择可见范围</option>}
          <option value="private">仅自己</option><option value="public">公开</option>
        </select></label>
        {legacyVisibility && visibility === '' && <div role="status" style={styles.notice}>该历史可见范围已隐藏，请选择仅自己或公开后保存。</div>}
        {error !== '' && <div role="alert" style={styles.error}>{error}</div>}
        <div style={styles.actions}>
          <button type="button" style={styles.secondary} disabled={busy} onClick={onCancel}>取消</button>
          <button type="submit" style={styles.primary} disabled={busy || visibility === ''}>{busy ? '保存中…' : '保存'}</button>
        </div>
      </form>
    </section>
  </div>
}

const styles: Record<string, CSSProperties> = {
  backdrop: { position: 'absolute', zIndex: 4, inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(17, 24, 39, .28)' },
  dialog: { width: 'min(430px, calc(100% - 40px))', maxHeight: 'calc(100% - 32px)', overflowY: 'auto', padding: 22, boxSizing: 'border-box', borderRadius: 14, background: 'var(--dsw-specific-sidebar-fill, #fff)', boxShadow: '0 20px 55px rgba(0,0,0,.22)' },
  title: { margin: '0 0 16px', fontSize: 17 },
  label: { display: 'grid', gap: 6, marginTop: 11, color: 'var(--dsw-alias-label-secondary, #717780)', fontSize: 12 },
  input: { width: '100%', height: 36, padding: '0 10px', boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l1, #e7e9ec)', borderRadius: 8, background: 'transparent', color: 'inherit', font: 'inherit' },
  textarea: { width: '100%', minHeight: 62, padding: 10, resize: 'vertical', boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l1, #e7e9ec)', borderRadius: 8, background: 'transparent', color: 'inherit', font: 'inherit' },
  notice: { marginTop: 10, color: '#b06b16', fontSize: 11 },
  error: { marginTop: 12, color: '#b42318', fontSize: 12 },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 },
  secondary: { height: 34, padding: '0 14px', border: '1px solid var(--dsw-alias-border-l1, #e7e9ec)', borderRadius: 8, background: 'transparent', color: 'inherit' },
  primary: { height: 34, padding: '0 16px', border: 0, borderRadius: 8, background: 'var(--dsw-alias-label-primary, #292929)', color: '#fff', fontWeight: 600 },
}
