import { DSH_REMOTE_MAX_PAGE_RESULT_BYTES } from './types.js'

/** Canonical rows read back by sessions/sync, never native/executor summaries. */
export interface DshDirectorySession extends Record<string, unknown> {
  runtime_ref: string
  session_ref: string
  workspace_ref: string
  host_generation: number
  projection_at: number
  source_updated_at: number
  running: boolean
  blank: boolean
  archived: boolean
  title?: string
  executor_runtime_ref?: string
  origin?: string
  projection_as_of_seq?: number
  deleted_at?: number
  /** Added only by the local authenticated Host's journal lookup. */
  localTakeover?: boolean
}

export interface DshDirectoryDelta { version: 1; sessions: DshDirectorySession[] }
export const DSH_DIRECTORY_DELTA_MAX_BYTES = DSH_REMOTE_MAX_PAGE_RESULT_BYTES
const ref = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value)
const integer = (value: unknown, minimum: number) => Number.isSafeInteger(value) && Number(value) >= minimum

/** Invalid/old/oversized messages retain the existing full-directory recovery. */
export function parseDshDirectoryDelta(value: unknown): DshDirectoryDelta | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const delta = value as Record<string, unknown>
  if (delta.version !== 1 || !Array.isArray(delta.sessions) || delta.sessions.length > 100) return
  try { if (new TextEncoder().encode(JSON.stringify(value)).byteLength > DSH_DIRECTORY_DELTA_MAX_BYTES) return }
  catch { return }
  const seen = new Set<string>()
  for (const raw of delta.sessions) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
    const row = raw as Record<string, unknown>
    if (!ref(row.runtime_ref) || !ref(row.session_ref) || (row.workspace_ref !== '' && !ref(row.workspace_ref))
      || !integer(row.host_generation, 1) || !integer(row.projection_at, 1) || !integer(row.source_updated_at, 1)
      || typeof row.running !== 'boolean' || typeof row.blank !== 'boolean' || typeof row.archived !== 'boolean'
      || (row.title !== undefined && typeof row.title !== 'string')
      || (row.origin !== undefined && typeof row.origin !== 'string')
      || (row.executor_runtime_ref !== undefined && !ref(row.executor_runtime_ref))
      || (row.projection_as_of_seq !== undefined && !integer(row.projection_as_of_seq, -1))
      || (row.deleted_at !== undefined && !integer(row.deleted_at, 0))) return
    const key = JSON.stringify([row.runtime_ref, row.session_ref])
    if (seen.has(key)) return
    seen.add(key)
  }
  return delta as unknown as DshDirectoryDelta
}

/** These are revisions of one canonical row, not connection generations. */
export function compareDshDirectoryVersion(left: readonly [number, number], right: readonly [number, number]): number {
  return left[0] - right[0] || left[1] - right[1]
}
