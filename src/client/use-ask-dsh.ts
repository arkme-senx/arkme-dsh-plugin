import { useEffect, useRef, useState } from 'react'
import type { ArkmeContentBlock, ArkmeMessageSnapshotDetail, ArkmeTimelineItem } from '../types.js'
import { createArkmeSdk } from '../sdk/index.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { prepareAskDshNotes } from './ask-dsh-notes.js'
import { abortableDelay, HARNESS_ATTACHMENT_DRAFT_KEY, type HarnessDraftWindow } from './harness-attachment-draft.js'
const sdk = createArkmeSdk()

export async function readAskDshOriginal(block: ArkmeContentBlock, signal: AbortSignal): Promise<Blob> {
  let fileRef = block.localFileRef
  if (!fileRef) {
    if (!block.originalRef) throw new Error('原文件不可用')
    let reception = await sdk.receiveFile(block.originalRef, true, signal)
    while (reception.state !== 'ready') {
      signal.throwIfAborted()
      if (reception.state === 'failed') throw new Error(reception.error || '原文件下载失败')
      await abortableDelay(signal, 300)
      reception = await sdk.receiveFile(block.originalRef, false, signal)
    }
    fileRef = reception.file?.fileRef
  }
  if (!fileRef) throw new Error('原文件下载未完成')
  const response = await fetch(sdk.localFileUrl(fileRef), { signal })
  if (!response.ok) throw new Error('读取原文件失败')
  const blob = await response.blob()
  if (block.size > 0 && blob.size !== block.size) throw new Error('原文件大小不匹配，请重新下载')
  return blob
}

export function useAskDsh(scopeKey: string, onComplete: () => void) {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const running = useRef<AbortController | undefined>(undefined)
  const attempt = useRef<{ key: string; id: string } | undefined>(undefined)
  const complete = useRef(onComplete); complete.current = onComplete
  useEffect(() => {
    setStatus(''); setBusy(false); attempt.current = undefined
    return () => { running.current?.abort(); running.current = undefined }
  }, [scopeKey])
  const run = async (sourceRef: string, items: readonly ArkmeTimelineItem[]) => {
    if (running.current) return
    const auth = arkmeAuthStore.getSnapshot().auth
    if (auth?.status !== 'authenticated' || !auth.userId) { setStatus('请先登录'); return }
    const surface = [...document.querySelectorAll<HTMLElement>('[data-arkme-owned="deepseek-harness-surface"]:not([data-arkme-active="false"])')]
      .find(element => element.getAttribute('data-arkme-account-id') === String(auth.userId))
    const frame = surface?.querySelector('iframe')
    const bridge = (frame?.contentWindow as HarnessDraftWindow | null)?.[HARNESS_ATTACHMENT_DRAFT_KEY]
    if (!bridge) { setStatus('DSH 尚未就绪或当前版本不支持附件草稿，请升级客户端后重试'); return }
    const controller = new AbortController()
    running.current = controller
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)])
    const accountScope = surface?.getAttribute('data-arkme-account-scope')
    const sameAccount = () => {
      const current = arkmeAuthStore.getSnapshot().auth
      return current?.status === auth.status && current?.userId === auth.userId && current?.environment === auth.environment
        && surface?.isConnected && surface.getAttribute('data-arkme-account-scope') === accountScope
    }
    const stopAuth = arkmeAuthStore.subscribe(() => { if (!sameAccount()) controller.abort() })
    const key = JSON.stringify([scopeKey, sourceRef, items.map(item => [item.itemUid, item.messageActionRef, item.recordVersion, item.version])])
    if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() }
    setBusy(true); setStatus('正在准备快记及附件…')
    try {
      const files = await prepareAskDshNotes(items, {
        detail: (item, readSignal) => callArkme<ArkmeMessageSnapshotDetail>('source.message-snapshot.detail', {
          sourceRef, actionRef: item.messageActionRef ?? '', includeAttachments: true,
        }, readSignal),
        original: readAskDshOriginal,
      }, signal, setStatus)
      signal.throwIfAborted()
      if (!sameAccount()) throw new Error('账号已切换，请重试')
      await bridge.prepare({ operationId: attempt.current.id, files, signal, progress: setStatus })
      signal.throwIfAborted()
      if (!sameAccount()) throw new Error('账号已切换，请重试')
      attempt.current = undefined
      setStatus('附件已准备好，请输入问题后发送')
      complete.current()
      // Visibility changes in React before the next frame; focus only the native editor.
      requestAnimationFrame(() => {
        if (!sameAccount()) return
        frame?.contentWindow?.focus()
        frame?.contentDocument?.querySelector<HTMLElement>('[data-composer-card] [contenteditable="true"][role="textbox"], [data-composer-card] textarea:not(:disabled)')?.focus({ preventScroll: true })
      })
    } catch (error) {
      if (!controller.signal.aborted) setStatus(error instanceof Error ? error.message : '附件准备失败，请重试')
    } finally {
      stopAuth()
      if (running.current === controller) { running.current = undefined; setBusy(false) }
    }
  }
  return { busy, status, run }
}
