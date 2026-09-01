import { describe, expect, it, vi } from 'vitest'
import { createArkmeCoreToolDefinitions } from '../../src/tools/index.js'

describe('background sound and location-safe file Tools', () => {
  it('allows models to read or explicitly disable the preference, but never enable it', async () => {
    const backgroundSoundPreference = vi.fn(async () => ({ userId: 42, found: true, enabled: true }))
    const updateBackgroundSoundPreference = vi.fn(async (enabled: boolean) => ({ userId: 42, found: true, enabled }))
    const tools = createArkmeCoreToolDefinitions({ backgroundSoundPreference, updateBackgroundSoundPreference } as never)
    const read = tools.find(definition => definition.name === 'arkme_background_sound_status')!
    const disable = tools.find(definition => definition.name === 'arkme_background_sound_disable')!

    await expect(read.execute({}, { signal: new AbortController().signal } as never)).resolves.toContain('"enabled": true')
    await expect(disable.execute({ enabled: true }, { signal: new AbortController().signal } as never)).resolves.toContain('"enabled": false')
    expect(updateBackgroundSoundPreference).toHaveBeenCalledWith(false, expect.any(AbortSignal), 42)
    expect(JSON.stringify(disable.parameters)).not.toContain('enabled')
  })

  it('sends only explicitly staged background refs through the existing write-granted file Tool', async () => {
    const fileSend = vi.fn(async (input: unknown) => input)
    const tool = createArkmeCoreToolDefinitions({ fileSend } as never)
      .find(definition => definition.name === 'arkme_files_send')!
    const parameters = JSON.stringify(tool.parameters)
    expect(parameters).toContain('background_sound_file_refs')
    expect(parameters).toContain('background_sound_amplitudes')
    expect(tool.description).toMatch(/microphone|麦克风/u)

    await tool.execute({
      source_ref: 'source-ref',
      file_refs: ['arkme-file-v1.00000000-0000-4000-8000-000000000003'],
      background_sound_file_refs: ['arkme-file-v1.00000000-0000-4000-8000-000000000003'],
      background_sound_amplitudes: [0.1, 0.8],
      text: '带背景音的文字',
    }, { callId: 'background-send-1', signal: new AbortController().signal } as never)

    expect(fileSend).toHaveBeenCalledWith(expect.objectContaining({
      backgroundSound: {
        fileRefs: ['arkme-file-v1.00000000-0000-4000-8000-000000000003'], amplitudes: [0.1, 0.8],
      },
    }))
  })

  it('never exposes a durable task precise location to model-facing file tools', async () => {
    const task = {
      sourceRef: 'source-ref', recordUid: 'record-1', relationUid: 'relation-1', fileRefs: ['file-1'],
      content: { textContent: '附件' }, taskRef: 'task-1', createdAtMillis: 1, state: 'sent' as const,
      files: [], location: { latitude: 30.52, longitude: 114.31, capturedAtMillis: 1 },
    }
    const tool = createArkmeCoreToolDefinitions({
      fileCapabilities: () => ({ version: 1, maxFileBytes: 1, maxImageBytes: 1, maxAttachments: 1 }),
      fileList: async () => [],
      fileSendTasks: async () => [task],
    } as never).find(definition => definition.name === 'arkme_files_list')!

    const output = await tool.execute({}, { signal: new AbortController().signal } as never) as string

    expect(output).toContain('"taskRef": "task-1"')
    expect(output).not.toContain('30.52')
    expect(output).not.toContain('114.31')
    expect(output).not.toContain('"location"')
  })

})
