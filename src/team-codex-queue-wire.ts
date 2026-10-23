import type { TeamCodexQueueSnapshot, TeamCodexQueuedRequest } from './team-codex-contract.js'

/** Proposed queue_snapshot v1 contract. It is enabled only by an explicit owner-only capability. */
export interface CodexCloudQueueSnapshot {
  schema_version: 1
  visibility: 'owner'
  version: number
  availability: TeamCodexQueueSnapshot['availability']
  reason: TeamCodexQueueSnapshot['reason']
  observed_at: number
  changed_at: number
  source_at: number | null
  items: { request_id: string; text: string; created_at: number; delivery: TeamCodexQueuedRequest['delivery'];
    state: TeamCodexQueuedRequest['state']; paused: boolean; attachment_count: number; truncated: boolean }[]
}
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const time = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
export function supportsCodexCloudQueue(value: unknown): boolean {
  const capability = object(object(object(value).capabilities).codex_queue_snapshot)
  return capability.version === 1 && capability.visibility === 'owner'
}
export function codexCloudQueueWire(queue: TeamCodexQueueSnapshot): CodexCloudQueueSnapshot {
  return {schema_version:1,visibility:'owner',version:queue.version,availability:queue.availability,reason:queue.reason,
    observed_at:queue.checkedAt,changed_at:queue.changedAt,source_at:queue.sourceAt,
    items:queue.items.map(item=>({request_id:item.id,text:item.text,created_at:item.createdAt,delivery:item.delivery,
      state:item.state,paused:item.paused,attachment_count:item.attachmentCount,truncated:item.truncated}))}
}
export function parseCodexCloudQueue(value: unknown): TeamCodexQueueSnapshot | undefined {
  const raw = object(value)
  if (raw.schema_version !== 1 || raw.visibility !== 'owner' || !time(raw.version) || raw.version < 1
    || !time(raw.observed_at) || !time(raw.changed_at) || raw.changed_at > raw.observed_at
    || !(raw.source_at === null || time(raw.source_at))
    || !['ready','partial','unavailable','stale','paused'].includes(String(raw.availability))
    || !['none','unavailable','unsupported','wrong-home','excluded','paused','ambiguous-owner'].includes(String(raw.reason))
    || raw.availability === 'ready' && raw.reason !== 'none'
    || !Array.isArray(raw.items) || raw.items.length > 200) return
  const items: TeamCodexQueuedRequest[] = [], ids = new Set<string>()
  for (const value of raw.items) {
    const row = object(value)
    if (typeof row.request_id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(row.request_id) || ids.has(row.request_id)
      || typeof row.text !== 'string' || new TextEncoder().encode(row.text).length > 4096 || !time(row.created_at)
      || !['queue','send-now'].includes(String(row.delivery)) || !['queued','pending','sending','unknown'].includes(String(row.state))
      || typeof row.paused !== 'boolean' || typeof row.truncated !== 'boolean' || !time(row.attachment_count) || row.attachment_count > 10000) return
    ids.add(row.request_id)
    items.push({id:row.request_id,text:row.text,createdAt:row.created_at,delivery:row.delivery as TeamCodexQueuedRequest['delivery'],
      state:row.state as TeamCodexQueuedRequest['state'],paused:row.paused,attachmentCount:row.attachment_count,truncated:row.truncated})
  }
  return {version:raw.version,availability:raw.availability as TeamCodexQueueSnapshot['availability'],reason:raw.reason as TeamCodexQueueSnapshot['reason'],
    checkedAt:raw.observed_at,changedAt:raw.changed_at,sourceAt:raw.source_at as number|null,items}
}
