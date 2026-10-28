import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RecordingImportJob } from '../../src/recording-import-contract.js'
import { abortRecordingFileUpload, uploadRecordingFile } from '../../src/services/recording-file-upload.js'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
export async function fixture(size = 8 * 1024 * 1024 + 3) {
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
export function saved(job: RecordingImportJob): Record<string, unknown> {
  return { upload_id: 'opaque', part_size: 8 * 1024 * 1024, child_id: job.childId, source_size: job.fileSize, source_sha256: job.sha256 }
}
