import type { ArkmeComposerAttachment } from './composer-draft-store.js'
import { useEffect, useState } from 'react'
import type { ArkmeFileSendTask, ArkmeLocalFile } from '../file-transfer-contract.js'
import type { ArkmeContentBlock, ArkmeTimelineItem } from '../types.js'
import { callArkme } from './api.js'
import { retainFileMessageRenderKey } from './conversation-message-merge.js'

export function composerAttachmentBlock(attachment: ArkmeComposerAttachment, sortOrder: number): ArkmeContentBlock | undefined {
  if (attachment.localFile) return localFileBlock(attachment.localFile, sortOrder)
  const asset = attachment.asset
  if (!asset) return undefined
  return { kind: asset.fileKind === 1 ? 'image' : asset.fileKind === 3 ? 'video' : 'file', mediaRef: attachment.resourceMediaRef ?? '', fileAssetUid: asset.fileAssetUid,
    fileName: asset.fileName, mimeType: asset.mimeType, size: asset.size, sortOrder }
}
export function localFileBlock(file: ArkmeLocalFile, sortOrder = 0): ArkmeContentBlock {
  return { kind: file.fileKind === 1 ? 'image' : file.fileKind === 3 ? 'video' : 'file', mediaRef: file.fileRef, localFileRef: file.fileRef, fileName: file.fileName, mimeType: file.mimeType, size: file.size, sortOrder, ...(file.imageDimensions ? { imageDimensions: file.imageDimensions } : {}) }
}
function visibleTaskFiles(task: ArkmeFileSendTask) {
  const backgroundRefs = new Set(task.backgroundSound?.fileRefs ?? [])
  return task.files.filter(file => !backgroundRefs.has(file.fileRef))
}
export function fileTaskHasOnlyBackgroundFiles(task: ArkmeFileSendTask): boolean {
  const backgroundRefs = new Set(task.backgroundSound?.fileRefs ?? [])
  return task.fileRefs.length > 0 && backgroundRefs.size > 0
    && task.fileRefs.every(fileRef => backgroundRefs.has(fileRef))
}
/** Avoid duplicating attachment progress in the message footer. */
export function fileTaskShowsInlineStatus(task: ArkmeFileSendTask, displayedBlocks?: readonly ArkmeContentBlock[]): boolean {
  if (fileTaskHasOnlyBackgroundFiles(task) && ['queued', 'uploading', 'sending'].includes(task.state)) return false
  if (!['queued', 'uploading', 'sending'].includes(task.state) || !displayedBlocks) return true
  return !visibleTaskFiles(task).every(file => file.fileKind === 1)
    || !displayedBlocks.some(block => block.kind === 'image' && (
      (block.uploadProgress !== undefined && task.fileRefs.includes(block.localFileRef ?? ''))
      || (block.attachmentState === 'pending' && block.attachmentUid
        && task.files.some(file => file.attachmentUid === block.attachmentUid))
    ))
}
export function fileTaskTimelineItem(task: ArkmeFileSendTask): ArkmeTimelineItem {
  const visibleFiles = visibleTaskFiles(task)
  const localBlocks = visibleFiles.map((file, index) => ({ key: file.fileRef, block: { ...localFileBlock(file, index),
    ...(file.attachmentUid ? { attachmentUid: file.attachmentUid } : {}),
    ...(['queued', 'uploading', 'sending'].includes(task.state) ? { uploadProgress: file.progress } : {}) } }))
  const assetBlocks = (task.content.assets ?? []).map(asset => ({ key: asset.fileAssetUid, block: {
    kind: asset.fileKind === 1 ? 'image' as const : asset.fileKind === 3 ? 'video' as const : 'file' as const,
    mediaRef: '', fileAssetUid: asset.fileAssetUid, fileName: asset.fileName, mimeType: asset.mimeType, size: asset.size, sortOrder: 0,
  } }))
  const order = new Map((task.attachmentOrder ?? []).map((key, index) => [key, index]))
  const blocks = [...assetBlocks, ...localBlocks].sort((a, b) => (order.get(a.key) ?? Infinity) - (order.get(b.key) ?? Infinity)).map((entry, index) => ({ ...entry.block, sortOrder: index }))
  return {
    itemUid: task.result?.itemUid ?? task.recordUid, title: task.content.title ?? '', textContent: task.content.textContent ?? '', textFormat: task.content.textFormat ?? 'plain',
    sendAtMillis: task.content.sendAtMillis ?? task.createdAtMillis, senderName: '我', isMe: true, status: task.result?.status ?? 0, displayKind: 0,
    ...(task.content.recordDurationMillis === undefined ? {} : { recordDurationMillis: task.content.recordDurationMillis }),
    ...(task.content.captureContext === undefined ? {} : { captureContext: task.content.captureContext }),
    ...(task.result?.sequence === undefined ? {} : { sequence: task.result.sequence }),
    ...(task.result?.messageActionRef === undefined ? {} : { messageActionRef: task.result.messageActionRef }),
    ...(task.result?.recordTopicAssignmentRef === undefined ? {} : { recordTopicAssignmentRef: task.result.recordTopicAssignmentRef }),
    ...(task.result?.localState !== 'synced' || task.result.representation === undefined ? {} : { representation: task.result.representation }),
    contentBlocks: blocks,
  }
}
export function fileTaskConversationPreview(task: ArkmeFileSendTask): string {
  const text = task.content.textContent?.trim() ?? ''
  if (text !== '') return text
  const fileKind = visibleTaskFiles(task)[0]?.fileKind
  if (fileKind === undefined && (task.backgroundSound?.fileRefs.length ?? 0) > 0) return '[文字背景音]'
  return fileKind === 1 ? '[图片]' : fileKind === 2 ? '[语音]' : fileKind === 3 ? '[视频]' : '[文件]'
}
export function bindSentFileTaskLocals(item: ArkmeTimelineItem, tasks: readonly ArkmeFileSendTask[]): ArkmeTimelineItem {
  const matching = tasks.filter(task => task.fileRefs.length > 0 && (task.result?.itemUid ?? task.recordUid) === item.itemUid)
  if (!matching.length) return item
  if (item.isMe && matching.some(task => task.files.some(file => file.fileKind === 1))) item = retainFileMessageRenderKey(item)
  if (item.contentBlocks === undefined || item.contentBlocks.length === 0) return item
  const localByAsset = new Map<string, ArkmeLocalFile>()
  for (const task of matching) {
    for (const file of task.files) {
      const fileAssetUid = file.asset?.fileAssetUid.trim()
      if (fileAssetUid !== undefined && fileAssetUid !== '') localByAsset.set(fileAssetUid, file)
    }
  }
  const task = matching.find(task => task.delivery === 'progressive' || task.delivery === 'negotiating')
  const local = task ? fileTaskTimelineItem(task).contentBlocks ?? [] : []
  let changed = false
  const contentBlocks = item.contentBlocks.map(block => {
    if (block.attachmentState) {
      const replacement = local.find(value => block.attachmentUid && value.attachmentUid === block.attachmentUid)
        ?? local.find(value => block.kind === 'image' && block.attachmentState === 'pending' && value.localFileRef
          && value.attachmentUid === undefined && value.kind === 'image' && value.sortOrder === block.sortOrder
          && value.fileName === block.fileName && value.size === block.size && value.mimeType === block.mimeType)
      if (replacement?.localFileRef) {
        changed = true
        const { attachmentState, ...resource } = block
        const progress = task?.files.find(file => file.fileRef === replacement.localFileRef)?.progress
        return { ...resource, localFileRef: replacement.localFileRef, mediaRef: replacement.mediaRef,
          ...(progress?.phase === 'ready' ? {} : { attachmentState: task?.state === 'failed' ? 'failed' as const : attachmentState }),
          ...(replacement.imageDimensions ? { imageDimensions: replacement.imageDimensions } : {}),
          ...(replacement.uploadProgress ? { uploadProgress: replacement.uploadProgress } : {}) }
      }
    }
    if (block.localFileRef !== undefined || block.fileAssetUid === undefined) return block
    const file = localByAsset.get(block.fileAssetUid)
      // The timeline can confirm the slot before the Host task snapshot carries its asset UID.
      ?? (block.kind === 'image' && block.attachmentUid ? task?.files.find(file =>
        file.attachmentUid === block.attachmentUid && file.fileKind === 1 && !file.asset
        && file.fileName === block.fileName && file.size === block.size && file.mimeType === block.mimeType) : undefined)
    if (file === undefined) return block
    changed = true
    return { ...block, localFileRef: file.fileRef, ...(file.imageDimensions ? { imageDimensions: file.imageDimensions } : {}) }
  })
  return changed ? { ...item, contentBlocks } : item
}

const FILE_TASK_POLL_INTERVAL_MS = 750
const FILE_TASK_INITIAL_RETRY_LIMIT = 3

export function arkmeFileSendTasksNeedPolling(tasks: readonly ArkmeFileSendTask[]): boolean {
  return tasks.some(task => task.state === 'queued' || task.state === 'uploading'
    || task.state === 'sending' || task.nextRetryAtMillis !== undefined)
}

export function arkmeFileSendTasksEqual(
  left: readonly ArkmeFileSendTask[],
  right: readonly ArkmeFileSendTask[],
): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right)
}

// Reuse the fallback until a snapshot exists; consumers memoize by task identity.
const EMPTY_FILE_SEND_TASKS: readonly ArkmeFileSendTask[] = Object.freeze([])
const EMPTY_ACTIVE_TASK_KEYS: ReadonlySet<string> = new Set()

const fileTaskWakeListeners = new Set<(userId: number, taskRef: string) => void>()
export function wakeArkmeFileTask(userId: number, taskRef: string): void {
  for (const listener of fileTaskWakeListeners) listener(userId, taskRef)
}

export function useArkmeDeliveryTasks<T>(
  sourceRef: string | undefined,
  userId: string | number | undefined,
  adapter: { read(scope: string, signal: AbortSignal): Promise<T[]>; poll?(scope: string, known: readonly T[], signal: AbortSignal): Promise<T[] | undefined>; active(tasks: readonly T[]): boolean; belongs(task: T, scope: string): boolean; key(task: T): string; subscribe?(listener: (userId: number, taskRef: string) => void): () => void },
  enabled = true,
) {
  const [snapshot, setSnapshot] = useState<{ sourceRef: string; userId: string | number; tasks: T[]; activeKeys: ReadonlySet<string> }>()
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!enabled || sourceRef === undefined || userId === undefined) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | undefined
    let pending = false
    let failures = 0
    let wakePending = false
    let knownTasks: readonly T[] = snapshot?.sourceRef === sourceRef && snapshot.userId === userId ? snapshot.tasks : []
    const browserDocument = typeof document === 'undefined' ? undefined : document
    const foreground = () => browserDocument?.visibilityState !== 'hidden'
    const clearTimer = () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    }
    const schedule = (delay = FILE_TASK_POLL_INTERVAL_MS) => {
      clearTimer()
      if (!active || !foreground()) return
      timer = setTimeout(() => { timer = undefined; void poll(true) }, delay)
    }
    const poll = async (incremental = false) => {
      if (!active || pending || !foreground()) return
      pending = true
      const request = new AbortController()
      controller = request
      try {
        const useDelta = incremental && adapter.poll !== undefined
        const tasks = useDelta ? await adapter.poll!(sourceRef, knownTasks, request.signal) : await adapter.read(sourceRef, request.signal)
        if (!active || request.signal.aborted) return
        failures = 0
        if (tasks === undefined && useDelta) return
        if (!Array.isArray(tasks)) throw new Error('发送任务响应无效')
        const changed = useDelta || JSON.stringify(knownTasks) !== JSON.stringify(tasks)
        knownTasks = tasks
        if (changed) setSnapshot(current => ({ sourceRef, userId, tasks,
          // Only the current task list owns these keys; account/source changes
          // and task eviction release them. Restored sent receipts are not new sends.
          activeKeys: new Set(tasks.filter(task => adapter.active([task])
            || current?.sourceRef === sourceRef && current.userId === userId && current.activeKeys.has(adapter.key(task)))
            .map(adapter.key)),
        }))
      } catch {
        if (!request.signal.aborted) failures += 1
      } finally {
        if (controller === request) controller = undefined
        pending = false
        if (!active) return
        if (wakePending && foreground()) { wakePending = false; void poll(true) }
        else if (adapter.active(knownTasks)) schedule()
        else if (failures > 0 && failures <= FILE_TASK_INITIAL_RETRY_LIMIT) schedule(FILE_TASK_POLL_INTERVAL_MS * failures)
      }
    }
    const onVisibilityChange = () => {
      if (foreground()) void poll()
      else { clearTimer(); controller?.abort() }
    }
    const unsubscribe = adapter.subscribe?.((actor, taskRef) => {
      if (actor !== userId || !foreground() || !knownTasks.some(task => adapter.key(task) === taskRef)) return
      if (pending) { wakePending = true; return }
      clearTimer()
      void poll(true)
    })
    void poll()
    browserDocument?.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      active = false
      unsubscribe?.()
      clearTimer()
      controller?.abort()
      browserDocument?.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [enabled, sourceRef, userId, revision, adapter])
  return {
    tasks: snapshot?.sourceRef === sourceRef && snapshot?.userId === userId ? snapshot?.tasks ?? (EMPTY_FILE_SEND_TASKS as readonly T[]) : (EMPTY_FILE_SEND_TASKS as readonly T[]),
    activeTaskKeys: snapshot !== undefined && snapshot.sourceRef === sourceRef && snapshot.userId === userId ? snapshot.activeKeys : EMPTY_ACTIVE_TASK_KEYS,
    refresh: () => setRevision(value => value + 1),
    accept: (task: T) => {
      if (sourceRef === undefined || userId === undefined || !adapter.belongs(task, sourceRef)) return
      setSnapshot(current => {
        const sameScope = current?.sourceRef === sourceRef && current.userId === userId
        return { sourceRef, userId,
          tasks: [...(sameScope ? current.tasks.filter(value => adapter.key(value) !== adapter.key(task)) : []), task],
          activeKeys: new Set([...(sameScope ? current.activeKeys : []), adapter.key(task)]),
        }
      })
      setRevision(value => value + 1)
    },
  }
}

const fileTaskAdapter = {
  subscribe(listener: (userId: number, taskRef: string) => void) {
    fileTaskWakeListeners.add(listener)
    return () => { fileTaskWakeListeners.delete(listener) }
  },
  read: (sourceRef: string, signal: AbortSignal) => callArkme<ArkmeFileSendTask[]>('files.send.tasks', { sourceRef }, signal),
  async poll(sourceRef: string, known: readonly ArkmeFileSendTask[], signal: AbortSignal) {
    const open = new Map(known.filter(task => arkmeFileSendTasksNeedPolling([task])).map(task => [task.taskRef, task]))
    const updates = await callArkme<ArkmeFileSendTask[]>('files.send.tasks', {
      sourceRef, watchTaskRefs: [...open.keys()],
    }, signal)
    if (!Array.isArray(updates)) throw new Error('发送任务响应无效')
    const changes = updates.filter(task => open.has(task.taskRef) || arkmeFileSendTasksNeedPolling([task])).map(task => {
      const previous = open.get(task.taskRef)
      return previous && (task.state !== 'sent' || task.fileRefs.length > 0) && Object.keys(task.content).length === 0
        ? { ...task, content: previous.content } : task
    })
    if (arkmeFileSendTasksEqual([...open.values()], changes)) return undefined
    const updated = new Set(changes.map(task => task.taskRef))
    return [...known.filter(task => !open.has(task.taskRef) && !updated.has(task.taskRef)), ...changes]
  },
  active: arkmeFileSendTasksNeedPolling,
  belongs: (task: ArkmeFileSendTask, scope: string) => task.sourceRef === scope,
  key: (task: ArkmeFileSendTask) => task.taskRef,
}
export function useArkmeFileSendTasks(sourceRef: string | undefined, userId: number | undefined, enabled = true) {
  return useArkmeDeliveryTasks(sourceRef, userId, fileTaskAdapter, enabled)
}
