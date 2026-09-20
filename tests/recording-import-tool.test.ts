import { describe, expect, it, vi } from 'vitest'
import { arkmeToolCatalog, ARKME_TOOL_PROMPT, createArkmeCoreToolDefinitions, type ArkmeCoreToolPorts } from '../src/tools/index.js'

function fixture(phase = 'prepared') {
  const job = {
    importRef: 'opaque-import', revision: 3, phase, ownership: 'self', fileName: 'meeting.wav',
    fileSize: 100, durationMillis: 1000, startAtMillis: 1_700_000_000_000,
    endAtMillis: 1_700_000_001_000, progress: phase === 'accepted' ? 1 : 0,
    status: phase === 'accepted' ? 'accepted' : 'preparing', statusDetail: 'status',
    // A future internal field must never accidentally leak through the tool projection.
    sourceHandle: '/private/audio.upload', sessionId: 'internal-session', sha256: 'private-hash',
  }
  const ports = { importRecordingFile: vi.fn(async () => job), recordingImportStatus: vi.fn(async () => job), retryRecordingImport: vi.fn(async () => job) }
  const tool = createArkmeCoreToolDefinitions(ports as unknown as ArkmeCoreToolPorts).find(t => t.name === 'arkme_recording_import')
  return { tool, ports }
}
const exec = { signal: new AbortController().signal } as never
const upload = { action: 'upload', file_ref: 'arkme-file-v1.00000000-0000-4000-8000-000000000001', start_at_millis: 1_700_000_000_000 }

describe('recording import tool', () => {
  it('registers one explicit-write business tool and describes safe import routing', () => {
    expect(fixture().tool).toBeDefined()
    expect(arkmeToolCatalog.modulesFor('business', 'core').find(m => m.meta.toolName === 'arkme_recording_import')?.meta)
      .toMatchObject({ effect: 'write', grant: 'explicit-user-write' })
    expect(arkmeToolCatalog.toolNamesFor('atomic')).not.toContain('arkme_recording_import')
    expect(ARKME_TOOL_PROMPT).toContain('arkme_recording_import')
  })

  it('passes only an authorized reference, explicit start and default self ownership to the port', async () => {
    const { tool, ports } = fixture()
    expect(tool).toBeDefined()
    const result = await tool!.execute(upload, exec)
    expect(ports.importRecordingFile).toHaveBeenCalledWith({ fileRef: upload.file_ref, startAtMillis: upload.start_at_millis, ownership: 'self' }, expect.any(AbortSignal))
    expect(String(result)).toContain('opaque-import')
    expect(String(result)).not.toMatch(/private\/audio|internal-session|private-hash/)
    expect(ports.recordingImportStatus).not.toHaveBeenCalled()
  })

  it.each([
    { action: 'upload' }, { ...upload, start_at_millis: -1 }, { ...upload, start_at_millis: 1.5 },
    { ...upload, start_at_millis: Date.now() + 86400_000 }, { ...upload, ownership: 'contact' },
    { ...upload, file_ref: '/tmp/voice.wav' }, { ...upload, import_ref: 'ambiguous' },
    { action: 'status' }, { action: 'status', import_ref: 'opaque', file_ref: upload.file_ref },
    { action: 'retry', import_ref: 'opaque' }, { action: 'retry', import_ref: 'opaque', revision: 0 },
    { action: 'delete', import_ref: 'opaque' },
  ])('rejects incomplete or ambiguous parameters before I/O: %j', async args => {
    const { tool, ports } = fixture()
    expect(tool).toBeDefined()
    await expect(tool!.execute(args, exec)).rejects.toThrow()
    for (const port of Object.values(ports)) expect(port).not.toHaveBeenCalled()
  })

  it('queries accepted status without reuploading and does not claim transcription completion', async () => {
    const { tool, ports } = fixture('accepted')
    expect(tool).toBeDefined()
    const result = String(await tool!.execute({ action: 'status', import_ref: 'opaque-import' }, exec))
    expect(ports.recordingImportStatus).toHaveBeenCalledWith('opaque-import')
    expect(ports.importRecordingFile).not.toHaveBeenCalled()
    expect(result).toContain('accepted')
    expect(tool!.description).toContain('phase=accepted means the upload was received')
    expect(result).not.toContain('"processing_complete": true')
  })

  it('retries with the same import reference and exact revision', async () => {
    const { tool, ports } = fixture()
    expect(tool).toBeDefined()
    await tool!.execute({ action: 'retry', import_ref: 'opaque-import', revision: 3 }, exec)
    expect(ports.retryRecordingImport).toHaveBeenCalledWith('opaque-import', 3, expect.any(AbortSignal))
    expect(ports.importRecordingFile).not.toHaveBeenCalled()
  })

  it('does not start a write for an already aborted tool call', async () => {
    const { tool, ports } = fixture()
    expect(tool).toBeDefined()
    await expect(tool!.execute(upload, { signal: AbortSignal.abort() } as never)).rejects.toThrow()
    expect(ports.importRecordingFile).not.toHaveBeenCalled()
  })
})

describe('recording failure projection', () => {
  it('does not expose owner transport errors containing local paths or signed URLs', async () => {
    const ports = { recordingImportStatus: async () => ({
      importRef: 'opaque', phase: 'failed', revision: 5, status: 'failed', statusDetail: 'ENOENT /private/user/audio.upload', retryable: true,
      errorCode: 'recording-import-owner-failed', errorMessage: 'ENOENT /private/user/audio.upload https://oss.invalid/?signature=secret',
    }) } as unknown as ArkmeCoreToolPorts
    const tool = createArkmeCoreToolDefinitions(ports).find(t => t.name === 'arkme_recording_import')!
    const result = String(await tool.execute({ action: 'status', import_ref: 'opaque' }, exec))
    expect(result).not.toMatch(/private\/user|signature=secret|oss\.invalid/)
    expect(result).toContain('recording-import-owner-failed')
  })
})

describe('recording import scheduling and output boundaries', () => {
  it('allows status queries to run alongside other read operations', () => {
    const { tool } = fixture()
    expect(tool!.isConcurrencySafe?.({ action: 'status', import_ref: 'opaque-import' })).toBe(true)
    expect(tool!.isConcurrencySafe?.(upload)).toBe(false)
    expect(tool!.isConcurrencySafe?.({ action: 'retry', import_ref: 'opaque-import', revision: 3 })).toBe(false)
  })
  it('returns only the upload facts without generation claims or model instructions', async () => {
    const { tool } = fixture('accepted')
    const result = String(await tool!.execute({ action: 'status', import_ref: 'opaque-import' }, exec))
    expect(result).not.toMatch(/不能据此|本状态不代表|请继续查询/)
    expect(result).not.toContain('"status":')
    expect(result).toContain('"phase": "accepted"')
  })
})
