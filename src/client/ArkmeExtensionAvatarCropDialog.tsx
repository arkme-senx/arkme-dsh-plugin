import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { extensionAvatarCropGeometry, normalizeExtensionAvatar } from './extension-avatar-crop.js'

const VIEWPORT_SIZE = 280

export function ArkmeExtensionAvatarCropDialog({ sourceFile, onCancel, onConfirm }: {
  sourceFile: File
  onCancel(): void
  onConfirm(file: File): void
}) {
  const image = useRef<HTMLImageElement>(null)
  const drag = useRef<{ pointerId: number; clientX: number; clientY: number; panX: number; panY: number }>()
  const [sourceUrl, setSourceUrl] = useState('')
  const [imageSize, setImageSize] = useState<{ width: number; height: number }>()
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (typeof URL.createObjectURL !== 'function') return
    const next = URL.createObjectURL(sourceFile)
    setSourceUrl(next)
    return () => { URL.revokeObjectURL(next) }
  }, [sourceFile])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return
      event.preventDefault()
      event.stopImmediatePropagation()
      onCancel()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => { document.removeEventListener('keydown', onKeyDown, true) }
  }, [busy, onCancel])

  const geometry = imageSize === undefined ? undefined : extensionAvatarCropGeometry({
    imageWidth: imageSize.width,
    imageHeight: imageSize.height,
    viewportSize: VIEWPORT_SIZE,
    zoom,
    panX: pan.x,
    panY: pan.y,
  })

  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (current === undefined || current.pointerId !== event.pointerId || imageSize === undefined) return
    const next = extensionAvatarCropGeometry({
      imageWidth: imageSize.width,
      imageHeight: imageSize.height,
      viewportSize: VIEWPORT_SIZE,
      zoom,
      panX: current.panX + event.clientX - current.clientX,
      panY: current.panY + event.clientY - current.clientY,
    })
    setPan({ x: next.panX, y: next.panY })
  }

  const confirm = async () => {
    if (busy || image.current === null || geometry === undefined) return
    setBusy(true); setError('')
    try {
      onConfirm(await normalizeExtensionAvatar(image.current, geometry))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  return <div style={styles.backdrop}>
    <section style={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="arkme-extension-avatar-crop-title">
      <h3 id="arkme-extension-avatar-crop-title" style={styles.title}>裁剪扩展头像</h3>
      <p style={styles.hint}>拖动图片调整位置，使用滑块缩放；最终会生成正方形头像并自动压缩。</p>
      <div
        style={styles.viewport}
        onPointerDown={event => {
          if (geometry === undefined) return
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = {
            pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY,
            panX: geometry.panX, panY: geometry.panY,
          }
        }}
        onPointerMove={move}
        onPointerUp={event => {
          if (drag.current?.pointerId === event.pointerId) drag.current = undefined
          event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onPointerCancel={() => { drag.current = undefined }}
      >
        {sourceUrl !== '' && <img
          ref={image}
          src={sourceUrl}
          alt="待裁剪扩展头像"
          draggable={false}
          style={geometry === undefined ? styles.loadingImage : {
            ...styles.image,
            width: geometry.renderedWidth,
            height: geometry.renderedHeight,
            left: geometry.displayLeft,
            top: geometry.displayTop,
          }}
          onLoad={event => {
            const target = event.currentTarget
            if (target.naturalWidth <= 0 || target.naturalHeight <= 0) {
              setError('当前浏览器无法解析这张图片')
              return
            }
            setImageSize({ width: target.naturalWidth, height: target.naturalHeight })
            setPan({ x: 0, y: 0 })
          }}
          onError={() => { setError('当前浏览器无法解析这张图片，请改用常见图片格式') }}
        />}
        <span style={styles.gridVertical} aria-hidden />
        <span style={styles.gridHorizontal} aria-hidden />
      </div>
      <label style={styles.zoomLabel}>缩放<input
        aria-label="头像缩放"
        type="range"
        min="1"
        max="3"
        step="0.01"
        value={zoom}
        disabled={busy || imageSize === undefined}
        onChange={event => {
          const nextZoom = Number(event.target.value)
          setZoom(nextZoom)
          if (imageSize !== undefined) {
            const next = extensionAvatarCropGeometry({
              imageWidth: imageSize.width, imageHeight: imageSize.height, viewportSize: VIEWPORT_SIZE,
              zoom: nextZoom, panX: pan.x, panY: pan.y,
            })
            setPan({ x: next.panX, y: next.panY })
          }
        }}
      /></label>
      {error !== '' && <div role="alert" style={styles.error}>{error}</div>}
      <div style={styles.actions}>
        <button type="button" style={styles.secondary} disabled={busy} onClick={onCancel}>取消</button>
        <button type="button" style={styles.primary} disabled={busy || geometry === undefined} onClick={() => { void confirm() }}>
          {busy ? '处理中…' : '确认裁剪'}
        </button>
      </div>
    </section>
  </div>
}

const styles: Record<string, CSSProperties> = {
  backdrop: { position: 'fixed', zIndex: 120, inset: 0, display: 'grid', placeItems: 'center', padding: 20, background: 'rgba(17, 24, 39, .48)' },
  dialog: { width: 'min(360px, 100%)', padding: 20, boxSizing: 'border-box', borderRadius: 14, background: 'var(--dsw-specific-sidebar-fill, #fff)', boxShadow: '0 22px 65px rgba(0,0,0,.28)' },
  title: { margin: 0, fontSize: 17 },
  hint: { margin: '7px 0 14px', color: 'var(--dsw-alias-label-secondary, #717780)', fontSize: 11, lineHeight: '17px' },
  viewport: { position: 'relative', width: 280, height: 280, maxWidth: '100%', margin: '0 auto', overflow: 'hidden', borderRadius: 12, background: '#17191d', touchAction: 'none', cursor: 'grab' },
  image: { position: 'absolute', maxWidth: 'none', userSelect: 'none', pointerEvents: 'none' },
  loadingImage: { position: 'absolute', width: 1, height: 1, opacity: 0 },
  gridVertical: { position: 'absolute', top: 0, bottom: 0, left: '33.333%', right: '33.333%', borderLeft: '1px solid rgba(255,255,255,.28)', borderRight: '1px solid rgba(255,255,255,.28)', pointerEvents: 'none' },
  gridHorizontal: { position: 'absolute', left: 0, right: 0, top: '33.333%', bottom: '33.333%', borderTop: '1px solid rgba(255,255,255,.28)', borderBottom: '1px solid rgba(255,255,255,.28)', pointerEvents: 'none' },
  zoomLabel: { display: 'grid', gridTemplateColumns: '42px 1fr', alignItems: 'center', gap: 8, marginTop: 14, color: 'var(--dsw-alias-label-secondary, #717780)', fontSize: 11 },
  error: { marginTop: 10, color: '#b42318', fontSize: 11 },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
  secondary: { height: 34, padding: '0 14px', border: '1px solid var(--dsw-alias-border-l1, #e7e9ec)', borderRadius: 8, background: 'transparent', color: 'inherit' },
  primary: { height: 34, padding: '0 16px', border: 0, borderRadius: 8, background: 'var(--dsw-alias-label-primary, #292929)', color: '#fff', fontWeight: 600 },
}
