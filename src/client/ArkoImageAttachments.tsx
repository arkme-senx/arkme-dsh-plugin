import { useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { ArkmeContentBlock } from '../types.js'
import { prepareComposerAttachments } from './attachment-preparation.js'
import { arkmeAttachmentsPending, arkmeAttachmentId, arkmeComposerDraftStore, type ArkmeComposerAttachment } from './composer-draft-store.js'
import { ArkmeAttachmentStrip } from './ArkmeAttachmentStrip.js'
import { ArkmeMediaPreview, arkmeContentMediaUrl } from './ArkmeRichContent.js'
import { localFileBlock } from './file-send-tasks.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr } from './locale.js'

export function useArkoImageDraft(userId: number | undefined, draftKey: string | undefined, onError: (message: string) => void) {
  const draft = useSyncExternalStore(arkmeComposerDraftStore.subscribe,
    () => arkmeComposerDraftStore.get(draftKey), () => arkmeComposerDraftStore.get(undefined))
  return {
    preparing: arkmeAttachmentsPending(draft.attachments) ? tr('正在准备图片…') : '',
    add: (files: readonly File[]) => {
      if (userId === undefined || draftKey === undefined) return
      onError('')
      try { prepareComposerAttachments(draftKey, userId, files, true) }
      catch (error) { onError(error instanceof Error ? error.message : tr('图片准备失败，请重试')) }
    },
  }
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
