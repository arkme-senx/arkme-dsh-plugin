import { useEffect, useRef, useState } from 'react'
import type { ArkmeMessageCopyLinkResult, ArkmeRecordingWorkbenchItem } from '../../types.js'
import { callArkme } from '../api.js'
import { copyText } from '../clipboard-text.js'
import type { MessageSelectionAction } from '../ArkmeMessageSelectionBar.js'
import { ArkmeSelectActionIcon } from '../message-selection-presentation.js'

export function useRecordingTranscriptCopyLinkAction({ items, scope, onNotice }: {
  items: readonly ArkmeRecordingWorkbenchItem[]; scope: string; onNotice(text: string): void
}): MessageSelectionAction {
  const key = JSON.stringify([scope, ...items.map(item => item.itemId).sort()])
  const current = useRef(key); current.current = key
  const request = useRef<AbortController>()
  const receipt = useRef<{ key: string; value: ArkmeMessageCopyLinkResult }>()
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const valid = items.length > 0 && items.length <= 150 && items.every(item => item.itemRef && item.sessionKey === items[0]!.sessionKey && item.transcriptSource === items[0]!.transcriptSource)
  useEffect(() => {
    setBusy(false); setCopied(false); receipt.current = undefined
    return () => { request.current?.abort(); request.current = undefined }
  }, [key])
  const copy = async () => {
    if (!valid || request.current) return
    const controller = new AbortController(); request.current = controller
    const timeout = setTimeout(() => controller.abort(), 30_000)
    const isCurrent = () => !controller.signal.aborted && current.current === key
    setBusy(true); setCopied(false); onNotice('')
    try {
      const result = receipt.current?.key === key ? receipt.current.value : await callArkme<ArkmeMessageCopyLinkResult>('recordings.copy-link', { itemRefs: items.map(item => item.itemRef) }, controller.signal)
      if (!isCurrent()) return
      if (!result?.sid || !/^https?:\/\//i.test(result.url)) throw new Error('链接结果未确认，请重试')
      // Clipboard failures retry this receipt without creating another share.
      receipt.current = { key, value: result }
      await copyText(result.url)
      if (isCurrent()) { setCopied(true); onNotice('链接已复制') }
    } catch (error) {
      if (current.current === key && request.current === controller) onNotice(controller.signal.aborted
        ? '生成链接超时，请重试核对；已选片段已保留'
        : receipt.current?.key === key ? '链接已生成，剪贴板写入失败，请再次点击复制链接'
          : error instanceof Error ? error.message : '复制链接失败，请重试')
    } finally {
      clearTimeout(timeout)
      if (request.current === controller) { request.current = undefined; setBusy(false) }
    }
  }
  return {
    id: 'link', label: busy ? '正在生成…' : copied ? '已复制链接' : '复制链接',
    icon: <ArkmeSelectActionIcon kind="link" />, disabled: !valid || busy,
    reason: !valid ? '请选择同一次录音、同一转写来源的 1–150 个片段' : '复制所选录音片段的分享链接',
    onSelect: () => { void copy() },
  }
}
