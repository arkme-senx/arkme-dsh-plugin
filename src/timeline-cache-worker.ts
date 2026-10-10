import { parentPort, workerData } from 'node:worker_threads'
import { UnifiedTimelineCache } from './unified-timeline-cache.js'
import type { TimelineCacheCommand } from './timeline-cache-port.js'

const store = new UnifiedTimelineCache(workerData.directory as string)
parentPort!.on('message', ({ id, command }: { id: number; command: TimelineCacheCommand }) => {
  try {
    let value: unknown
    switch (command.kind) {
      case 'reserve': value = store.reserve(); break
      case 'read': value = store.read(command.scope, command.request, command.anchorId, command.latest); break
      case 'write': value = store.write(command.scope, command.request, command.page, command.options); break
      case 'invalidate': store.invalidate(command.scope, command.timelineItemKey, command.terminal); break
      case 'invalidate-source': store.invalidateSource(command.sourceKey, command.timelineItemKey, command.terminal); break
      case 'close': store.close(); parentPort!.postMessage({ id }); parentPort!.close(); return
    }
    parentPort!.postMessage({ id, value })
  } catch { parentPort!.postMessage({ id, failed: true }) }
})
