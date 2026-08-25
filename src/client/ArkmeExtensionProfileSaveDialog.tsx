import { useState, type CSSProperties, type FormEvent } from 'react'
import type { ArkmeMyExtensionItem } from '../extensions/owned-types.js'

export interface ArkmeExtensionProfileSaveFormValue {
  name: string
  description: string
  version: string
}

export function ArkmeExtensionProfileSaveDialog({ item, busy, error, onCancel, onSubmit }: {
  item: ArkmeMyExtensionItem
  busy: boolean
  error: string
  onCancel(): void
  onSubmit(value: ArkmeExtensionProfileSaveFormValue): void
}) {
  const [name, setName] = useState(item.name)
  const [description, setDescription] = useState(item.description)
  const [version, setVersion] = useState('1.0.0')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    onSubmit({ name: name.trim(), description: description.trim(), version: version.trim() })
  }
  return <div style={styles.backdrop}>
    <section style={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="arkme-extension-profile-save-title">
      <h3 id="arkme-extension-profile-save-title" style={styles.title}>保存到 Profile</h3>
      <p style={styles.notice}>插件会保存为 V2 沙箱包，并在重启 DSH 后从当前 Profile 加载；此操作不会上传到应用市场。</p>
      <form onSubmit={submit}>
        <label style={styles.label}>名称<input style={styles.input} value={name} maxLength={120} required disabled={busy} onChange={event => { setName(event.target.value) }} /></label>
        <label style={styles.label}>说明<textarea style={styles.textarea} value={description} maxLength={2000} disabled={busy} onChange={event => { setDescription(event.target.value) }} /></label>
        <label style={styles.label}>版本<input style={styles.input} value={version} pattern="\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?" required disabled={busy} onChange={event => { setVersion(event.target.value) }} /></label>
        {error !== '' && <div role="alert" style={styles.error}>{error}</div>}
        <div style={styles.actions}>
          <button type="button" style={styles.secondary} disabled={busy} onClick={onCancel}>取消</button>
          <button type="submit" style={styles.primary} disabled={busy}>{busy ? '保存中…' : '确认保存'}</button>
        </div>
      </form>
    </section>
  </div>
}

const styles: Record<string, CSSProperties> = {
  backdrop: { position: 'absolute', zIndex: 4, inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(17, 24, 39, .28)' },
  dialog: { width: 'min(430px, calc(100% - 40px))', padding: 22, boxSizing: 'border-box', borderRadius: 14, background: 'var(--dsw-specific-sidebar-fill, #fff)', boxShadow: '0 20px 55px rgba(0,0,0,.22)' },
  title: { margin: '0 0 10px', fontSize: 17 },
  notice: { margin: '0 0 12px', color: 'var(--dsw-alias-label-secondary, #717780)', fontSize: 12, lineHeight: '18px' },
  label: { display: 'grid', gap: 6, marginTop: 11, color: 'var(--dsw-alias-label-secondary, #717780)', fontSize: 12 },
  input: { width: '100%', height: 36, padding: '0 10px', boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l1, #e7e9ec)', borderRadius: 8, background: 'transparent', color: 'inherit', font: 'inherit' },
  textarea: { width: '100%', minHeight: 62, padding: 10, resize: 'vertical', boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l1, #e7e9ec)', borderRadius: 8, background: 'transparent', color: 'inherit', font: 'inherit' },
  error: { marginTop: 12, color: '#b42318', fontSize: 12 },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 },
  secondary: { height: 34, padding: '0 14px', border: '1px solid var(--dsw-alias-border-l1, #e7e9ec)', borderRadius: 8, background: 'transparent', color: 'inherit' },
  primary: { height: 34, padding: '0 16px', border: 0, borderRadius: 8, background: 'var(--dsw-alias-label-primary, #292929)', color: '#fff', fontWeight: 600 },
}
