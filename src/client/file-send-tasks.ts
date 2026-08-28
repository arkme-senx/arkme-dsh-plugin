import { useEffect, useState } from 'react'
import type { ArkmeFileSendTask, ArkmeLocalFile } from '../file-transfer-contract.js'
import type { ArkmeContentBlock, ArkmeTimelineItem } from '../types.js'
import { callArkme } from './api.js'

export function localFileBlock(file: ArkmeLocalFile, sortOrder = 0): ArkmeContentBlock {
  return { kind: file.fileKind === 1 ? 'image' : file.fileKind === 3 ? 'video' : 'file', mediaRef: file.fileRef, localFileRef: file.fileRef, fileName: file.fileName, mimeType: file.mimeType, size: file.size, sortOrder }
}
export function fileTaskTimelineItem(task: ArkmeFileSendTask): ArkmeTimelineItem {
  return {
    itemUid: task.result?.itemUid ?? task.recordUid, title: task.content.title ?? '', textContent: task.content.textContent ?? '',
    sendAtMillis: task.createdAtMillis, senderName: '我', isMe: true, status: task.result?.status ?? 0, displayKind: 0,
    contentBlocks: task.files.map((file, index) => ({ ...localFileBlock(file, index),
      ...(['queued', 'uploading', 'sending'].includes(task.state) ? { uploadProgress: file.progress } : {}),
    })),
  }
}
export function fileTaskConversationPreview(task: ArkmeFileSendTask): string {
  const text = task.content.textContent?.trim() ?? ''
  if (text !== '') return text
  const fileKind = task.files[0]?.fileKind
  return fileKind === 1 ? '[图片]' : fileKind === 2 ? '[语音]' : fileKind === 3 ? '[视频]' : '[文件]'
}
export function bindSentFileTaskLocals(item: ArkmeTimelineItem, tasks: readonly ArkmeFileSendTask[]): ArkmeTimelineItem {
  if (item.contentBlocks === undefined || item.contentBlocks.length === 0) return item
  const localByAsset = new Map<string, string>()
  for (const task of tasks) {
    if ((task.result?.itemUid ?? task.recordUid) !== item.itemUid) continue
    for (const file of task.files) {
      const fileAssetUid = file.asset?.fileAssetUid.trim()
      if (fileAssetUid !== undefined && fileAssetUid !== '') localByAsset.set(fileAssetUid, file.fileRef)
    }
  }
  if (localByAsset.size === 0) return item
  let changed = false
  const contentBlocks = item.contentBlocks.map(block => {
    if (block.localFileRef !== undefined || block.fileAssetUid === undefined) return block
    const localFileRef = localByAsset.get(block.fileAssetUid)
    if (localFileRef === undefined) return block
    changed = true
    return { ...block, localFileRef }
  })
  return changed ? { ...item, contentBlocks } : item
}
export function useArkmeFileSendTasks(sourceRef: string | undefined, userId: number | undefined) {
  const [snapshot, setSnapshot] = useState<{ sourceRef: string; userId: number; tasks: ArkmeFileSendTask[] }>()
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (sourceRef === undefined || userId === undefined) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()
    const poll = async () => {
      try {
        const tasks = await callArkme<ArkmeFileSendTask[]>('files.send.tasks', { sourceRef }, controller.signal)
        if (active) setSnapshot({ sourceRef, userId, tasks })
      } catch { /* Keep last known task state on transient polling failure; never imply success. */ }
      finally { if (active) timer = setTimeout(() => { void poll() }, 750) }
    }
    void poll()
    return () => { active = false; controller.abort(); if (timer !== undefined) clearTimeout(timer) }
  }, [sourceRef, userId, revision])
  return {
    tasks: snapshot?.sourceRef === sourceRef && snapshot?.userId === userId ? snapshot?.tasks ?? [] : [],
    refresh: () => setRevision(value => value + 1),
    accept: (task: ArkmeFileSendTask) => {
      if (sourceRef === undefined || userId === undefined || task.sourceRef !== sourceRef) return
      setSnapshot(current => ({ sourceRef, userId, tasks: [...(current?.sourceRef === sourceRef && current.userId === userId ? current.tasks.filter(value => value.taskRef !== task.taskRef) : []), task] }))
      setRevision(value => value + 1)
    },
  }
}
