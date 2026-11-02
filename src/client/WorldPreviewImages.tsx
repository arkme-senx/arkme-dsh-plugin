import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ArkmeImagePayload } from '../types.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { WorldImagePreviewDialog } from './ArkmeWorldSurface.js'
import { invalidateWorldImages, subscribeWorldImageInvalidation } from './world-image-cache.js'
import { withArkmeReadDeadline } from './read-deadline.js'
import { tr } from './locale.js'

// Match the existing team image owner (two active reads). Entries only live while
// a mounted, visible thumbnail needs them; no media/authority cache is added.
let active = 0
const waiting: { run(): void; cancel(): void }[] = []
export function readPreviewImage(imageRef: string, publicImage: boolean, signal: AbortSignal): Promise<ArkmeImagePayload> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return }
    if (waiting.length >= 80) { reject(new Error(tr('图片加载繁忙，请重试'))); return }
    const task = {
      cancel() { const i = waiting.indexOf(task); if (i >= 0) waiting.splice(i, 1); reject(signal.reason) },
      run() {
        signal.removeEventListener('abort', task.cancel)
        if (signal.aborted) { reject(signal.reason); return }
        active++
        void withArkmeReadDeadline(s => publicImage ? callArkme<ArkmeImagePayload>('world.image.read', { imageRef }, s) : callArkme<ArkmeImagePayload>('image.read', { imageRef }, s), signal)
          .then(resolve, reject).finally(() => { active--; drain() })
      },
    }
    signal.addEventListener('abort', task.cancel, { once: true })
    waiting.push(task); drain()
  })
}
function drain() { while (active < 2 && waiting.length) waiting.shift()!.run() }

function PreviewImage({ imageRef, publicImage, large = false }: { imageRef: string; publicImage: boolean; large?: boolean }) {
  const [url, setUrl] = useState(''), [failed, setFailed] = useState(false), [attempt, retry] = useState(0)
  const [visible, setVisible] = useState(large)
  const node = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (large || typeof IntersectionObserver === 'undefined') { setVisible(true); return }
    const observer = new IntersectionObserver(entries => setVisible(entries.some(e => e.isIntersecting)), { rootMargin: '80px' })
    if (node.current) observer.observe(node.current)
    return () => observer.disconnect()
  }, [large])
  useEffect(() => {
    setUrl(''); setFailed(false)
    if (!visible) return
    const controller = new AbortController()
    let objectURL = ''
    const release = () => { if (objectURL) URL.revokeObjectURL(objectURL); objectURL = ''; setUrl('') }
    const stop = subscribeWorldImageInvalidation(imageRef, () => { controller.abort(); release(); setFailed(true) })
    void readPreviewImage(imageRef, publicImage, controller.signal).then(image => {
      if (controller.signal.aborted) return
      const bytes = Uint8Array.from(atob(image.dataBase64), ch => ch.charCodeAt(0))
      objectURL = URL.createObjectURL(new Blob([bytes], { type: image.mediaType })); setUrl(objectURL)
    }).catch(() => { if (!controller.signal.aborted) { invalidateWorldImages([imageRef]); setFailed(true) } })
    return () => { controller.abort(); stop(); if (objectURL) URL.revokeObjectURL(objectURL) }
  }, [imageRef, publicImage, visible, attempt])
  return <span ref={node} className={large ? 'wm-preview-image wm-preview-large' : 'wm-preview-image'}>
    {url ? <img src={url} alt={tr('图片预览')} draggable={false} /> : failed ? <button type="button" className="wm-button" data-kind="quiet" onClick={e => { e.stopPropagation(); retry(n => n + 1) }}>{tr('图片加载失败，重试')}</button> : <span role="status" aria-label={tr('正在读取图片…')} className="wm-image-placeholder" />}
  </span>
}

export function WorldPreviewImages({ imageRefs, publicImage = false, detail = false }: { imageRefs: readonly string[]; publicImage?: boolean; detail?: boolean }) {
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot).auth
  const scope = `${auth?.environment}:${auth?.status}:${auth?.userId}`
  return <ScopedImages key={`${scope}:${imageRefs.join('|')}`} imageRefs={imageRefs} publicImage={publicImage} detail={detail} />
}
function ScopedImages({ imageRefs, publicImage, detail }: { imageRefs: readonly string[]; publicImage: boolean; detail: boolean }) {
  const [selected, select] = useState<number>()
  const previewOpen = selected !== undefined
  useEffect(() => {
    if (!previewOpen) return
    // Own the key before the thumbnail container stops bubbling, and never
    // let the same Escape dismiss a detail panel beneath the image.
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault(); event.stopPropagation(); select(undefined)
    }
    document.addEventListener('keydown', close, true)
    return () => document.removeEventListener('keydown', close, true)
  }, [previewOpen])
  if (!imageRefs.length) return null
  return <div onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
    <div className="wm-preview-images" data-single={imageRefs.length === 1} data-detail={detail}>
      {imageRefs.slice(0, 3).map((imageRef, index) => <div className="wm-preview-tile" key={imageRef}>
        <PreviewImage imageRef={imageRef} publicImage={publicImage} />
        <button className="wm-image-open" type="button" aria-label={tr('放大图片 {v0}', { v0: index + 1 })} onClick={e => { e.stopPropagation(); select(index) }}>
          {index === 2 && imageRefs.length > 3 && <span>+{imageRefs.length - 3}</span>}
        </button>
      </div>)}
    </div>
    {selected !== undefined && <WorldImagePreviewDialog item={{ imageRefs: [...imageRefs], authorName: tr('图片') }} previewIndex={selected} onClose={() => select(undefined)} onSelect={select}
      renderMedia={ref => <PreviewImage key={ref} imageRef={ref} publicImage={publicImage} large />} />}
  </div>
}
