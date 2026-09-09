import { describe, expect, it, vi } from 'vitest'
import { arkmeToolCatalog, ARKME_TOOL_PROMPT, createArkmeCoreToolDefinitions, type ArkmeCoreToolPorts } from '../src/tools/index.js'
import { preparedDirectory, directoryResult } from './helpers/recording-directory.js'
import { arkmeConfirmationContextHooks } from '../src/tools/shared/conversational-confirmation.js'

function fixture() {
  const prepared = preparedDirectory()
  const unsafeItems = [{ relativePath: 'meeting.wav', outcome: 'invalid' as const, importRef: 'opaque-import', revision: 3,
    errorCode: 'recording-directory-file-failed', message: 'ENOENT /private/audio.upload https://oss.invalid/?signature=secret',
    sessionId: 'private-session', sha256: 'private-hash', sourceHandle: '/private/audio.upload' }]
  const base = directoryResult(unsafeItems)
  const result = { ...base, items: unsafeItems, counts: { ...base.counts, privatePath: '/private/count-secret' },
    stopped: 'capacity' as const, expectedUserId: 42, privatePath: '/private/output-secret' }
  const ports = {
    prepareRecordingDirectory: vi.fn(async () => prepared),
    importRecordingDirectory: vi.fn(async () => result),
  } satisfies Pick<ArkmeCoreToolPorts, 'prepareRecordingDirectory' | 'importRecordingDirectory'>
  const tool = createArkmeCoreToolDefinitions(ports as unknown as ArkmeCoreToolPorts)
    .find(item => item.name === 'arkme_recording_import_folder')
  return { tool, ports, prepared, result }
}
const exec = { signal: new AbortController().signal } as never
const args = { action: 'prepare', directory_path: '/private/recordings' }

describe('recording directory tool', () => {
  it('registers a concurrent explicit-write business tool with accurate time and matching guidance', () => {
    const { tool } = fixture()
    expect(tool).toBeDefined()
    expect(arkmeToolCatalog.modulesFor('business', 'core').find(item => item.meta.toolName === tool!.name)?.meta)
      .toMatchObject({ effect: 'write', grant: 'explicit-user-write' })
    expect(arkmeToolCatalog.toolNamesFor('atomic')).not.toContain(tool!.name)
    expect(tool!.isConcurrencySafe?.(args)).toBe(true)
    expect(tool!.description).toContain('YYYYMMDD-HHMMSS')
    expect(tool!.description).toContain('host local timezone')
    expect(tool!.description).toContain('start_times')
    expect(tool!.description).toContain('metadata')
    expect(tool!.description).toContain('content hash')
    expect(tool!.description).toContain('absolute or ~/')
    expect(tool!.description).toContain('symlinks')
    expect(tool!.description).not.toContain('Scans before confirmation')
    expect(tool!.description).not.toContain('This may run for a long time')
    expect(ARKME_TOOL_PROMPT).toContain(tool!.name)
    expect(createArkmeCoreToolDefinitions({} as ArkmeCoreToolPorts).find(item => item.name === 'arkme_recording_import')!.description)
      .not.toContain('Add large files through Arkme UI first')
  })

  it('rejects a missing action before directory I/O or confirmation preparation', async () => {
    const { tool, ports } = fixture()
    const missing = { directory_path: '/private/recordings' }
    await expect(tool!.execute(missing, exec)).rejects.toThrow('action')
    expect(() => arkmeConfirmationContextHooks(tool!)!.confirmationRequest!(missing)).toThrow('action')
    expect(ports.prepareRecordingDirectory).not.toHaveBeenCalled()
    expect(ports.importRecordingDirectory).not.toHaveBeenCalled()
  })

  it('runs an explicit read-only preflight with recursive/self defaults', async () => {
    const { tool, ports } = fixture()
    const output = String(await tool!.execute(args, exec))
    expect(ports.prepareRecordingDirectory).toHaveBeenCalledWith(
      { directoryPath: args.directory_path, recursive: true, ownership: 'self' }, expect.any(AbortSignal),
    )
    expect(ports.importRecordingDirectory).not.toHaveBeenCalled()
    expect(output).toContain('meeting.wav')
    expect(output).toContain('pending_upload')
    expect(output).not.toContain('expectedUserId')
  })

  it('prepares before an explicit raw upload', async () => {
    const { tool, ports, prepared } = fixture()
    expect(tool).toBeDefined()
    await tool!.execute({ ...args, action: 'upload' }, exec)
    const input = { directoryPath: args.directory_path, recursive: true, ownership: 'self' }
    expect(ports.prepareRecordingDirectory).toHaveBeenCalledWith(input, expect.any(AbortSignal))
    expect(ports.importRecordingDirectory).toHaveBeenCalledWith(input, prepared, expect.any(AbortSignal))
    expect(ports.prepareRecordingDirectory.mock.invocationCallOrder[0])
      .toBeLessThan(ports.importRecordingDirectory.mock.invocationCallOrder[0]!)
  })

  it('maps explicit per-file times and nonrecursive/other scope without changing paths', async () => {
    const { tool, ports } = fixture()
    expect(tool).toBeDefined()
    await tool!.execute({ ...args, recursive: false, ownership: 'other',
      start_times: [{ relative_path: 'sub/meeting.wav', start_at_millis: 1_700_000_000_000 }] }, exec)
    expect(ports.prepareRecordingDirectory).toHaveBeenCalledWith({
      directoryPath: args.directory_path, recursive: false, ownership: 'other',
      startTimes: [{ relativePath: 'sub/meeting.wav', startAtMillis: 1_700_000_000_000 }],
    }, expect.any(AbortSignal))
  })

  it('keeps the prepared account and file snapshot through confirmation without rescanning', async () => {
    const { tool, ports, prepared } = fixture()
    expect(tool).toBeDefined()
    const hooks = arkmeConfirmationContextHooks(tool!)
    expect(hooks).toBeDefined()
    const captured = await hooks!.prepare(args, exec)
    expect(ports.importRecordingDirectory).not.toHaveBeenCalled()
    ports.prepareRecordingDirectory.mockResolvedValue({ ...prepared, expectedUserId: 77 })
    await hooks!.execute({ ...args, action: 'upload' }, exec, captured)
    expect(ports.prepareRecordingDirectory).toHaveBeenCalledOnce()
    expect(ports.importRecordingDirectory).toHaveBeenCalledWith(
      { directoryPath: args.directory_path, recursive: true, ownership: 'self' }, prepared, expect.any(AbortSignal),
    )
  })

  it('exposes only snake_case result fields and safe errors', async () => {
    const { tool } = fixture()
    expect(tool).toBeDefined()
    const output = String(await tool!.execute({ ...args, action: 'upload' }, exec))
    const result = JSON.parse(output.split('<data_from_arkme>\n')[1]!.split('\n</data_from_arkme>')[0]!)
    expect(result).toEqual({
      total: 1, skipped: 0, remaining: 0,
      counts: { uploaded: 0, matched_uploaded: 0, in_progress: 0, failed: 0, cancelled: 0, conflict: 0, time_required: 0, invalid: 1 },
      items: [{ relative_path: 'meeting.wav', outcome: 'invalid', import_ref: 'opaque-import', revision: 3,
        error_code: 'recording-directory-file-failed', error_message: expect.any(String) }],
      stopped: 'capacity',
    })
    expect(output).not.toMatch(/private\/|private-session|private-hash|expectedUserId|signature=secret|oss\.invalid/)
  })

  it('does not expose a transport error stored in the error code field', async () => {
    const { tool, result } = fixture()
    result.items[0]!.errorCode = 'ENOENT /private/audio.upload'
    expect(tool).toBeDefined()
    const output = String(await tool!.execute({ ...args, action: 'upload' }, exec))
    expect(output).not.toContain('/private/')
    expect(output).toContain('recording-directory-file-failed')
  })

  it.each([
    {}, { directory_path: '' }, { ...args, action: 'delete' }, { ...args, recursive: 'yes' }, { ...args, ownership: 'contact' },
    { ...args, start_times: {} }, { ...args, start_times: [null] },
    { ...args, start_times: [{ relative_path: '', start_at_millis: 1_700_000_000_000 }] },
    { ...args, start_times: [{ relative_path: 'a.wav', start_at_millis: -1 }] },
    { ...args, start_times: [{ relative_path: 'a.wav', start_at_millis: Date.now() + 86_400_000 }] },
    { ...args, start_times: [{ relative_path: 'a.wav', start_at_millis: 1.5 }] },
    { ...args, start_times: [{ relative_path: 'a.wav', start_at_millis: 1 }, { relative_path: 'a.wav', start_at_millis: 2 }] },
  ])('rejects invalid parameters before directory I/O: %j', async invalid => {
    const { tool, ports } = fixture()
    expect(tool).toBeDefined()
    await expect(tool!.execute(invalid, exec)).rejects.toThrow()
    expect(ports.prepareRecordingDirectory).not.toHaveBeenCalled()
    expect(ports.importRecordingDirectory).not.toHaveBeenCalled()
  })

  it('does not scan or import an already cancelled operation', async () => {
    const { tool, ports } = fixture()
    expect(tool).toBeDefined()
    await expect(tool!.execute(args, { signal: AbortSignal.abort() } as never)).rejects.toThrow()
    expect(ports.prepareRecordingDirectory).not.toHaveBeenCalled()
    expect(ports.importRecordingDirectory).not.toHaveBeenCalled()
  })
})
