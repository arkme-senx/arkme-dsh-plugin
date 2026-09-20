import { tr, useArkmeLocale } from './locale.js'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { ArkmeFileIcon } from './ArkmeFileIcon.js'
import type { ArkmeContentBlock } from '../types.js'
import { arkmeBrowserVisualKind, arkmeCanInlineLocalFile, type ArkmeFileReception } from '../file-transfer-contract.js'
import { createArkmeSdk } from '../sdk/index.js'
import { arkmeTheme } from './arkme-theme.js'

const sdk = createArkmeSdk()
const markdownLabels = { code: { copyLabel: '复制', copiedLabel: '复制成功' }, footnotes: '脚注' }
// Newer hosts require labels; older hosts read codeLabels instead.
const markdownLabelProps = { labels: markdownLabels, codeLabels: markdownLabels.code }
const receptionListeners = new Map<string, Set<(value: ArkmeFileReception) => void>>()
function publishReception(identity: string, value: ArkmeFileReception) {
  for (const listener of receptionListeners.get(identity) ?? []) listener(value)
}
export const arkmeLocalFileUrl = (ref: string, download = false): string => sdk.localFileUrl(ref, download)
export function arkmeFileSize(size: number): string {
  return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : size >= 1024 ? `${(size / 1024).toFixed(1)} KB` : `${size} B`
}

function canPreviewTextFile(block: ArkmeContentBlock): boolean {
  return /\.(md|markdown|txt|csv|log)$/i.test(block.fileName) && block.size <= 2 * 1024 * 1024
}

export function arkmeCanPreviewFile(block: ArkmeContentBlock): boolean {
  return canPreviewTextFile(block) || arkmeCanInlineLocalFile(block.mimeType, block.fileName)
}

export function useArkmeOriginal(block: ArkmeContentBlock | undefined, autoReceive = false, refreshKey?: unknown) {
  const identity = block?.localFileRef ?? block?.originalRef ?? block?.mediaRef
  const [snapshot, setSnapshot] = useState<{ identity: string; value: ArkmeFileReception }>()
  const reception: ArkmeFileReception = identity !== undefined && snapshot?.identity === identity ? snapshot.value : { state: 'missing', receivedBytes: 0, totalBytes: block?.size ?? 0 }
  const [revision, setRevision] = useState(0)
  const [requested, setRequested] = useState<string>()
  useEffect(() => {
    if (identity === undefined || block?.localFileRef !== undefined) return
    let active = true
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    setSnapshot({ identity, value: { state: 'missing', receivedBytes: 0, totalBytes: block?.size ?? 0 } })
    if (block?.originalRef === undefined) return
    const listeners = receptionListeners.get(identity) ?? new Set<(value: ArkmeFileReception) => void>()
    const update = (value: ArkmeFileReception) => { if (active) setSnapshot({ identity, value }) }
    listeners.add(update); receptionListeners.set(identity, listeners)
    const poll = async (start: boolean) => {
      try {
        const value = await sdk.receiveFile(block.originalRef!, start, controller.signal)
        if (!active) return
        publishReception(identity, value)
        if (value.state === 'receiving') timer = setTimeout(() => { void poll(false) }, 750)
      } catch (error) {
        if (active) setSnapshot({ identity, value: { state: 'failed', receivedBytes: 0, totalBytes: block?.size ?? 0, error: error instanceof Error ? error.message : '文件接收失败' } })
      }
    }
    void poll(autoReceive || requested === identity)
    return () => {
      active = false; controller.abort(); if (timer !== undefined) clearTimeout(timer)
      listeners.delete(update); if (listeners.size === 0) receptionListeners.delete(identity)
    }
  }, [identity, block?.originalRef, block?.localFileRef, block?.size, autoReceive, requested, revision, refreshKey])
  const localRef = block?.localFileRef ?? reception.file?.fileRef
  return { reception, localRef, receive: () => {
    if (identity === undefined) return
    setSnapshot({ identity, value: { state: 'missing', receivedBytes: 0, totalBytes: block?.size ?? 0 } })
    setRequested(identity); setRevision(value => value + 1)
  } }
}

type SavePickerWindow = Window & { showSaveFilePicker?: (options: { suggestedName: string }) => Promise<{ createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void>; abort(): Promise<void> }> }> }

const filePanelActionStyle: CSSProperties = { flex: '1 1 auto', padding: '10px 16px', border: 0, borderRadius: 999, background: 'var(--dsw-alias-interactive-bg-hover)', color: 'var(--dsw-alias-label-primary)', fontSize: 14, whiteSpace: 'nowrap', cursor: 'pointer' }
const primaryActionStyle: CSSProperties = { padding: '10px 24px', border: 0, borderRadius: 8, background: 'var(--dsw-alias-state-business-primary, #3964fe)', color: 'white', fontSize: 14, cursor: 'pointer' }
const fileActionEnabledBackground = 'rgba(20,22,24,.38)'
const fileActionDisabledBackground = 'rgba(20,22,24,.20)'
const fileActionEnabledColor = 'rgba(255,255,255,.90)'
const fileActionDisabledColor = 'rgba(255,255,255,.28)'
const fileActionGroupStyle: CSSProperties = { display: 'flex', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12, fontSize: 12 }
const fileActionButtonStyle: CSSProperties = { width: 30, height: 30, flex: 'none', display: 'grid', placeItems: 'center', border: 0, padding: 0, borderRadius: '50%', background: fileActionEnabledBackground, color: fileActionEnabledColor, cursor: 'pointer' }
const fileActionNavButtonStyle: CSSProperties = { ...fileActionButtonStyle }
const fileActionWideGapStyle: CSSProperties = { width: 24, flex: 'none' }
const fileActionToastBubbleStyle: CSSProperties = { maxWidth: 'calc(100% - 40px)', boxSizing: 'border-box', padding: '15px 20px', borderRadius: 5, background: '#fff', color: '#000', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 15, lineHeight: '21px', fontWeight: 400, pointerEvents: 'none' }

export type ArkmeFileActionNoticeKind = 'progress' | 'success' | 'error'
export interface ArkmeFileActionNotice {
  message: string
  kind: ArkmeFileActionNoticeKind
}
export type ArkmeFileActionNoticeHandler = (notice: ArkmeFileActionNotice) => void

function fileActionStateStyle(disabled: boolean, busy = false): CSSProperties {
  return {
    ...fileActionButtonStyle,
    background: disabled ? fileActionDisabledBackground : fileActionEnabledBackground,
    color: disabled ? fileActionDisabledColor : fileActionEnabledColor,
    cursor: busy ? 'progress' : disabled ? 'default' : 'pointer',
  }
}

export function useArkmeFileActionNotice(durationMs = 800) {
  const [notice, setNotice] = useState<ArkmeFileActionNotice>()
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const clearNotice = useCallback(() => {
    if (timer.current !== undefined) {
      clearTimeout(timer.current)
      timer.current = undefined
    }
    setNotice(undefined)
  }, [])
  const showNotice = useCallback((next: ArkmeFileActionNotice) => {
    if (timer.current !== undefined) {
      clearTimeout(timer.current)
      timer.current = undefined
    }
    setNotice(next)
    if (next.kind !== 'progress') {
      timer.current = setTimeout(() => {
        timer.current = undefined
        setNotice(undefined)
      }, durationMs)
    }
  }, [durationMs])
  useEffect(() => () => {
    if (timer.current !== undefined) clearTimeout(timer.current)
  }, [])
  return { notice, showNotice, clearNotice }
}

export function ArkmeFileActionToast({ notice, style }: { notice: ArkmeFileActionNotice | undefined; style?: CSSProperties | undefined }) {
  if (notice === undefined) return null
  return <div style={{ display: 'flex', justifyContent: 'center', pointerEvents: 'none', ...style }}>
    <span role="status" aria-live="polite" data-arkme-file-action-toast={notice.kind} style={{
      ...fileActionToastBubbleStyle,
    }}>{notice.message}</span>
  </div>
}

function fileActionNoun(block: Pick<ArkmeContentBlock, 'kind'>): string {
  if (block.kind === 'image') return '图片'
  if (block.kind === 'video') return '视频'
  return '文件'
}

export async function arkmeClipboardImageBlob(blob: Blob): Promise<Blob> {
  const canvas = document.createElement('canvas')
  const bitmap = await createImageBitmap(blob)
  try {
    canvas.width = bitmap.width; canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('图片转换失败')
    context.drawImage(bitmap, 0, 0)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(value => value === null ? reject(new Error('图片转换失败')) : resolve(value), 'image/png')
    })
  } finally {
    bitmap.close()
    canvas.width = 0; canvas.height = 0
  }
}

function FileReceptionProgress({ reception, fileName, noun = '文件' }: { reception: ArkmeFileReception; fileName: string; noun?: string }) {
  const percent = reception.totalBytes > 0 ? Math.max(0, Math.min(100, Math.round(reception.receivedBytes / reception.totalBytes * 100))) : undefined
  return <div style={{ width: 220, maxWidth: '100%', margin: '8px 0' }}>
    <div role="status" style={{ color: 'var(--dsw-alias-label-tertiary, #9097a1)', fontSize: 12, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
      {percent === undefined ? tr("正在接收{v0}", { v0: noun }) : tr("正在接收{v0} {v1}%", { v0: noun, v1: percent })}
    </div>
    <div role="progressbar" aria-label={tr("接收 {v0}", { v0: fileName })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
      style={{ position: 'relative', height: 4, borderRadius: 999, overflow: 'hidden', marginTop: 8 }}>
      <div style={{ position: 'absolute', inset: 0, background: 'var(--dsw-alias-state-business-primary, #3964fe)', opacity: .16 }} />
      {percent !== undefined && <div style={{ position: 'relative', height: '100%', width: `${percent}%`, borderRadius: 'inherit', background: 'var(--dsw-alias-state-business-primary, #3964fe)', transition: 'width 180ms ease-out' }} />}
    </div>
  </div>
}

/** Browser fallback deliberately reports handoff, not an unverifiable disk-save success. */
function useArkmeFileDownload(block: ArkmeContentBlock, original: ReturnType<typeof useArkmeOriginal>) {
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const saveController = useRef<AbortController>()
  const { localRef } = original
  const identity = block.fileAssetUid ?? block.localFileRef ?? block.originalRef ?? block.mediaRef
  useEffect(() => () => { saveController.current?.abort() }, [identity])
  useEffect(() => { setNotice(''); setSaved(false); setSaving(false) }, [identity])
  const save = async () => {
    if ((localRef === undefined && block.originalRef === undefined) || (saveController.current !== undefined && !saveController.current.signal.aborted)) return
    const controller = new AbortController(); saveController.current = controller
    setSaving(true); setNotice('')
    try {
      const picker = (window as SavePickerWindow).showSaveFilePicker
      // Choose a destination first. Cancelling must not start reception or fetch bytes.
      const handle = picker === undefined ? undefined : await picker.call(window, { suggestedName: block.fileName })
      controller.signal.throwIfAborted()
      let saveRef = localRef
      if (saveRef === undefined) {
        let value = await sdk.receiveFile(block.originalRef!, true, controller.signal)
        const deadline = Date.now() + 120_000
        publishReception(block.originalRef!, value)
        while (value.state === 'receiving' || value.state === 'missing') {
          if (Date.now() >= deadline) throw new Error('接收文件超时，请重试')
          await new Promise<void>((resolve, reject) => {
            const abort = () => { clearTimeout(timer); reject(controller.signal.reason) }
            const timer = setTimeout(() => { controller.signal.removeEventListener('abort', abort); resolve() }, 750)
            controller.signal.addEventListener('abort', abort, { once: true })
            if (controller.signal.aborted) abort()
          })
          value = await sdk.receiveFile(block.originalRef!, false, controller.signal)
          publishReception(block.originalRef!, value)
        }
        if (value.state !== 'ready' || value.file === undefined) throw new Error(value.error ?? '原文件不可用')
        saveRef = value.file.fileRef
      }
      controller.signal.throwIfAborted()
      if (handle !== undefined) {
        const response = await fetch(arkmeLocalFileUrl(saveRef), { signal: controller.signal })
        if (!response.ok) throw new Error('原文件已不可用，请重新接收')
        controller.signal.throwIfAborted()
        const writable = await handle.createWritable()
        try {
          controller.signal.throwIfAborted()
          const data = await response.blob()
          controller.signal.throwIfAborted()
          await writable.write(data)
          controller.signal.throwIfAborted()
          await writable.close()
        }
        catch (error) { await writable.abort().catch(() => {}); throw error }
        if (!controller.signal.aborted) { setNotice('保存成功'); setSaved(true) }
      } else {
        const link = document.createElement('a')
        link.href = arkmeLocalFileUrl(saveRef, true); link.download = block.fileName
        document.body.append(link); link.click(); link.remove()
        setNotice('已交给浏览器下载')
      }
    } catch (error) {
      if (!controller.signal.aborted && !(error instanceof DOMException && error.name === 'AbortError')) setNotice(error instanceof Error ? error.message : '保存失败，请重试')
    } finally {
      if (saveController.current === controller) { saveController.current = undefined; setSaving(false) }
    }
  }
  return { notice, saving, saved, save }
}

type ImageCopySources = { localOriginalRef: string | undefined; remoteOriginalRef: string | undefined; previewUrl: string | undefined }

function useArkmeImageCopy(block: ArkmeContentBlock, sources: ImageCopySources, onNotice?: ArkmeFileActionNoticeHandler) {
  const { localOriginalRef, remoteOriginalRef, previewUrl } = sources
  const imageIdentity = block.fileAssetUid ?? block.mediaRef
  const [copying, setCopying] = useState(false)
  const copyController = useRef<AbortController>()
  useEffect(() => {
    setCopying(false)
    return () => { copyController.current?.abort(); copyController.current = undefined }
  }, [imageIdentity])
  const copy = async () => {
    if (block.kind !== 'image' || copyController.current !== undefined) return
    const clipboardWrite = typeof navigator === 'undefined' ? undefined : navigator.clipboard?.write?.bind(navigator.clipboard)
    const ClipboardItemConstructor = typeof ClipboardItem === 'undefined' ? undefined : ClipboardItem
    if (clipboardWrite === undefined || ClipboardItemConstructor === undefined || typeof fetch === 'undefined' || (localOriginalRef === undefined && remoteOriginalRef === undefined && previewUrl === undefined)) {
      onNotice?.({ message: '复制失败', kind: 'error' })
      return
    }
    const controller = new AbortController()
    copyController.current = controller
    setCopying(true)
    onNotice?.({ message: '复制中...', kind: 'progress' })
    try {
      const urls = [...new Set([
        localOriginalRef === undefined ? undefined : arkmeLocalFileUrl(localOriginalRef),
        remoteOriginalRef === undefined ? undefined : `/arkme-self/api/media?ref=${encodeURIComponent(remoteOriginalRef)}`,
        previewUrl,
      ].filter((url): url is string => url !== undefined))]
      const prepare = async () => {
        for (const url of urls) {
          try {
            controller.signal.throwIfAborted()
            const response = await fetch(url, { signal: controller.signal })
            if (!response.ok) throw new Error('图片不可用')
            const blob = await response.blob()
            controller.signal.throwIfAborted()
            const image = await arkmeClipboardImageBlob(blob)
            controller.signal.throwIfAborted()
            return image
          } catch (error) {
            controller.signal.throwIfAborted()
            if (url === urls.at(-1)) throw error
          }
        }
        throw new Error('图片不可用')
      }
      const image = prepare()
      void image.catch(() => {})
      await clipboardWrite([new ClipboardItemConstructor({ 'image/png': image })])
      controller.signal.throwIfAborted()
      onNotice?.({ message: '已复制', kind: 'success' })
    } catch (error) {
      if (!controller.signal.aborted && !(error instanceof DOMException && error.name === 'AbortError')) onNotice?.({ message: '复制失败', kind: 'error' })
    } finally {
      controller.abort()
      if (copyController.current === controller) {
        copyController.current = undefined
        setCopying(false)
      }
    }
  }
  return { copying, copy }
}

function useArkmeNativeFileOpen(
  block: ArkmeContentBlock,
  original: ReturnType<typeof useArkmeOriginal>,
  onOpened: () => void,
) {
  const [pendingOpenIdentity, setPendingOpenIdentity] = useState<string>()
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState('')
  const openController = useRef<AbortController>()
  const identity = block.fileAssetUid ?? block.localFileRef ?? block.originalRef ?? block.mediaRef
  useEffect(() => {
    setPendingOpenIdentity(undefined); setOpening(false); setError('')
    return () => openController.current?.abort()
  }, [identity])
  const openLocal = async (fileRef: string, target: 'file' | 'folder' = 'file') => {
    if (openController.current !== undefined && !openController.current.signal.aborted) return
    const controller = new AbortController(); openController.current = controller
    setOpening(true); setError('')
    try {
      if (target === 'folder') await sdk.openLocalFileFolder(fileRef, controller.signal)
      else await sdk.openLocalFile(fileRef, controller.signal)
      if (!controller.signal.aborted && target === 'file') onOpened()
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : target === 'folder' ? '文件夹打开失败，请重试' : '文件打开失败，请重试')
    } finally {
      if (openController.current === controller) {
        openController.current = undefined
        if (!controller.signal.aborted) setOpening(false)
      }
    }
  }
  useEffect(() => {
    if (pendingOpenIdentity !== identity || original.localRef === undefined) return
    setPendingOpenIdentity(undefined)
    void openLocal(original.localRef)
  }, [pendingOpenIdentity, identity, original.localRef])
  useEffect(() => {
    if (pendingOpenIdentity !== identity || original.reception.state !== 'failed') return
    setPendingOpenIdentity(undefined)
    setError(original.reception.error ?? '文件接收失败，请重试')
  }, [pendingOpenIdentity, identity, original.reception.state, original.reception.error])
  const open = () => {
    setError('')
    if (original.localRef !== undefined) { void openLocal(original.localRef); return }
    if (block.originalRef === undefined) { setError('原文件不可用'); return }
    setPendingOpenIdentity(identity)
    original.receive()
  }
  return { opening, error, open, openFolder: () => { if (original.localRef !== undefined) void openLocal(original.localRef, 'folder') } }
}

function FileDownloadAction({ block, original, download, showStatus = true, hideAfterSave = true }: {
  block: ArkmeContentBlock; original: ReturnType<typeof useArkmeOriginal>; download: ReturnType<typeof useArkmeFileDownload>; showStatus?: boolean; hideAfterSave?: boolean
}) {
  const { reception, localRef } = original
  const { notice, saving, saved, save } = download
  const noun = fileActionNoun(block)
  const unavailable = localRef === undefined && block.originalRef === undefined
  const disabled = saving || unavailable
  return <>
    {(!saved || !hideAfterSave) && <button type="button" aria-label={tr("下载{v0}", { v0: noun })} title={tr("下载{v0}", { v0: noun })} disabled={disabled} onClick={() => { void save() }}
      style={fileActionStateStyle(unavailable, saving)}>
      <ImageDownloadIcon />
    </button>}
    {showStatus && saving && <span role="status">{reception.state === 'receiving' ? tr("正在接收{v0}", { v0: noun }) : '正在下载...'}</span>}
    {showStatus && reception.error && <span role="alert">{reception.error}</span>}
    {showStatus && notice && <span role="status">{notice}</span>}
  </>
}

function ImageCopyIcon() {
  return <svg width="30" height="30" viewBox="0 0 30 30" fill="none" aria-hidden>
    <path d="M17.001 7.73273C17.6906 7.73273 18.3519 8.00665 18.8395 8.49425C19.3271 8.98184 19.601 9.64316 19.601 10.3327V10.3994H19.6677C20.343 10.3994 20.9917 10.6621 21.4767 11.1319C21.9617 11.6017 22.2449 12.2418 22.2664 12.9167L22.2677 12.9994V19.6661C22.2677 20.3413 22.005 20.9901 21.5352 21.4751C21.0654 21.9601 20.4253 22.2433 19.7504 22.2647L19.6677 22.2661H13.001C12.3258 22.2661 11.677 22.0033 11.192 21.5335C10.707 21.0637 10.4238 20.4236 10.4024 19.7487L10.401 19.6661V19.5994H10.3344C9.65913 19.5994 9.01037 19.3367 8.52537 18.8669C8.04037 18.397 7.75718 17.757 7.73571 17.0821L7.73438 16.9994V10.3327C7.73438 9.64316 8.0083 8.98184 8.4959 8.49425C8.98349 8.00665 9.64481 7.73273 10.3344 7.73273H17.001ZM19.601 16.9994C19.601 17.689 19.3271 18.3503 18.8395 18.8379C18.3519 19.3255 17.6906 19.5994 17.001 19.5994H11.601V19.6661C11.601 20.0253 11.7391 20.3707 11.9866 20.631C12.2342 20.8913 12.5723 21.0464 12.931 21.0644L13.001 21.0661H19.6677C20.0269 21.0661 20.3724 20.928 20.6326 20.6805C20.8929 20.4329 21.0481 20.0948 21.066 19.7361L21.0677 19.6661V12.9994C21.0677 12.6402 20.9297 12.2947 20.6821 12.0345C20.4346 11.7742 20.0965 11.619 19.7377 11.6011L19.6677 11.5994H19.601V16.9994ZM17.001 8.93273H10.3344C9.96307 8.93273 9.60698 9.08023 9.34443 9.34278C9.08187 9.60533 8.93437 9.96142 8.93437 10.3327V16.9994C8.93437 17.1832 8.97059 17.3653 9.04094 17.5352C9.1113 17.705 9.21442 17.8593 9.34443 17.9893C9.47443 18.1193 9.62876 18.2225 9.79862 18.2928C9.96847 18.3632 10.1505 18.3994 10.3344 18.3994H17.001C17.1849 18.3994 17.3669 18.3632 17.5368 18.2928C17.7067 18.2225 17.861 18.1193 17.991 17.9893C18.121 17.8593 18.2241 17.705 18.2945 17.5352C18.3648 17.3653 18.401 17.1832 18.401 16.9994V10.3327C18.401 10.1489 18.3648 9.96683 18.2945 9.79697C18.2241 9.62711 18.121 9.47278 17.991 9.34278C17.861 9.21277 17.7067 9.10965 17.5368 9.0393C17.3669 8.96894 17.1849 8.93273 17.001 8.93273Z" fill="currentColor" />
    <rect width="30" height="30" rx="15" fill="currentColor" fillOpacity=".04" />
  </svg>
}

function ImageDownloadIcon() {
  return <svg width="30" height="30" viewBox="0 0 31 30" fill="none" aria-hidden>
    <path d="M8.90625 17V19C8.90625 20.1046 9.80168 21 10.9063 21H20.9063C22.0108 21 22.9062 20.1046 22.9062 19V17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M15.9102 8V17.5M15.9102 17.5L12.9102 14.5M15.9102 17.5L18.9102 14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

function ImageNavigationIcon({ direction }: { direction: 'left' | 'right' }) {
  return <svg width="10" height="10" viewBox="0 0 11 18" fill="none" aria-hidden>
    {direction === 'left'
      ? <path d="M9.35714 1.14258L1.5 8.99972L9.35714 16.8569" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      : <path d="M1.64286 1.14258L9.5 8.99972L1.64286 16.8569" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
  </svg>
}

function ImageCopyAction({ block, sources, onNotice }: { block: ArkmeContentBlock; sources: ImageCopySources; onNotice?: ArkmeFileActionNoticeHandler | undefined }) {
  useArkmeLocale()
  const { copying, copy } = useArkmeImageCopy(block, sources, onNotice)
  if (block.kind !== 'image') return null
  const unavailable = sources.localOriginalRef === undefined && sources.remoteOriginalRef === undefined && sources.previewUrl === undefined
  return (
    <button type="button" aria-label={tr("复制图片")} title={tr("复制图片")} disabled={copying || unavailable} onClick={() => { void copy() }}
      style={fileActionStateStyle(unavailable, copying)}>
      <ImageCopyIcon />
    </button>
  )
}

export function ArkmeFileActionNavButton({ label, direction, disabled, onClick }: { label: string; direction: 'left' | 'right'; disabled: boolean; onClick: () => void }) {
  return <button type="button" aria-label={label} disabled={disabled} onClick={onClick}
    style={fileActionStateStyle(disabled)}>
    <ImageNavigationIcon direction={direction} />
  </button>
}

export function ArkmeFileActions({ block, original, copySourceUrl, onImageCopyNotice, showDownloadStatus = true, hideDownloadAfterSave = true, style }: { block: ArkmeContentBlock; original: ReturnType<typeof useArkmeOriginal>; copySourceUrl?: string | undefined; onImageCopyNotice?: ArkmeFileActionNoticeHandler | undefined; showDownloadStatus?: boolean; hideDownloadAfterSave?: boolean; style?: CSSProperties | undefined }) {
  useArkmeLocale()
  const download = useArkmeFileDownload(block, original)
  const sources: ImageCopySources = {
    localOriginalRef: original.localRef ?? block.localFileRef,
    remoteOriginalRef: block.originalRef,
    previewUrl: copySourceUrl ?? (block.mediaRef === '' || block.mediaRef === block.localFileRef ? undefined : `/arkme-self/api/media?ref=${encodeURIComponent(block.mediaRef)}`),
  }
  return <div style={{ ...fileActionGroupStyle, ...style }}>
    <ImageCopyAction block={block} sources={sources} onNotice={onImageCopyNotice} />
    <FileDownloadAction block={block} original={original} download={download} showStatus={showDownloadStatus} hideAfterSave={hideDownloadAfterSave} />
  </div>
}

export interface ArkmePreviewNavigation { previous?: () => void; next?: () => void }

export function ArkmeFileViewer({ block, onClose, blocks = [block], onSelect, openLocalFile = false, forceDownload = false, navigation }: {
  navigation?: ArkmePreviewNavigation | undefined
  block: ArkmeContentBlock; onClose: () => void; blocks?: ArkmeContentBlock[]; onSelect?: (block: ArkmeContentBlock) => void; openLocalFile?: boolean; forceDownload?: boolean
}) {
  useArkmeLocale()
  const original = useArkmeOriginal(block, block.kind === 'image')
  const download = useArkmeFileDownload(block, original)
  const nativeOpen = useArkmeNativeFileOpen(block, original, onClose)
  const { notice: actionNotice, showNotice: showActionNotice, clearNotice: clearActionNotice } = useArkmeFileActionNotice()
  const panel = useRef<HTMLDivElement>(null)
  const [text, setText] = useState<string>()
  const [error, setError] = useState('')
  const [openRequested, setOpenRequested] = useState(openLocalFile ? 1 : 0)
  const fileIdentity = block.fileAssetUid ?? block.localFileRef ?? block.originalRef ?? block.mediaRef
  const url = original.localRef === undefined ? undefined : arkmeLocalFileUrl(original.localRef)
  const textFile = canPreviewTextFile(block)
  const visualKind = arkmeBrowserVisualKind(block.mimeType, block.fileName)
  const browserPreview = !forceDownload && arkmeCanPreviewFile(block)
  const receptionNoun = forceDownload && (block.kind === 'image' || block.kind === 'video')
    ? block.kind === 'image' ? '图片' : '视频'
    : '文件'
  const showContent = url !== undefined && browserPreview && (openRequested > 0 || block.kind === 'image' || block.kind === 'video')
  const systemFile = !browserPreview
  const filePanel = block.kind === 'file'
  const receiving = original.reception.state === 'receiving' && original.localRef === undefined
  const openBusy = receiving || (systemFile && nativeOpen.opening)
  const unavailable = original.localRef === undefined && block.originalRef === undefined
  const index = Math.max(0, blocks.findIndex(value => value.mediaRef === block.mediaRef))
  const previousDisabled = navigation === undefined ? onSelect === undefined || index <= 0 : navigation.previous === undefined
  const nextDisabled = navigation === undefined ? onSelect === undefined || index >= blocks.length - 1 : navigation.next === undefined
  useEffect(() => { setOpenRequested(openLocalFile ? 1 : 0); setError('') }, [fileIdentity, openLocalFile])
  useEffect(() => { clearActionNotice() }, [block.mediaRef, clearActionNotice])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    panel.current?.focus()
    return () => { previous?.focus() }
  }, [])
  useEffect(() => {
    setText(undefined); setError('')
    if (url === undefined || !textFile || !showContent) return
    const controller = new AbortController()
    void fetch(url, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('文件预览失败')
      const value = await response.text()
      if (!controller.signal.aborted) setText(value)
    }).catch(() => { if (!controller.signal.aborted) setError('文件预览失败，请重试或另存为后打开') })
    return () => controller.abort()
  }, [url, textFile, showContent, openRequested])
  const preview = () => {
    setOpenRequested(value => browserPreview ? value + 1 : 0); setError('')
    if (original.localRef === undefined) original.receive()
  }
  const contentMaxHeight = filePanel ? 'calc(65vh - 56px)' : '65vh'
  const mediaStyle = { width: '100%', maxHeight: contentMaxHeight, objectFit: 'contain' as const }
  return createPortal(<div style={{ position: 'fixed', inset: 0, zIndex: 11000, background: 'rgba(0,0,0,.72)', display: 'grid', placeItems: 'center', padding: 24 }} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={tr("文件预览 {v0}", { v0: block.fileName })} style={{ position: 'relative', width: showContent ? 'min(860px, 90vw)' : 'min(420px, 90vw)', maxHeight: '80vh', borderRadius: 16, padding: showContent ? '56px 20px 20px' : '48px 40px 32px', color: arkmeTheme.text, background: arkmeTheme.menu }} onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose() }
      if (event.key === 'Tab') {
        const focusable = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],video[controls],audio[controls]')
        const first = focusable?.[0]; const last = focusable?.[focusable.length - 1]
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }}>
      <button type="button" aria-label={tr("关闭文件预览")} onClick={onClose} style={{ position: 'absolute', right: 12, top: 12, width: 32, height: 32, padding: 0, display: 'grid', placeItems: 'center', border: 0, borderRadius: 8, background: 'transparent', color: 'var(--dsw-alias-label-secondary, #646b76)', cursor: 'pointer' }}><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
      {!showContent ? <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 16 }}>
        <ArkmeFileIcon fileName={block.fileName} mimeType={block.mimeType} size={64} />
        <div style={{ fontSize: 16, overflowWrap: 'anywhere' }}>{block.fileName}</div>
        <div style={{ fontSize: 14, color: 'var(--dsw-alias-label-tertiary, #9097a1)' }}>{tr("文件大小：")}{arkmeFileSize(block.size)}</div>
        {original.reception.state === 'receiving' && original.localRef === undefined
          ? <FileReceptionProgress reception={original.reception} fileName={block.fileName} noun={receptionNoun} />
          : !filePanel && <button type="button" onClick={systemFile ? nativeOpen.open : preview} disabled={nativeOpen.opening || (original.localRef === undefined && block.originalRef === undefined)} style={{ ...primaryActionStyle, cursor: nativeOpen.opening ? 'progress' : 'pointer' }}>
            {systemFile
              ? nativeOpen.opening ? tr("正在打开…") : original.localRef === undefined ? '接收文件' : tr("打开")
              : original.localRef === undefined ? tr("接收{v0}", { v0: receptionNoun }) : tr("预览")}
          </button>}
        {original.reception.error && <p role="alert">{original.reception.error}</p>}
        {nativeOpen.error && <p role="alert">{nativeOpen.error}</p>}
      </div>
        : visualKind === 'image' ? <img src={url} alt={block.fileName} style={mediaStyle} />
          : visualKind === 'video' ? <video src={url} controls style={mediaStyle} />
            : block.mimeType.trim().toLowerCase().startsWith('audio/') && arkmeCanInlineLocalFile(block.mimeType, block.fileName) ? <audio src={url} controls />
              : textFile ? <div style={{ maxHeight: contentMaxHeight, overflow: 'auto', overflowWrap: 'anywhere' }}>{text === undefined ? !error && <p role="status">{tr("正在加载文件...")}</p> : /\.(md|markdown)$/i.test(block.fileName) ? <MarkdownText text={text} {...markdownLabelProps} /> : <pre style={{ whiteSpace: 'pre-wrap' }}>{text}</pre>}</div>
                : null}
      {filePanel && <div style={{ marginTop: 16 }}>
        <div role="group" aria-label={tr("文件操作")} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {!showContent && <button type="button" aria-label={tr("打开文件")} disabled={openBusy || unavailable} onClick={systemFile ? nativeOpen.open : preview}
            style={{ ...filePanelActionStyle, opacity: openBusy || unavailable ? .5 : 1, cursor: openBusy ? 'progress' : unavailable ? 'default' : 'pointer' }}>{tr("打开")}</button>}
          <button type="button" aria-label={tr("另存为文件")} disabled={download.saving || unavailable} onClick={() => { void download.save() }}
            style={{ ...filePanelActionStyle, opacity: download.saving || unavailable ? .5 : 1, cursor: download.saving ? 'progress' : unavailable ? 'default' : 'pointer' }}>{tr("另存为")}</button>
          <button type="button" aria-label={tr("打开文件夹")} disabled={nativeOpen.opening || original.localRef === undefined} onClick={nativeOpen.openFolder}
            title={original.localRef === undefined ? '请先打开或另存为文件' : '打开 Arkme 已接收文件所在的文件夹'}
            style={{ ...filePanelActionStyle, opacity: nativeOpen.opening || original.localRef === undefined ? .5 : 1, cursor: nativeOpen.opening ? 'progress' : original.localRef === undefined ? 'default' : 'pointer' }}>{tr("打开文件夹")}</button>
        </div>
        {nativeOpen.opening && <p role="status">{tr("正在打开…")}</p>}
        {showContent && nativeOpen.error && <p role="alert">{nativeOpen.error}</p>}
        {download.saving && <p role="status">{tr("正在保存...")}</p>}
        {download.notice && <p role="status">{download.notice}</p>}
      </div>}
      {error && <div><p role="alert">{error}</p><button type="button" onClick={preview} style={filePanelActionStyle}>{tr("重试预览")}</button></div>}
      <ArkmeFileActionToast notice={actionNotice} style={{ position: 'absolute', left: 74, right: 74, bottom: -8 }} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: -56, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <ArkmeFileActionNavButton label={tr("上一个文件")} direction="left" disabled={previousDisabled} onClick={() => { if (!previousDisabled) { if (navigation) navigation.previous?.(); else onSelect?.(blocks[index - 1]!) } }} />
        <span aria-hidden style={fileActionWideGapStyle} />
        <ArkmeFileActionNavButton label={tr("下一个文件")} direction="right" disabled={nextDisabled} onClick={() => { if (!nextDisabled) { if (navigation) navigation.next?.(); else onSelect?.(blocks[index + 1]!) } }} />
        {!filePanel && <>
          <span aria-hidden style={fileActionWideGapStyle} />
          <ImageCopyAction block={block} sources={{ localOriginalRef: original.localRef ?? block.localFileRef, remoteOriginalRef: block.originalRef, previewUrl: block.mediaRef === '' || block.mediaRef === block.localFileRef ? undefined : `/arkme-self/api/media?ref=${encodeURIComponent(block.mediaRef)}` }} onNotice={showActionNotice} />
          <span aria-hidden style={{ width: 12, flex: 'none' }} />
          <FileDownloadAction block={block} original={original} download={download} />
        </>}
      </div>
    </div>
  </div>, document.body)
}
