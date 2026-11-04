import { useEffect, useRef, useState } from 'react'
import type { ArkmeImagePayload } from '../types.js'
import { callArkme } from './api.js'
import { WorldImagePreviewDialog } from './ArkmeWorldSurface.js'
import { subscribeWorldImageInvalidation } from './world-image-cache.js'
import { withArkmeReadDeadline } from './read-deadline.js'
import { arkmeTheme as c } from './arkme-theme.js'
import { tr } from './locale.js'

// Private originals use their own authorized reader, never the public World image cache.
let active = 0
const waiting: { start(): void; cancel(): void }[] = []
export function readTeamWorldImage(imageRef: string, signal: AbortSignal): Promise<ArkmeImagePayload> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return }
    if (waiting.length >= 80) { reject(Error(tr('图片读取繁忙，请重试'))); return }
    const task = {
      cancel() { const index = waiting.indexOf(task); if (index >= 0) waiting.splice(index, 1); reject(signal.reason) },
      start() {
        signal.removeEventListener('abort', task.cancel)
        if (signal.aborted) { reject(signal.reason); return }
        active++
        void withArkmeReadDeadline(s => callArkme<ArkmeImagePayload>('image.read', { imageRef }, s), signal).then(resolve, reject).finally(() => { active--; drain() })
      },
    }
    signal.addEventListener('abort', task.cancel, { once: true }); waiting.push(task); drain()
  })
}
function drain() { while (active < 2 && waiting.length) waiting.shift()!.start() }
function Image({ imageRef, large = false, zoomed = false, thumbnailSize = 120 }: { imageRef: string; large?: boolean; zoomed?: boolean; thumbnailSize?: number }) {
  const node = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(large), [url, setUrl] = useState(''), [error, setError] = useState(false), [attempt, retry] = useState(0)
  useEffect(() => {
    if (large || typeof IntersectionObserver === 'undefined') { setVisible(true); return }
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)), { rootMargin: '80px' })
    if (node.current) observer.observe(node.current)
    return () => observer.disconnect()
  }, [large])
  useEffect(() => {
    setUrl(''); setError(false)
    if (!visible) return
    const controller = new AbortController(); let objectURL = ''
    const stop = subscribeWorldImageInvalidation(imageRef, () => { controller.abort(); setUrl(''); setError(true); if (objectURL) URL.revokeObjectURL(objectURL) })
    void readTeamWorldImage(imageRef, controller.signal).then(image => {
      if (controller.signal.aborted) return
      objectURL = URL.createObjectURL(new Blob([Uint8Array.from(atob(image.dataBase64), ch => ch.charCodeAt(0))], { type: image.mediaType })); setUrl(objectURL)
    }).catch(() => { if (!controller.signal.aborted) setError(true) })
    return () => { controller.abort(); stop(); if (objectURL) URL.revokeObjectURL(objectURL) }
  }, [imageRef, visible, attempt])
  useEffect(() => { const refresh = () => retry(value => value + 1); window.addEventListener('focus', refresh); return () => window.removeEventListener('focus', refresh) }, [])
  return <span ref={node} style={{ display: 'inline-flex', width: large ? zoomed ? '200%' : '100%' : thumbnailSize, height: large ? zoomed ? '200%' : '100%' : thumbnailSize, background: c.subtle, borderRadius: 8, overflow: 'hidden' }}>
    {url ? <img src={url} alt={tr('团队内容图片')} style={{ width: '100%', height: '100%', objectFit: large ? 'contain' : 'cover' }} /> : error ? <span>{tr('图片暂不可访问')}</span> : <span role="status" aria-label={tr('正在读取图片…')} />}
  </span>
}
export function TeamWorldImages({ imageRefs, compact = false }: { imageRefs: readonly string[]; compact?: boolean }) {
  const [selected, select] = useState<number>()
  useEffect(() => {
    if (selected === undefined) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); select(undefined) } }
    document.addEventListener('keydown', close, true); return () => document.removeEventListener('keydown', close, true)
  }, [selected])
  useEffect(() => { select(undefined) }, [imageRefs.join('|')])
  return <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: compact ? 0 : 10, flexShrink: 0 }}>
    {imageRefs.slice(0, compact ? 1 : 3).map((ref, index) => <button key={ref} type="button" aria-label={tr('预览图片 {v0}', { v0: index + 1 })} style={{ position: 'relative', display: 'inline-flex', padding: 0, border: 0, borderRadius: 8, background: 'transparent', cursor: 'pointer' }} onClick={() => select(index)}><Image imageRef={ref} thumbnailSize={compact ? 86 : 120} />{compact && imageRefs.length > 1 && <span aria-hidden="true" style={{ position: 'absolute', right: 4, bottom: 4, padding: '2px 4px', borderRadius: 4, background: 'rgba(0,0,0,.55)', color: '#fff', fontSize: 11 }}>+{imageRefs.length - 1}</span>}</button>)}
    {selected !== undefined && <WorldImagePreviewDialog item={{ imageRefs: [...imageRefs], authorName: tr('团队') }} previewIndex={selected} onClose={() => select(undefined)} onSelect={select} renderMedia={(ref, zoomed) => <Image key={ref} imageRef={ref} large zoomed={zoomed} />} />}
  </div>
}
