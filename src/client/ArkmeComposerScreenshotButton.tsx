import { tr, useArkmeLocale } from './locale.js'
import { useEffect, useRef, useState } from 'react'
import { Scissors } from '@phosphor-icons/react/dist/icons/Scissors'
import type { ArkmeDesktopScreenshotCapability, ArkmeDesktopScreenshotResult } from '../desktop-screenshot-contract.js'
import { callArkme } from './api.js'
import { ArkmeComposerToolButton, ARKME_COMPOSER_TOOL_ICON_SIZE } from './ArkmeComposerToolButton.js'
import { ArkmeScreenshotCropDialog } from './ArkmeScreenshotCropDialog.js'
import { browserScreenshotUnavailable, captureBrowserScreenshot, isArkmeDesktopScreenshotRuntime, screenshotErrorMessage, type ScreenshotFrame } from './browser-screenshot.js'

export function ArkmeComposerScreenshotButton(props: {
  userId: number
  scope: object
  active?: boolean
  disabled: boolean
  isCurrent: () => boolean
  onBegin: (options?: { ownedDialog?: () => HTMLElement | null }) => () => void
  onFile: (file: File) => Promise<void>
  onError: (message: string) => void
}) {
  useArkmeLocale()
  const latest = useRef(props)
  latest.current = props
  const active = useRef<AbortController>()
  const [busy, setBusy] = useState(false)
  const [crop, setCrop] = useState<{ frame: ScreenshotFrame; complete: (blob?: Blob) => void }>()
  const cropRoot = useRef<HTMLDivElement>(null)
  const nativeDesktop = isArkmeDesktopScreenshotRuntime()
  const [capability, setCapability] = useState<ArkmeDesktopScreenshotCapability>()
  useEffect(() => {
    if (!nativeDesktop) return
    const controller = new AbortController()
    setCapability(undefined)
    void callArkme<ArkmeDesktopScreenshotCapability>('desktop.screenshot.capability', undefined, controller.signal)
      .then(value => { if (!controller.signal.aborted) setCapability(value) })
      .catch(() => { if (!controller.signal.aborted) setCapability({ available: false, reason: '暂无法使用截屏，请重新打开对话或使用系统截屏后粘贴' }) })
    return () => controller.abort()
  }, [props.userId, nativeDesktop])
  useEffect(() => {
    if (props.active === false) active.current?.abort()
    return () => active.current?.abort()
  }, [props.scope, props.userId, props.active])
  useEffect(() => {
    if (!busy || nativeDesktop || crop || typeof document === 'undefined') return
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); active.current?.abort() }
    }
    document.addEventListener('keydown', cancel, true)
    return () => document.removeEventListener('keydown', cancel, true)
  }, [busy, crop, nativeDesktop])

  const capture = async () => {
    if (active.current !== undefined || props.active === false || props.disabled || !props.isCurrent()) return
    const unavailable = nativeDesktop ? capability?.available === true ? undefined : capability?.reason ?? '正在检查截屏能力，请稍后重试。' : browserScreenshotUnavailable()
    if (unavailable) { props.onError(unavailable); return }
    const captured = props
    const controller = new AbortController()
    active.current = controller
    setBusy(true)
    const current = () => !controller.signal.aborted && latest.current.scope === captured.scope
      && latest.current.active !== false && latest.current.userId === captured.userId && captured.isCurrent()
    let restoreFocus = () => {}
    const timeout = setTimeout(() => {
      if (current()) captured.onError('截屏等待超时，请重新点击截屏。')
      controller.abort()
    }, 120_000)
    try {
      restoreFocus = captured.onBegin({ ownedDialog: () => cropRoot.current })
      if (nativeDesktop) {
        const result = await callArkme<ArkmeDesktopScreenshotResult>('desktop.screenshot.capture', { expectedUserId: captured.userId }, controller.signal)
        if (!current()) return
        if (result.status === 'captured') {
          const bytes = Uint8Array.from(atob(result.contentBase64), character => character.charCodeAt(0))
          await captured.onFile(new File([bytes], result.fileName, { type: result.mimeType }))
        }
      } else {
        const frame = await captureBrowserScreenshot(controller.signal)
        if (!current()) return
        clearTimeout(timeout) // Editing a stopped still image need not be rushed.
        const blob = await new Promise<Blob | undefined>(resolve => {
          const cancel = () => complete()
          const complete = (value?: Blob) => {
            controller.signal.removeEventListener('abort', cancel)
            resolve(value)
          }
          controller.signal.addEventListener('abort', cancel, { once: true })
          setCrop({ frame, complete })
          if (controller.signal.aborted) cancel()
        })
        setCrop(undefined)
        if (blob && current()) await captured.onFile(new File([blob], `截图-${Date.now()}.png`, { type: 'image/png' }))
      }
    } catch (error) {
      if (current() && !(error instanceof Error && error.name === 'AbortError')) captured.onError(screenshotErrorMessage(error))
    } finally {
      clearTimeout(timeout)
      setCrop(undefined)
      // The one-shot caret guard also checks later navigation and focus intent.
      restoreFocus()
      if (active.current === controller) { active.current = undefined; setBusy(false) }
    }
  }
  const title = busy ? '正在截屏，按 Esc 取消' : !nativeDesktop ? browserScreenshotUnavailable() ?? '截屏（选择屏幕或窗口后裁剪）'
    : capability?.available === true ? '截屏（框选后添加到草稿，Esc 取消）' : capability?.reason ?? '正在检查截屏能力'
  return <><ArkmeComposerToolButton aria-label={tr("截屏")} title={title} aria-busy={busy}
    disabled={props.active === false || props.disabled || busy || (nativeDesktop && capability === undefined)}
    onMouseDown={event => { event.preventDefault() }}
    onClick={() => { void capture() }}>
    <Scissors size={ARKME_COMPOSER_TOOL_ICON_SIZE} aria-hidden="true" />
  </ArkmeComposerToolButton>
    {crop && <ArkmeScreenshotCropDialog frame={crop.frame} rootRef={cropRoot} onClose={() => crop.complete()} onComplete={crop.complete} />}
  </>
}
