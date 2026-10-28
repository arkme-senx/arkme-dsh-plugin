/** Latest content per key; one write per key in flight. Failures remain dirty until retried. */
export class LocalAutosave<T> {
 private entries = new Map<string, {value: T; revision: number; submitted: number; saved: number; failed: boolean; ready: boolean; pending?: Promise<void> | undefined}>()
 private active = new Set<Promise<void>>()
 private timer: ReturnType<typeof setTimeout> | undefined
 constructor(private readonly write: (key: string, value: T) => Promise<void>) {}
 has(key: string): boolean { return this.entries.has(key) }
 hasUnpublished(key: string): boolean { const entry = this.entries.get(key); return !!entry && (entry.failed || entry.revision > entry.submitted) }
 save(key: string, value: T, immediate = false): void {
  const entry = this.entries.get(key)
  if (entry) { entry.value = value; entry.revision++; entry.failed = false }
  else {
   if (this.entries.size >= 1000) throw new Error('本地待保存内容超过上限')
   this.entries.set(key, {value, revision: 1, submitted: 0, saved: 0, failed: false, ready: false})
  }
  if (immediate) { this.entries.get(key)!.ready = true; this.start(key) }
  else this.timer ??= setTimeout(() => { this.timer = undefined; for (const [key, entry] of this.entries) { entry.ready = true; this.start(key) } }, 40)
 }
 private start(key: string): void {
  const entry = this.entries.get(key)
  if (!entry || !entry.ready || entry.pending || entry.failed || this.active.size >= 32) return
  const {value, revision} = entry
  entry.submitted = revision
  // Invoke before awaiting: replication can immediately update another open editor.
  let request: Promise<void>
  try { request = this.write(key, value) } catch (error) { request = Promise.reject(error) }
  entry.pending = request.then(() => { entry.saved = revision }, () => { if (entry.revision === revision) entry.failed = true }).finally(() => {
   this.active.delete(entry.pending!)
   entry.pending = undefined
   if (entry.saved === entry.revision) this.entries.delete(key)
   for (const key of this.entries.keys()) this.start(key)
  })
  this.active.add(entry.pending)
 }
 async flush(keys?: ReadonlySet<string>, retry = false): Promise<void> {
  const selected = () => [...this.entries.keys()].filter(key => !keys || keys.has(key))
  if (!keys && this.timer !== undefined) { clearTimeout(this.timer); this.timer = undefined }
  if (retry) for (const key of selected()) this.entries.get(key)!.failed = false
  while (true) {
   for (const key of selected()) { this.entries.get(key)!.ready = true; this.start(key) }
   const pending = selected().flatMap(key => this.entries.get(key)?.pending ?? [])
   if (!pending.length) {
    if (selected().some(key => !this.entries.get(key)!.failed) && this.active.size) { await Promise.race(this.active); continue }
    break
   }
   await Promise.all(pending)
  }
  if (selected().some(key => this.entries.get(key)?.failed)) throw new Error('草稿尚未保存，请保留窗口并重试')
 }
}
