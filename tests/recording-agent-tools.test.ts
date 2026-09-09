import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { CallId } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, vi } from 'vitest'
import { ARKME_TOOL_PROMPT, registerArkmeTools, type ArkmeToolPorts } from '../src/tools/index.js'
import { arkmeToolCatalog } from '../src/tools/registry/catalog.js'
import { recordingCapabilityGuidance } from '../src/openapi-mcp/recording-capabilities.js'

describe('retired recording model entry points', () => {
  it('discovers each capability without promoting any MCP connection to recording readiness', () => {
    expect(recordingCapabilityGuidance([{ name: 'mcp__arkme__query_records', description: '', parameters: {} }])).toContain('no recording tools currently discovered')
    const schema = { name: 'mcp__arkme__query_recording_transcript', description: '', parameters: { type: 'object', properties: { text_mode: { enum: ['bounded', 'full'] }, start_at: {}, end_at: {} } } }
    expect(recordingCapabilityGuidance([schema])).toContain('Complete-text mode: available')
    expect(recordingCapabilityGuidance([schema])).toContain('explicit transcript time window: available')
    expect(recordingCapabilityGuidance([{ ...schema, parameters: {} }])).toContain('Complete-text mode: not discovered')
    expect(recordingCapabilityGuidance([])).toContain('no recording tools currently discovered')
  })
  it.each(['business', 'hybrid', 'atomic', 'disabled'] as const)('cannot discover or execute old names in %s', async profile => {
    const ctx = new Context()
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SystemPrompt)
    const read = vi.fn(() => { throw new Error('retired owner must not run') })
    const ports = { recordingCalendar: read, recordingTranscript: read, recordingProjection: read } as unknown as ArkmeToolPorts
    const fiber = await ctx.plugin(Object.assign((plugin: Context) => registerArkmeTools(plugin, ports, profile), { inject: ['tools', 'systemPrompt'] }))
    const schemas = ctx.tools.schemas()
    // Importing local files is a separate write capability, not a retired read.
    for (const name of ['arkme_recording_import', 'arkme_recording_import_folder']) {
      expect(schemas.some(tool => tool.name === name)).toBe(profile === 'business' || profile === 'hybrid')
    }
    expect(schemas.map(tool => tool.description).join('\n')).not.toMatch(/arkme_recording_days_list|arkme_recording_read/)
    for (const name of ['arkme_recording_days_list', 'arkme_recording_read']) {
      expect(arkmeToolCatalog.toolNamesFor(profile)).not.toContain(name)
      expect(ctx.tools.schemas().map(tool => tool.name)).not.toContain(name)
      // Restored historical messages cannot resurrect a removed definition.
      const result = await ctx.tools.execute({ name, callId: CallId(`retired-${profile}-${name}`), arguments: { date: '2026-09-08', content: 'transcript' }, signal: new AbortController().signal })
      expect(result.isError).toBe(true)
    }
    expect(read).not.toHaveBeenCalled()
    await fiber.dispose()
  })

  it('uses business summaries as optional reference material, not final analysis', () => {
    expect(ARKME_TOOL_PROMPT).not.toMatch(/arkme_recording_days_list|arkme_recording_read|Always prefer summary/)
    expect(ARKME_TOOL_PROMPT).toContain('query_recording_transcript')
    expect(ARKME_TOOL_PROMPT).toContain('text_mode=full')
    expect(ARKME_TOOL_PROMPT).toContain('not your current analysis')
    expect(ARKME_TOOL_PROMPT).toContain('list filters are not inherited')
  })

  it('keeps the shared prompt aligned with public recording material inputs', () => {
    expect(ARKME_TOOL_PROMPT).toContain('recording_uid and exact complete utterances')
    expect(ARKME_TOOL_PROMPT).not.toMatch(/Pass exact session_id and segment selectors/)
  })
})
