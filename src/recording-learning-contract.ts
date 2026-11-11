export const learningStatuses = ['pending', 'processing', 'ready', 'skipped', 'failed', 'revoked'] as const
export type LearningStatus = typeof learningStatuses[number]
export interface RecordingLearningItem {
  status: LearningStatus
  reason: string
  eligible: boolean
  sampleCount: number
  start: number
  end: number
  retryRefs: string[]
}
export interface RecordingLearning {
  version: string
  totalCount: number
  eligibleCount: number
  readyCount: number
  counts: Record<LearningStatus, number>
  items: RecordingLearningItem[]
}

/** Validate counts and retry ownership before presenting evidence as learned. */
export async function parseRecordingLearning(raw: Record<string, unknown>, correctionId: string,
  sealRetry: (jobId: string, attempt: number) => Promise<string>): Promise<RecordingLearning> {
  const invalid = () => { throw new Error('学习状态响应不完整，请重新读取') }
  const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0
  if (raw.schema_version !== 1 || raw.correction_id !== correctionId || typeof raw.version !== 'string' || !raw.version
    || !count(raw.total_count) || !count(raw.eligible_count) || !count(raw.ready_count) || !Array.isArray(raw.items)
    || raw.items.length !== raw.total_count || raw.items.length > 100) return invalid()
  const counts = Object.fromEntries(learningStatuses.map(s => [s, 0])) as Record<LearningStatus, number>
  const items: RecordingLearningItem[] = []
  for (const value of raw.items) {
    if (!value || typeof value !== 'object') return invalid()
    const row = value as Record<string, unknown>, loc = row.item as Record<string, unknown> | undefined
    const range = (loc?.selection ?? loc) as Record<string, unknown> | undefined
    if (!learningStatuses.includes(row.status as LearningStatus) || typeof row.eligible !== 'boolean'
      || !count(row.sample_count) || typeof row.retryable !== 'boolean' || !range
      || !count(range.start_at) || !count(range.end_at) || range.end_at <= range.start_at
      || (row.reason !== undefined && typeof row.reason !== 'string')) return invalid()
    const status = row.status as LearningStatus
    if (status === 'ready' && (!row.eligible || row.sample_count === 0)) return invalid()
    if (row.retryable && status !== 'failed') return invalid()
    const retryRefs: string[] = []
    if (row.retryable) {
      if (!Array.isArray(row.jobs) || row.jobs.length === 0) return invalid()
      for (const value of row.jobs) {
        const job = value as Record<string, unknown>
        if (!job || typeof job.job_id !== 'string' || !/^[a-f0-9]{24}$/.test(job.job_id) || !count(job.attempt) || job.attempt < 1) return invalid()
        retryRefs.push(await sealRetry(job.job_id, job.attempt))
      }
    }
    counts[status]++
    items.push({ status, reason: String(row.reason ?? ''), eligible: row.eligible, sampleCount: row.sample_count,
      start: range.start_at, end: range.end_at, retryRefs })
  }
  if (items.filter(i => i.eligible).length !== raw.eligible_count || counts.ready !== raw.ready_count) return invalid()
  return { version: raw.version, totalCount: raw.total_count, eligibleCount: raw.eligible_count, readyCount: raw.ready_count, counts, items }
}
