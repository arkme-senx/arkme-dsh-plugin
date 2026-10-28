import { inspectArkmeRecordingSelection, type ArkmeRecordingSelection } from './recording-import-selection.js'

type Preparation = {
  file: File
  active(): boolean
  started(): void
  resolve(result: ArkmeRecordingSelection): void
}

const cancelled: ArkmeRecordingSelection = { ok: false, message: '文件准备已取消' }

/** Bound file reads: cloud-backed files can wait for macOS to materialize their bytes. */
export class RecordingImportPreparationQueue {
  private readonly waiting: Preparation[] = []
  private readonly running = new Set<Preparation>()
  private disposed = false

  add(file: File, active: () => boolean, started: () => void): Promise<ArkmeRecordingSelection> {
    if (this.disposed) return Promise.resolve(cancelled)
    return new Promise(resolve => {
      this.waiting.push({ file, active, started, resolve })
      this.drain()
    })
  }

  dispose(): void {
    this.disposed = true
    for (const item of [...this.waiting.splice(0), ...this.running]) item.resolve(cancelled)
    this.running.clear()
  }

  private drain(): void {
    while (!this.disposed && this.running.size < 2 && this.waiting.length > 0) {
      const item = this.waiting.shift()!
      if (!item.active()) { item.resolve(cancelled); continue }
      this.running.add(item)
      item.started()
      void this.inspect(item)
    }
  }

  private async inspect(item: Preparation): Promise<void> {
    let result: ArkmeRecordingSelection
    try {
      result = await inspectArkmeRecordingSelection(item.file)
    } catch {
      result = { ok: false, message: '无法读取或校验录音，请确认文件已下载且可以打开后重试' }
    }
    this.running.delete(item)
    item.resolve(this.disposed || !item.active() ? cancelled : result)
    this.drain()
  }
}
