import { recordingImportDeadline } from './recording-workflow-contract.js'

export type ImportTaskPhase = 'queued' | 'uploading' | 'finalizing' | 'failed' | 'cancelled'
export interface ImportTask {
  task_id: string; file_name: string; file_size: number; start_at: number; duration_ms: number
  belong_user_id: number; batch_id?: string; item_index: number; item_count: number
  phase: ImportTaskPhase; revision: number
  createStarted?: boolean; localJobRevision?: number; registered?: boolean; acknowledged?: number; accepted?: boolean
}
export interface ImportTaskStorage {
  importTasks(scope: string, mutate?: (tasks: Record<string, ImportTask>) => void): Promise<Record<string, ImportTask>>
}
/** Durable, account scoped outbox. Upload admission never consumes a network/heartbeat slot. */
export class ImportTaskOutbox {
  private tail: Promise<unknown> = Promise.resolve()
  constructor(private readonly store: ImportTaskStorage, private readonly scope: string,
    private readonly post: (path: string, body: unknown, signal?: AbortSignal) => Promise<unknown>) {}
  async register(items: ImportTask[]): Promise<void> {
    await this.store.importTasks(this.scope, tasks => {
      for (const item of items) {
        const current = tasks[item.task_id]
        if (current) {
          for (const key of ['file_name','file_size','start_at','duration_ms','belong_user_id','batch_id','item_index','item_count'] as const)
            if (current[key] !== item[key]) throw new Error('录音导入任务身份冲突')
          if (current.phase === 'failed') { current.phase = 'queued'; current.revision++ }
        } else tasks[item.task_id] = { ...item, phase: 'queued', revision: 1 }
      }
    })
  }
  async change(id: string, phase: ImportTaskPhase, accepted = false, localJobRevision?: number): Promise<void> {
    const observed = (await this.store.importTasks(this.scope))[id]
    if (!observed || observed.phase === 'cancelled' || observed.accepted
      || localJobRevision !== undefined && localJobRevision <= (observed.localJobRevision ?? 0)
      || localJobRevision === undefined && observed.phase === phase && !accepted) return
    await this.store.importTasks(this.scope, tasks => {
      const task = tasks[id]
      if (!task || task.phase === 'cancelled' || task.accepted) return
      if (localJobRevision !== undefined && localJobRevision <= (task.localJobRevision ?? 0)) return
      if (localJobRevision !== undefined) task.localJobRevision = localJobRevision
      if (task.phase !== phase || accepted) { task.phase = phase; task.accepted = accepted; task.revision++ }
    })
  }
  flush(signal?: AbortSignal, heartbeat = false): Promise<void> {
    const work = this.tail.catch(() => undefined).then(async () => {
      signal?.throwIfAborted()
      const tasks = await this.store.importTasks(this.scope, tasks => {
        if (heartbeat) for (const task of Object.values(tasks))
          if (!task.accepted && !['cancelled','failed'].includes(task.phase) && (recordingImportDeadline(task.task_id) ?? 0) > Date.now()) task.revision++
      })
      const active = Object.values(tasks).filter(task => (recordingImportDeadline(task.task_id) ?? 0) > Date.now())
      for (const registered of [false, true]) {
        const pending = active.filter(task => !!task.registered === registered && (!registered || (task.acknowledged ?? 0) < task.revision))
        for (let offset = 0; offset < pending.length; offset += 100) {
          signal?.throwIfAborted()
          const batch = pending.slice(offset, offset + 100)
          const items = batch.map(task => registered ? { task_id: task.task_id, phase: task.phase, revision: task.revision, ...(task.phase === 'failed' ? { error_code: 'recording_import_failed', error_message: '导入失败，请在来源设备重试' } : {}) }
            : { task_id: task.task_id, file_name: task.file_name, file_size: task.file_size, start_at: task.start_at,
              duration_ms: task.duration_ms, belong_user_id: task.belong_user_id, ...(task.batch_id ? { batch_id: task.batch_id } : {}),
              item_index: task.item_index, item_count: task.item_count, phase: 'queued', revision: 1 })
          const response = await this.post(`/api/v1/audio/import-tasks/${registered ? 'sync' : 'register'}`, { items }, signal) as { items?: Array<{task_id: string; revision: number}> }
          if (!Array.isArray(response?.items) || batch.some(task => !response.items!.some(row => row.task_id === task.task_id && Number.isSafeInteger(row.revision)))) throw new Error('录音任务登记响应无效')
          signal?.throwIfAborted()
          await this.store.importTasks(this.scope, current => {
            for (const sent of batch) {
              const task = current[sent.task_id]
              if (task) { task.registered = true; task.acknowledged = Math.max(task.acknowledged ?? 0, registered ? sent.revision : 1) }
            }
          })
        }
      }
    })
    this.tail = work
    return work
  }
}
