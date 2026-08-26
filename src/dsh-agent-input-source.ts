export const ARKME_DSH_AGENT_INPUT_CREATION_SOURCE = 3
export const ARKME_DSH_AGENT_INPUT_LABEL = 'DSH Agent 输入'

export function isDshAgentInputCreationSource(item: { creationSource?: number }): boolean {
  return item.creationSource === ARKME_DSH_AGENT_INPUT_CREATION_SOURCE
}

export function isDshAgentInputSourceTitle(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase()
  return normalized === 'dsh agent input' || normalized === ARKME_DSH_AGENT_INPUT_LABEL.toLowerCase()
}

export function isDshAgentInputRecord(item: { creationSource?: number; sourceTitle?: string }): boolean {
  return isDshAgentInputCreationSource(item) || isDshAgentInputSourceTitle(item.sourceTitle)
}
