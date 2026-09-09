import type { ToolSchema } from '@deepseek-ai/dsh-llm'

const PREFIX = 'mcp__arkme__'
const RECORDING_TOOLS = ['query_recordings', 'batch_get_recordings', 'resolve_recording_speakers', 'query_recording_transcript', 'query_recording_summaries', 'read_recording_summary'] as const

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** Pure per-assembly discovery: no cache, credentials, fallback or connection state. */
export function recordingCapabilityGuidance(schemas: readonly ToolSchema[]): string {
  const available = new Map(schemas.map(schema => [schema.name, schema]))
  const names = RECORDING_TOOLS.filter(name => available.has(PREFIX + name))
  const transcript = available.get(PREFIX + 'query_recording_transcript')
  const fields = object(object(transcript?.parameters).properties)
  const modes = object(fields.text_mode).enum
  const full = Array.isArray(modes) && modes.includes('full')
  const window = fields.start_at !== undefined && fields.end_at !== undefined
  return 'Recording capability discovery (not a permission grant): '
    + (names.length ? names.map(name => PREFIX + name).join(', ') : 'no recording tools currently discovered')
    + `. Complete-text mode: ${full ? 'available' : 'not discovered'}; explicit transcript time window: ${window ? 'available' : 'not discovered'}. `
    + 'Use only discovered tools and supported fields, subject to normal session grants. Missing recording capabilities do not imply other Arkme tools are unavailable. Never use retired local recording tools as fallback.'
}
