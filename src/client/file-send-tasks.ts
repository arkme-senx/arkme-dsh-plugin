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

const FILE_TASK_POLL_INTERVAL_MS = 750
const FILE_TASK_INITIAL_RETRY_LIMIT = 3

export function arkmeFileSendTasksNeedPolling(tasks: readonly ArkmeFileSendTask[]): boolean {
  return tasks.some(task => task.state === 'queued' || task.state === 'uploading'
    || task.state === 'sending')
}

export function arkmeFileSendTasksEqual(
  left: readonly ArkmeFileSendTask[],
  right: readonly ArkmeFileSendTask[],
): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right)
}

export function useArkmeFileSendTasks(
  sourceRef: string | undefined,
  userId: number | undefined,
  enabled = true,
) {
  const [snapshot, setSnapshot] = useState<{ sourceRef: string; userId: number; tasks: ArkmeFileSendTask[] }>()
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!enabled || sourceRef === undefined || userId === undefined) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | undefined
    let pending = false
    let failures = 0
    let knownTasks = snapshot?.sourceRef === sourceRef && snapshot.userId === userId ? snapshot.tasks : []
    const browserDocument = typeof document === 'undefined' ? undefined : document
    const foreground = () => browserDocument?.visibilityState !== 'hidden'
    const clearTimer = () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    }
    const schedule = (delay = FILE_TASK_POLL_INTERVAL_MS) => {
      clearTimer()
      if (!active || !foreground()) return
      timer = setTimeout(() => { timer = undefined; void poll() }, delay)
    }
    const poll = async () => {
      if (!active || pending || !foreground()) return
      pending = true
      const request = new AbortController()
      controller = request
      try {
        const tasks = await callArkme<ArkmeFileSendTask[]>('files.send.tasks', { sourceRef }, request.signal)
        if (!active || request.signal.aborted) return
        failures = 0
        const changed = !arkmeFileSendTasksEqual(knownTasks, tasks)
        knownTasks = tasks
        if (changed) setSnapshot({ sourceRef, userId, tasks })
      } catch {
        if (!request.signal.aborted) failures += 1
      } finally {
        if (controller === request) controller = undefined
        pending = false
        if (!active) return
        if (arkmeFileSendTasksNeedPolling(knownTasks)) schedule()
        else if (failures > 0 && failures <= FILE_TASK_INITIAL_RETRY_LIMIT) schedule(FILE_TASK_POLL_INTERVAL_MS * failures)
      }
    }
    const onVisibilityChange = () => {
      if (foreground()) void poll()
      else { clearTimer(); controller?.abort() }
    }
    void poll()
    browserDocument?.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      active = false
      clearTimer()
      controller?.abort()
      browserDocument?.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [enabled, sourceRef, userId, revision])
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
