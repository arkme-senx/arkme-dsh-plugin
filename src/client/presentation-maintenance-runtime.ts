import { arkmeAvatarImages } from './avatar-image-runtime.js'
import { arkmeChatDirectory } from './chat-directory-store.js'

export interface ArkmePresentationMaintenancePort {
  start(): () => void
}

interface ArkmePresentationMaintenanceOptions {
  refreshDirectory(): Promise<unknown>
  revalidateAvatars(): Promise<unknown>
  intervalMillis?: number
  jitterMillis?: () => number
}

const DEFAULT_INTERVAL_MILLIS = 10 * 60 * 1000
const DEFAULT_JITTER_MILLIS = 2 * 60 * 1000

function startPeriodicOperation(operation: () => Promise<unknown>, nextDelayMillis: () => number): () => void {
  let active = true
  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = () => {
    timer = setTimeout(() => {
      void operation().catch(() => undefined).finally(() => {
        if (active) schedule()
      })
    }, nextDelayMillis())
  }
  schedule()
  return () => {
    active = false
    if (timer !== undefined) clearTimeout(timer)
  }
}

export function createArkmePresentationMaintenance(
  options: ArkmePresentationMaintenanceOptions,
): ArkmePresentationMaintenancePort {
  const intervalMillis = Math.max(0, options.intervalMillis ?? DEFAULT_INTERVAL_MILLIS)
  const jitterMillis = options.jitterMillis ?? (() => Math.floor(Math.random() * DEFAULT_JITTER_MILLIS))
  const nextDelayMillis = () => intervalMillis + Math.max(0, jitterMillis())
  return {
    start: () => {
      const stopDirectory = startPeriodicOperation(options.refreshDirectory, nextDelayMillis)
      const stopAvatars = startPeriodicOperation(options.revalidateAvatars, nextDelayMillis)
      return () => {
        stopDirectory()
        stopAvatars()
      }
    },
  }
}

export const arkmePresentationMaintenance = createArkmePresentationMaintenance({
  refreshDirectory: async () => await arkmeChatDirectory.refreshRoot({ force: true, silent: true }),
  revalidateAvatars: async () => await arkmeAvatarImages.revalidateActive(),
})
