import type {
  ArrangementOccurrenceAction,
  ArrangementOccurrenceInput,
  ArrangementOccurrenceResponse,
  ArrangementOccurrenceReview,
} from '../arrangement-occurrence.js'
import type { ArrangementRecognitionTrace } from '../arrangement-recognition.js'
import type { ArkmeArrangementItem } from '../types.js'
import { ArkmePluginError } from './service-error.js'

type ObjectData = Record<string, unknown>
type ProjectItem = (raw: ObjectData) => Promise<ArkmeArrangementItem>

function invalid(): never {
  throw new ArkmePluginError(
    'arrangement-occurrence-contract',
    '事项归并响应不完整，无法确认结果，请刷新重试',
    false,
    502,
  )
}
function object(value: unknown): ObjectData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  return value as ObjectData
}
function text(value: unknown): string {
  return typeof value === 'string' ? value : invalid()
}
function identity(value: unknown): string {
  const result = text(value)
  return result.trim() ? result : invalid()
}
function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : invalid()
}
function integer(value: unknown): number {
  const result = number(value)
  return Number.isSafeInteger(result) ? result : invalid()
}
function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : invalid()
}
function strings(value: unknown): string[] {
  return list(value).map(text)
}
// Parse values explicitly. A TypeScript assertion cannot validate a remote response.
function trace(value: unknown): ArrangementRecognitionTrace {
  const raw = object(value)
  return {
    id: identity(raw.id),
    source: text(raw.source),
    status: text(raw.status),
    purpose: text(raw.purpose),
    started_at: number(raw.started_at),
    ...(raw.finished_at === undefined ? {} : { finished_at: number(raw.finished_at) }),
    route_key: identity(raw.route_key),
    ...(raw.requested_route_key === undefined
      ? {}
      : { requested_route_key: text(raw.requested_route_key) }),
    provider: text(raw.provider),
    model_key: text(raw.model_key),
    display_name: text(raw.display_name),
    settings_revision: text(raw.settings_revision),
    policy_version: text(raw.policy_version),
    prompt_hash: text(raw.prompt_hash),
    ...(raw.prompt === undefined ? {} : { prompt: text(raw.prompt) }),
    ...(raw.raw_output === undefined ? {} : { raw_output: text(raw.raw_output) }),
    max_tokens: integer(raw.max_tokens),
    prompt_tokens: integer(raw.prompt_tokens),
    completion_tokens: integer(raw.completion_tokens),
    ...(raw.finish_reason === undefined ? {} : { finish_reason: text(raw.finish_reason) }),
    ...(raw.actual_model === undefined ? {} : { actual_model: text(raw.actual_model) }),
    ...(raw.provider_request_uid === undefined
      ? {}
      : { provider_request_uid: text(raw.provider_request_uid) }),
    rules: strings(raw.rules),
    pipeline: strings(raw.pipeline),
    ...(raw.match_trace_ids === undefined ? {} : { match_trace_ids: strings(raw.match_trace_ids) }),
    ...(raw.redacted === undefined ? {} : { redacted: raw.redacted === true }),
    ...(raw.outcomes === undefined
      ? {}
      : {
          outcomes: list(raw.outcomes).map((value) => {
            const item = object(value)
            return {
              title: text(item.title),
              description: text(item.description),
              due_at: number(item.due_at),
            }
          }),
        }),
    ...(raw.events === undefined
      ? {}
      : {
          events: list(raw.events).map((value) => {
            const event = object(value)
            return { rule: text(event.rule), before: text(event.before), after: text(event.after) }
          }),
        }),
    ...(raw.inputs === undefined
      ? {}
      : {
          inputs: list(raw.inputs).map((value) => {
            const input = object(value)
            return {
              original_runes: integer(input.original_runes),
              candidate_runes: integer(input.candidate_runes),
              prompt_runes: integer(input.prompt_runes),
              limit: integer(input.limit),
            }
          }),
        }),
  }
}

async function review(
  value: unknown,
  projectItem: ProjectItem,
): Promise<ArrangementOccurrenceReview> {
  const raw = object(value),
    candidate = object(raw.candidate),
    refs = new Map<string, string>()
  const peers = await Promise.all(
    list(raw.peers).map(async (value) => {
      const peer = object(value),
        uid = identity(peer.uid),
        version = integer(peer.version)
      text(peer.title)
      if (![0, 1, 2, 3, 4, 5].includes(integer(peer.status)) || refs.has(uid)) return invalid()
      // Reserve the key before awaiting so duplicate UIDs cannot race the check.
      refs.set(uid, '')
      const item = await projectItem(peer)
      refs.set(uid, item.arrangementRef)
      return { ...item, version }
    }),
  )
  // Invalid model comparisons are legitimate reasons for a pending review. Keep
  // their facts inspectable, but never turn an untrusted UID into an owner reference.
  const comparisons = (raw.comparisons === null ? [] : list(raw.comparisons)).map((value) => {
    const comparison = object(value),
      arrangementRef = refs.get(text(comparison.uid)) || undefined
    const confidence = comparison.confidence
    if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return invalid()
    const flag = (key: string) =>
      typeof comparison[key] === 'boolean' ? comparison[key] : invalid()
    return {
      ...(arrangementRef ? { arrangementRef } : {}),
      relation: text(comparison.relation),
      confidence,
      same_event: flag('same_event'),
      same_people: flag('same_people'),
      same_occurrence: flag('same_occurrence'),
      time_conflict: flag('time_conflict'),
      place_conflict: flag('place_conflict'),
      reason: text(comparison.reason),
    }
  })
  const kind = text(raw.kind)
  if (!['automatic', 'history'].includes(kind) || raw.state !== 'pending') return invalid()
  return {
    id: identity(raw.id),
    state: 'pending',
    kind,
    created_at: number(raw.created_at),
    ...(raw.recognized_at === undefined ? {} : { recognized_at: number(raw.recognized_at) }),
    source: text(raw.source),
    reason: text(raw.reason),
    ...(raw.model === undefined ? {} : { model: text(raw.model) }),
    ...(raw.match_trace_id === undefined ? {} : { match_trace_id: text(raw.match_trace_id) }),
    candidate: {
      title: identity(candidate.title),
      description: text(candidate.description),
      due_at: number(candidate.due_at),
    },
    peers,
    comparisons,
  }
}

export async function projectOccurrenceResponse(
  action: ArrangementOccurrenceAction,
  input: ArrangementOccurrenceInput,
  value: unknown,
  accountScope: string,
  projectItem: ProjectItem,
  expectedOwner?: string,
): Promise<ArrangementOccurrenceResponse> {
  const raw = object(value)
  if (raw.state === 'conflict' || raw.state === 'unavailable')
    return { accountScope, state: raw.state, reason: identity(raw.reason) }
  switch (action) {
    case 'events': {
      if (raw.state !== 'ready') return invalid()
      const seen = new Set<string>()
      const events = list(raw.events).map((value) => {
        const event = object(value),
          id = identity(event.id),
          disposition = text(event.disposition)
        if (seen.has(id) || !['new', 'merged', 'historical-merge'].includes(disposition))
          return invalid()
        seen.add(id)
        return {
          id,
          ...(event.trace_id === undefined ? {} : { trace_id: text(event.trace_id) }),
          ...(event.recognized_at === undefined
            ? {}
            : { recognized_at: number(event.recognized_at) }),
          attached_at: number(event.attached_at),
          source: text(event.source),
          evidence_ids: strings(event.evidence_ids),
          reason: text(event.reason),
          disposition,
        }
      })
      return { accountScope, state: 'ready', events }
    }
    case 'reviews/summary':
      if (raw.state !== 'ready') return invalid()
      return { accountScope, state: 'ready', count: integer(raw.count) }
    case 'reviews/list':
      if (raw.state !== 'ready') return invalid()
      return {
        accountScope,
        state: 'ready',
        items: await Promise.all(list(raw.items).map((value) => review(value, projectItem))),
      }
    case 'history/preview': {
      if (raw.state !== 'preview') return invalid()
      const result = await review(raw.review, projectItem)
      if (result.kind !== 'history') return invalid()
      return {
        accountScope,
        state: 'preview',
        review: result,
        ...(raw.trace === undefined ? {} : { trace: trace(raw.trace) }),
      }
    }
    case 'reviews/decide':
    case 'history/apply': {
      if (raw.state !== 'applied') return invalid()
      if (action === 'reviews/decide' && input.action === 'ignore')
        return { accountScope, state: 'applied' }
      const item = object(raw.item),
        uid = identity(item.uid)
      text(item.title)
      if (![1, 2, 3].includes(integer(item.status)) || (expectedOwner && uid !== expectedOwner))
        return invalid()
      return { accountScope, state: 'applied', item: await projectItem(item) }
    }
  }
}
