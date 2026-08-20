import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { ArkmeExtensionAvatar } from './ArkmeExtensionAvatar.js'
import { ArkmeExtensionAvatarCropDialog } from './ArkmeExtensionAvatarCropDialog.js'
import { extensionAvatarSourceError } from './extension-avatar-crop.js'

export function ArkmeExtensionAvatarField({ extensionId, iconRef, selectedFile, disabled, onSelect }: {
  extensionId?: string
  iconRef?: string
  selectedFile?: File
  disabled: boolean
  onSelect(file: File): void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [active, setActive] = useState(false)
  const [error, setError] = useState('')
  const [sourceFile, setSourceFile] = useState<File>()
  useEffect(() => {
    if (selectedFile === undefined || typeof URL.createObjectURL !== 'function') {
      setPreviewUrl('')
      return
    }
    const next = URL.createObjectURL(selectedFile)
    setPreviewUrl(next)
    return () => { URL.revokeObjectURL(next) }
  }, [selectedFile])
  return <div style={styles.row}>
    <button
      type="button"
      aria-label="更换扩展头像"
      disabled={disabled}
      style={styles.action}
      onClick={() => { input.current?.click() }}
      onMouseEnter={() => { setActive(true) }}
      onMouseLeave={() => { setActive(false) }}
      onFocus={() => { setActive(true) }}
      onBlur={() => { setActive(false) }}
    >
      <span style={styles.avatar}>
        {previewUrl === ''
          ? <ArkmeExtensionAvatar extensionId={extensionId ?? 'extension-draft'} iconRef={iconRef} size={64} />
          : <img src={previewUrl} alt="" style={styles.image} />}
      </span>
      <span style={{ ...styles.camera, opacity: active ? 1 : 0 }} aria-hidden>⌁</span>
    </button>
    <span style={styles.copy}>
      <span style={styles.title}>扩展头像</span>
      <span style={styles.description}>{selectedFile === undefined
        ? '支持常见图片，选择后可手动裁剪并自动压缩'
        : '已完成裁剪，点此可重新选择'}</span>
      {selectedFile !== undefined && <span style={styles.fileName}>{selectedFile.name}</span>}
      {error !== '' && <span role="alert" style={styles.error}>{error}</span>}
    </span>
    <input
      ref={input}
      type="file"
      accept="image/*"
      disabled={disabled}
      style={{ display: 'none' }}
      onChange={event => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (file === undefined) return
        const nextError = extensionAvatarSourceError(file)
        if (nextError !== undefined) {
          setError(nextError)
          return
        }
        setError('')
        setSourceFile(file)
      }}
    />
    {sourceFile !== undefined && <ArkmeExtensionAvatarCropDialog
      sourceFile={sourceFile}
      onCancel={() => { setSourceFile(undefined) }}
      onConfirm={file => { setSourceFile(undefined); onSelect(file) }}
    />}
  </div>
}

const styles: Record<string, CSSProperties> = {
  row: {
    display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, padding: 10,
    border: '1px solid var(--dsw-alias-border-l1, #e7e9ec)', borderRadius: 10,
  },
  action: {
    position: 'relative', width: 72, height: 72, flex: 'none', padding: 4,
    border: 0, background: 'transparent', cursor: 'pointer', boxSizing: 'border-box',
  },
  avatar: { width: 64, height: 64, display: 'block', overflow: 'hidden', borderRadius: '50%' },
  image: { width: 64, height: 64, display: 'block', objectFit: 'cover' },
  camera: {
    position: 'absolute', right: 2, bottom: 2, width: 22, height: 22, display: 'grid', placeItems: 'center',
    borderRadius: '50%', background: 'var(--dsw-alias-label-primary, #292929)', color: '#fff', fontSize: 14,
    transition: 'opacity .14s ease',
  },
  copy: { minWidth: 0, display: 'grid', gap: 3 },
  title: { color: 'var(--dsw-alias-label-primary, #242629)', fontSize: 12, fontWeight: 600 },
  description: { color: 'var(--dsw-alias-label-secondary, #717780)', fontSize: 11, lineHeight: '16px' },
  fileName: { color: 'var(--dsw-alias-label-caption, #9ba1a9)', fontSize: 10, wordBreak: 'break-all' },
  error: { color: '#b42318', fontSize: 11 },
}
