import type { ShareLinkPreview } from '../share-link-preview.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'

export function sharePreviewAccountKey(): string {
  const auth = arkmeAuthStore.getSnapshot().auth
  return auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : ''
}
type Job = { controller: AbortController; users: number; started: boolean; promise: Promise<ShareLinkPreview | null>; finish: (value: ShareLinkPreview | null) => void; key: string; scope: string; url: string }
export class SharePreviewClient {
  private cache = new Map<string, { value: ShareLinkPreview; expires: number }>()
  private jobs = new Map<string, Job>()
  private queue: Job[] = []
  private active = 0
  private scope = ''
  constructor(private readonly read = (url: string, signal: AbortSignal) => callArkme<ShareLinkPreview | null>('share.preview', { url }, signal)) {}

  setScope(scope: string): void {
    if (scope === this.scope) return
    this.scope = scope
    this.cache.clear()
    for (const job of this.jobs.values()) { job.controller.abort(); job.finish(null) }
    this.jobs.clear(); this.queue = []
  }
  acquire(scope: string, url: string): { promise: Promise<ShareLinkPreview | null>; release: () => void } {
    this.setScope(scope)
    if (!scope) return { promise: Promise.resolve(null), release() {} }
    const key = `${scope}:${url}`
    const cached = this.cache.get(key)
    if (cached && cached.expires > Date.now()) return { promise: Promise.resolve(cached.value), release() {} }
    this.cache.delete(key)
    let job = this.jobs.get(key)
    if (!job) {
      if (this.jobs.size >= 48) return { promise: Promise.resolve(null), release() {} }
      let finish!: Job['finish']
      const promise = new Promise<ShareLinkPreview | null>(resolve => { finish = resolve })
      job = { key, scope, url, users: 0, started: false, controller: new AbortController(), promise, finish }
      this.jobs.set(key, job); this.queue.push(job)
    }
    job.users++
    const current = job
    this.pump()
    let released = false
    return { promise: current.promise, release: () => {
      if (released) return
      released = true
      if (--current.users > 0 || this.jobs.get(key) !== current) return
      current.controller.abort(); current.finish(null); this.jobs.delete(key)
      this.queue = this.queue.filter(value => value !== current)
    } }
  }
  private pump(): void {
    while (this.active < 4 && this.queue.length) {
      const job = this.queue.shift()!
      if (job.controller.signal.aborted) continue
      this.active++; job.started = true
      void this.read(job.url, job.controller.signal).then(value => {
        if (job.controller.signal.aborted || this.scope !== job.scope) { job.finish(null); return }
        if (value) {
          this.cache.set(job.key, { value, expires: Date.now() + (value.state === 'error' ? 10000 : 60000) })
          while (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value!)
        }
        job.finish(value)
      }).catch(() => job.finish(null)).finally(() => {
        this.active--
        if (this.jobs.get(job.key) === job) this.jobs.delete(job.key)
        this.pump()
      })
    }
  }
}
export const sharePreviewClient = new SharePreviewClient()
arkmeAuthStore.subscribe(() => sharePreviewClient.setScope(sharePreviewAccountKey()))
