export const ARKME_DSH_AGENT_INPUT_CREATION_SOURCE = 3
export const ARKME_DSH_AGENT_INPUT_LABEL = 'DSH Agent 输入'

export function isDshAgentInputCreationSource(item: { creationSource?: number }): boolean {
  return item.creationSource === ARKME_DSH_AGENT_INPUT_CREATION_SOURCE
}

export function isDshAgentInputRecord(item: { creationSource?: number; sourceTitle?: string }): boolean {
  return isDshAgentInputCreationSource(item)
}

/** Authoritative wire fields only: ordinary topics may have the same title. */
export function isDshAgentInputRawRecord(raw: unknown): boolean {
  const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object'
    ? value as Record<string, unknown> : {}
  const item = object(raw)
  const core = object(item.record_core)
  const topic = object(item.topic_core)
  return Number(item.creation_source ?? item.creationSource ?? core.creation_source ?? core.creationSource) === ARKME_DSH_AGENT_INPUT_CREATION_SOURCE
    || Number(topic.kind ?? item.topicKind) === 3
}
