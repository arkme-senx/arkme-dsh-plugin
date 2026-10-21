import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { createArkmeSdk } from '../sdk/index.js'
import type { ArkmeContentBlock } from '../types.js'
import { ARKO_IMAGE_DRAFT_LIMIT, ARKO_IMAGE_DRAFT_MAX_BYTES, ARKO_IMAGE_MIME_TYPES } from '../arko-image-contract.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeAttachmentId, arkmeComposerDraftStore, type ArkmeComposerAttachment } from './composer-draft-store.js'
import { ArkmeAttachmentStrip } from './ArkmeAttachmentStrip.js'
import { ArkmeMediaPreview, arkmeContentMediaUrl } from './ArkmeRichContent.js'
import { localFileBlock } from './file-send-tasks.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr } from './locale.js'

const sdk = createArkmeSdk()

export function useArkoImageDraft(userId: number | undefined, draftKey: string | undefined, onError: (message: string) => void) {
  const [preparing, setPreparing] = useState('')
  const scope = useRef<AbortController>()
  const queue = useRef<Promise<void>>(Promise.resolve())
  useEffect(() => {
    const controller = new AbortController()
    scope.current = controller
    queue.current = Promise.resolve()
    setPreparing('')
    return () => controller.abort()
  }, [userId, draftKey])
  const add = (incoming: readonly File[]) => {
    const controller = scope.current
    if (userId === undefined || draftKey === undefined || controller === undefined || controller.signal.aborted || incoming.length === 0) return
    const stillCurrent = () => {
      const auth = arkmeAuthStore.getSnapshot().auth
      return !controller.signal.aborted && auth?.status === 'authenticated' && auth.userId === userId
    }
    setPreparing(tr('正在准备图片…'))
    queue.current = queue.current.catch(() => {}).then(async () => {
      if (!stillCurrent()) return
      onError('')
      try {
        const policy = await sdk.fileCapabilities(controller.signal)
        const maxImages = Math.min(ARKO_IMAGE_DRAFT_LIMIT, policy.maxAttachments)
        const maxBytes = Math.min(ARKO_IMAGE_DRAFT_MAX_BYTES, policy.maxImageBytes)
        const failures: string[] = []
        for (const file of incoming) {
          if (!stillCurrent()) return
          if (arkmeComposerDraftStore.get(draftKey).attachments.length >= maxImages) {
            failures.push(tr('每次最多添加 {v0} 张图片，未加入的图片请分次发送', { v0: maxImages })); break
          }
          if (!ARKO_IMAGE_MIME_TYPES.some(mime => mime === file.type)) {
            failures.push(`${file.name}：${tr('支持 JPG、PNG、GIF、WebP 图片')}`); continue
          }
          if (file.size <= 0 || file.size > maxBytes) {
            failures.push(`${file.name}：${tr('图片大小须在 {v0} MB 以内', { v0: Math.floor(maxBytes / 1024 / 1024) })}`); continue
          }
          setPreparing(tr('正在准备：{v0}', { v0: file.name || '图片' }))
          try {
            const localFile = await sdk.stageFile(file, { expectedUserId: userId, signal: controller.signal })
            if (!stillCurrent()) return
            arkmeComposerDraftStore.appendAttachments(draftKey, [{ localFile }], maxImages)
          } catch (error) {
            if (!stillCurrent()) return
            failures.push(`${file.name}：${error instanceof Error ? error.message : tr('图片准备失败，请重试')}`)
          }
        }
        if (stillCurrent() && failures.length) onError(failures.join('；'))
      } catch (error) {
        if (stillCurrent()) onError(error instanceof Error ? error.message : tr('图片准备失败，请重试'))
      } finally {
        if (stillCurrent()) setPreparing('')
      }
    })
  }
  return { preparing, add }
}

export function ArkoImageDraftStrip({ attachments, draftKey, disabled }: {
  attachments: readonly ArkmeComposerAttachment[]; draftKey: string | undefined; disabled: boolean
}) {
  const [preview, setPreview] = useState<ArkmeContentBlock>()
  const blocks = attachments.flatMap((attachment, index) => attachment.localFile ? [localFileBlock(attachment.localFile, index)] : [])
  return <>
    <ArkmeAttachmentStrip attachments={attachments} disabled={disabled}
      onMove={(from, to) => arkmeComposerDraftStore.moveAttachment(draftKey, from, to)}
      onRemove={attachment => arkmeComposerDraftStore.removeAttachment(draftKey, arkmeAttachmentId(attachment))}
      canPreview={attachment => attachment.localFile !== undefined}
      onPreview={attachment => { if (attachment.localFile) setPreview(localFileBlock(attachment.localFile)) }} />
    {preview && createPortal(<ArkmeMediaPreview selected={preview} blocks={blocks} onSelect={setPreview}
      onClose={() => setPreview(undefined)} openLocalFile={false} />, document.body)}
  </>
}

function ArkoMessageImage({ block, single, onOpen }: { block: ArkmeContentBlock; single: boolean; onOpen(): void }) {
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  if (failed) return <button type="button" onClick={event => {
    event.stopPropagation()
    setAttempt(value => value + 1)
    setFailed(false)
  }}>{block.fileName} · {tr('加载失败，点击重试')}</button>
  return <button type="button" aria-label={tr('预览图片：{v0}', { v0: block.fileName })}
    onClick={event => { event.stopPropagation(); onOpen() }} style={{ padding: 0, border: 0, background: 'transparent', cursor: 'pointer', maxWidth: '100%' }}>
    <img src={`${arkmeContentMediaUrl(block)}&retry=${attempt}`} alt={block.fileName} loading="lazy" onError={() => { setFailed(true) }}
      style={{ display: 'block', borderRadius: 8, maxWidth: '100%', width: single ? 280 : 132, maxHeight: 260, objectFit: 'contain' }} />
  </button>
}

export function ArkoMessageImages({ blocks = [] }: { blocks?: readonly ArkmeContentBlock[] }) {
  const [preview, setPreview] = useState<ArkmeContentBlock>()
  if (!blocks.length) return null
  return <div aria-label={tr('消息图片')} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
    {blocks.map((block, index) => block.mediaRef === ''
      ? <span key={`${index}:${block.fileAssetUid}`} style={{ padding: 12, color: arkmeTheme.secondary }}>{tr('图片暂不可用')} · {block.fileName}</span>
      : <ArkoMessageImage key={`${index}:${block.mediaRef}`} block={block} single={blocks.length === 1} onOpen={() => { setPreview(block) }} />)}
    {preview && createPortal(<ArkmeMediaPreview selected={preview} blocks={[...blocks].filter(block => block.mediaRef !== '')}
      onSelect={setPreview} onClose={() => setPreview(undefined)} openLocalFile={false} />, document.body)}
  </div>
}
