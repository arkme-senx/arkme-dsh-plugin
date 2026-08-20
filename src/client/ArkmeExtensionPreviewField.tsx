import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { arkmeExtensionPreviewUrl } from './ArkmeExtensionPreviewGallery.js'
import {
  appendExtensionPreviewFiles, moveExtensionPreviewDraftItem, removeExtensionPreviewDraftItem,
  type ExtensionPreviewDraft, type ExtensionPreviewDraftItem,
} from './extension-preview-edit.js'

function LocalImage({ item }: { item: Extract<ExtensionPreviewDraftItem, { kind: 'local' }> }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (typeof URL.createObjectURL !== 'function') return
    const next = URL.createObjectURL(item.file)
    setUrl(next)
    return () => { URL.revokeObjectURL(next) }
  }, [item.file])
  return url === '' ? <span style={styles.placeholder}>待上传</span> : <img src={url} alt="" style={styles.image} />
}

export function ArkmeExtensionPreviewField({ extensionId, draft, disabled, onChange }: {
  extensionId?: string
  draft: ExtensionPreviewDraft
  disabled: boolean
  onChange(draft: ExtensionPreviewDraft): void
}) {
  const input = useRef<HTMLInputElement>(null)
  const dragged = useRef<string>()
  const [error, setError] = useState('')
  if (extensionId === undefined) return <div style={styles.field}><b>扩展预览图</b><span style={styles.hint}>发布后可上传预览图</span></div>
  const addFiles = (files: readonly File[]) => {
    try {
      onChange(appendExtensionPreviewFiles(draft, files, () => crypto.randomUUID(), () => crypto.randomUUID()))
      setError('')
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
  }
  return <div style={styles.field}>
    <div style={styles.header}><b>扩展预览图</b><button type="button" disabled={disabled} onClick={() => { input.current?.click() }}>选择图片</button></div>
    <span style={styles.hint}>最多 20 张，第一张作为封面</span>
    <input ref={input} type="file" multiple accept="image/png,image/jpeg,image/webp" disabled={disabled} style={{ display: 'none' }} onChange={event => {
      const files = [...(event.target.files ?? [])]
      event.target.value = ''
      if (files.length > 0) addFiles(files)
    }} />
    {draft.items.length > 0 && <div style={styles.grid}>{draft.items.map((item, index) => <div
      key={item.id} draggable={!disabled} style={styles.item}
      onDragStart={() => { dragged.current = item.id }}
      onDragOver={event => { event.preventDefault() }}
      onDrop={() => { if (dragged.current !== undefined) onChange(moveExtensionPreviewDraftItem(draft, dragged.current, index)); dragged.current = undefined }}
    >
      <div style={styles.frame}>{item.kind === 'remote'
        ? <img src={arkmeExtensionPreviewUrl(extensionId, item.preview.preview_ref)} alt="" style={styles.image} />
        : <LocalImage item={item} />}</div>
      {index === 0 && <span style={styles.cover}>封面</span>}
      <div style={styles.actions}>
        <button type="button" aria-label={`向前移动第 ${index + 1} 张预览图`} disabled={disabled || index === 0} onClick={() => { onChange(moveExtensionPreviewDraftItem(draft, item.id, index - 1)) }}>←</button>
        <button type="button" aria-label={`向后移动第 ${index + 1} 张预览图`} disabled={disabled || index === draft.items.length - 1} onClick={() => { onChange(moveExtensionPreviewDraftItem(draft, item.id, index + 1)) }}>→</button>
        <button type="button" aria-label={`删除第 ${index + 1} 张预览图`} disabled={disabled} onClick={() => { onChange(removeExtensionPreviewDraftItem(draft, item.id)) }}>×</button>
      </div>
    </div>)}</div>}
    {error !== '' && <span role="alert" style={styles.error}>{error}</span>}
  </div>
}

const styles: Record<string, CSSProperties> = {
  field: { display: 'grid', gap: 6, marginTop: 12, padding: 10, border: '1px solid var(--dsw-alias-border-l1, #e7e9ec)', borderRadius: 10, fontSize: 12 },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  hint: { color: 'var(--dsw-alias-label-secondary, #717780)', fontSize: 11 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 },
  item: { position: 'relative', minWidth: 0 }, frame: { aspectRatio: '16 / 10', overflow: 'hidden', borderRadius: 8, background: '#f3f4f5' },
  image: { width: '100%', height: '100%', display: 'block', objectFit: 'cover' }, placeholder: { height: '100%', display: 'grid', placeItems: 'center', color: '#969ca5', fontSize: 10 },
  cover: { position: 'absolute', top: 4, left: 4, padding: '1px 5px', borderRadius: 999, background: '#09B83E', color: '#fff', fontSize: 9 },
  actions: { display: 'flex', justifyContent: 'center', gap: 3, marginTop: 4 }, error: { color: '#b42318', fontSize: 11 },
}
