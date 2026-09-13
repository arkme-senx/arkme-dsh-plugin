import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RecordingImportJob } from '../src/recording-import-contract.js'
import { abortRecordingFileUpload, uploadRecordingFile } from '../src/services/recording-file-upload.js'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function fixture(size = 8 * 1024 * 1024 + 3) {
  const dir = await mkdtemp(join(tmpdir(), 'arkme upload with spaces ')); directories.push(dir)
  const sourceHandle = join(dir, 'recording.upload')
  const bytes = Buffer.alloc(size, 42); await writeFile(sourceHandle, bytes)
  const job: RecordingImportJob = {
    jobId: 'job', userId: 7, revision: 1, phase: 'uploading', fileName: 'recording.wav',
    mimeType: 'audio/wav', fileSize: size, durationMillis: 1000,
    sha256: createHash('sha256').update(bytes).digest('hex'), sourceHandle,
    startAtMillis: 1000, belongUserId: 7, uploadedBytes: 0, createdAtMillis: 1000, updatedAtMillis: 1000,
    sessionId: 'session', childId: 'child',
  }
  const grants = new Map<string, { md5: string; size: number; number: number }>()
  let uploadedParts: number[] = []
  const post = vi.fn(async (path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> => {
    expect(body.child_id).toBe('child')
    if (path.endsWith('/begin') || path.endsWith('/resume')) return {
      uploaded: false, upload_id: 'opaque', size, part_size: 8 * 1024 * 1024,
      part_count: Math.ceil(size / (8 * 1024 * 1024)), uploaded_parts: uploadedParts,
    }
    if (path.endsWith('/sign-part')) {
      const number = Number(body.part_number)
      const partSize = Math.min(8 * 1024 * 1024, size - (number - 1) * 8 * 1024 * 1024)
      const url = `https://storage.invalid/object?part=${String(number)}&signature=private`
      grants.set(url, { md5: String(body.content_md5), size: partSize, number })
      return { method: 'PUT', url, expires_at: '2099-01-01T00:00:00Z', headers: { 'Content-MD5': body.content_md5, 'Content-Length': String(partSize) } }
    }
    if (path.endsWith('/complete')) return { uploaded: true }
    throw new Error('unexpected owner operation')
  })
  let maxChunk = 0
  const sent: number[] = []
  const fetchImpl = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    const receipt = grants.get(String(input)); expect(receipt).toBeDefined()
    expect(init).toMatchObject({ method: 'PUT', redirect: 'error', credentials: 'omit', duplex: 'half' })
    const headers = new Headers(init?.headers); expect(headers.has('authorization')).toBe(false); expect(headers.has('cookie')).toBe(false)
    let size = 0; const hash = createHash('md5')
    for await (const chunk of init?.body as unknown as AsyncIterable<Buffer>) {
      maxChunk = Math.max(maxChunk, chunk.length); size += chunk.length; hash.update(chunk)
    }
    expect(size).toBe(receipt?.size); expect(hash.digest('base64')).toBe(receipt?.md5)
    sent.push(receipt!.number)
    return new Response(null, { status: 200 })
  }) as unknown as typeof fetch
  return { job, bytes, post, fetchImpl, sent, maxChunk: () => maxChunk, resumeParts: (parts: number[]) => { uploadedParts = parts } }
}
function saved(job: RecordingImportJob): Record<string, unknown> {
  return { upload_id: 'opaque', part_size: 8 * 1024 * 1024, child_id: job.childId, source_size: job.fileSize, source_sha256: job.sha256 }
}

describe('recording upload transport', () => {
  it('streams exact parts with bounded memory and checkpoints before byte upload', async () => {
    const f = await fixture(); const progress = vi.fn(async () => undefined); const account = vi.fn(async () => undefined)
    await uploadRecordingFile(f.job, f.post, progress, account, undefined, f.fetchImpl)
    expect(f.sent).toEqual([1, 2]); expect(f.maxChunk()).toBeLessThanOrEqual(128 * 1024)
    expect(progress.mock.calls[0]).toEqual([0, saved(f.job)])
    expect(progress).toHaveBeenLastCalledWith(f.job.fileSize, saved(f.job))
    expect(f.post.mock.calls.map(([path]) => path)).toEqual([
      '/api/v1/audio/uploads/begin', '/api/v1/audio/uploads/sign-part', '/api/v1/audio/uploads/sign-part', '/api/v1/audio/uploads/complete',
    ])
    expect(account.mock.calls.length).toBeGreaterThan(4)
    expect(JSON.stringify(progress.mock.calls)).not.toMatch(/signature|storage.invalid|access_token/u)
  })
  it('rehashes the whole local source but sends only missing cloud parts on resume', async () => {
    const f = await fixture(); f.job.uploadCheckpoint = saved(f.job); f.resumeParts([1])
    await uploadRecordingFile(f.job, f.post, async () => undefined, async () => undefined, undefined, f.fetchImpl)
    expect(f.sent).toEqual([2]); expect(f.post.mock.calls[0]?.[0]).toBe('/api/v1/audio/uploads/resume')
  })
  it('retains the handle after the last part so a crash can resume just completion', async () => {
    const f = await fixture(9); f.job.uploadCheckpoint = saved(f.job); f.resumeParts([1]); const progress = vi.fn(async () => undefined)
    await uploadRecordingFile(f.job, f.post, progress, async () => undefined, undefined, f.fetchImpl)
    expect(f.sent).toEqual([]); expect(progress.mock.calls[0]).toEqual([8, saved(f.job)])
    expect(f.post.mock.calls.at(-1)?.[0]).toBe('/api/v1/audio/uploads/complete')
  })
  it('recognizes an already uploaded object without demanding a released local file', async () => {
    const f = await fixture(9); f.job.sourceHandle = '/unavailable/source'; f.post.mockResolvedValueOnce({ uploaded: true })
    const progress = vi.fn(async () => undefined)
    await uploadRecordingFile(f.job, f.post, progress, async () => undefined, undefined, f.fetchImpl)
    expect(f.sent).toEqual([]); expect(progress).toHaveBeenCalledWith(9); expect(f.post).toHaveBeenCalledTimes(1)
  })
  it('restarts an expired cloud upload and drops retired OSS SDK checkpoint only at the edge', async () => {
    const f = await fixture(9); f.job.uploadCheckpoint = saved(f.job); f.post.mockResolvedValueOnce({ restart_required: true })
    await uploadRecordingFile(f.job, f.post, async () => undefined, async () => undefined, undefined, f.fetchImpl)
    expect(f.post.mock.calls.slice(0, 2).map(([path]) => path)).toEqual(['/api/v1/audio/uploads/resume', '/api/v1/audio/uploads/begin'])
    const old = await fixture(9); old.job.uploadCheckpoint = { uploadId: 'old OSS opaque SDK state' }
    await uploadRecordingFile(old.job, old.post, async () => undefined, async () => undefined, undefined, old.fetchImpl)
    expect(old.post.mock.calls[0]?.[0]).toBe('/api/v1/audio/uploads/begin')
  })
  it('does not complete a source changed underneath a saved resume checkpoint', async () => {
    const f = await fixture(9); f.job.uploadCheckpoint = saved(f.job); f.resumeParts([1]); await writeFile(f.job.sourceHandle, Buffer.alloc(9, 43))
    await expect(uploadRecordingFile(f.job, f.post, async () => undefined, async () => undefined, undefined, f.fetchImpl)).rejects.toMatchObject({ code: 'recording-import-source-changed' })
    expect(f.post.mock.calls.some(([path]) => path.endsWith('/complete'))).toBe(false)
  })
  it('rejects a checkpoint for another child before accessing the owner', async () => {
    const f = await fixture(9); f.job.uploadCheckpoint = { ...saved(f.job), child_id: 'foreign' }
    await expect(uploadRecordingFile(f.job, f.post, async () => undefined, async () => undefined, undefined, f.fetchImpl)).rejects.toMatchObject({ code: 'recording-import-upload-invalid' })
    expect(f.post).not.toHaveBeenCalled()
  })
  it.each([
    { part_size: 3 }, { part_count: 10001 }, { size: 7 }, { uploaded_parts: [1, 1] }, { uploaded_parts: [2] },
  ])('rejects invalid owner layout %j', async extra => {
    const f = await fixture(9); f.post.mockResolvedValueOnce({ uploaded: false, upload_id: 'id', size: 9, part_size: 8388608, part_count: 1, uploaded_parts: [], ...extra })
    await expect(uploadRecordingFile(f.job, f.post, async () => undefined, async () => undefined, undefined, f.fetchImpl)).rejects.toMatchObject({ code: 'recording-import-upload-invalid' })
    expect(f.sent).toEqual([])
  })
  it.each(['http://storage.invalid/part', 'https://user:secret@storage.invalid/part', 'https://storage.invalid/part#fragment'])('rejects unsafe grant %s', async url => {
    const f = await fixture(9); const post = async (path: string, body: Record<string, unknown>) => {
      const result = await f.post(path, body); return path.endsWith('/sign-part') ? { ...result, url } : result
    }
    await expect(uploadRecordingFile(f.job, post, async () => undefined, async () => undefined, undefined, f.fetchImpl)).rejects.toMatchObject({ code: 'recording-import-upload-invalid' })
    expect(f.sent).toEqual([])
  })
  it('sanitizes signed URL failures while retaining a retryable checkpoint', async () => {
    const f = await fixture(9); const progress = vi.fn(async () => undefined)
    const broken = vi.fn(async () => { throw new Error('network failed https://storage.invalid/?signature=SECRET') }) as unknown as typeof fetch
    const error = await uploadRecordingFile(f.job, f.post, progress, async () => undefined, undefined, broken).catch(error => error)
    expect(error).toMatchObject({ code: 'recording-import-part-failed', retryable: true }); expect(error.message).not.toContain('SECRET')
    expect(progress).toHaveBeenCalledWith(0, saved(f.job)); expect(f.post.mock.calls.some(([path]) => path.endsWith('/complete'))).toBe(false)
  })
  it('cancels cloud parts only for a bound modern checkpoint', async () => {
    const f = await fixture(9); f.job.uploadCheckpoint = saved(f.job); const post = vi.fn(async () => ({}))
    await abortRecordingFileUpload(f.job, post)
    expect(post).toHaveBeenCalledWith('/api/v1/audio/uploads/abort', { child_id: 'child', upload_id: 'opaque' })
    post.mockClear(); f.job.uploadCheckpoint = { uploadId: 'retired SDK format' }
    await abortRecordingFileUpload(f.job, post); expect(post).not.toHaveBeenCalled()
  })
  it('does not accept a changed upload handle on resume', async () => {
    const f = await fixture(9); f.job.uploadCheckpoint = saved(f.job)
    f.post.mockResolvedValueOnce({ uploaded: false, upload_id: 'different', size: 9, part_size: 8388608, part_count: 1, uploaded_parts: [] })
    await expect(uploadRecordingFile(f.job, f.post, async () => undefined, async () => undefined, undefined, f.fetchImpl)).rejects.toMatchObject({ code: 'recording-import-upload-invalid' })
    expect(f.sent).toEqual([])
  })
  it('aborts an in-flight body and never advances to completion', async () => {
    const f = await fixture(); const controller = new AbortController(); let streamFinished = false
    const interrupted: typeof fetch = async (_input, init) => {
      try { for await (const _chunk of init?.body as unknown as AsyncIterable<Buffer>) { controller.abort() } } finally { streamFinished = true }
      return new Response(null, { status: 200 })
    }
    await expect(uploadRecordingFile(f.job, f.post, async () => undefined, async () => undefined, controller.signal, interrupted)).rejects.toMatchObject({ code: 'recording-import-cancelled' })
    expect(streamFinished).toBe(true); expect(f.post.mock.calls.some(([path]) => path.endsWith('/complete'))).toBe(false)
  })
})
