import { afterEach, describe, expect, it, vi } from 'vitest'
import { uploadRecordingFile } from '../src/services/recording-file-upload.js'
import { waitForRecordingUploadRetry } from '../src/services/recording-import-upload-retry.js'
import { fixture, saved } from './fixtures/recording-upload.js'
vi.mock('../src/services/recording-import-upload-retry.js', async load => ({
  ...await load<typeof import('../src/services/recording-import-upload-retry.js')>(),
  waitForRecordingUploadRetry: vi.fn(async () => {}),
}))
afterEach(() => { vi.mocked(waitForRecordingUploadRetry).mockReset().mockResolvedValue(undefined) })

describe('provider-independent recording upload recovery', () => {
  it.each([408,429,500,502,503,504])('retries transient HTTP %d with a fresh grant and identical bytes', async status => {
    const f = await fixture(9)
    const fetch = vi.fn().mockResolvedValueOnce(new Response(null,{status})).mockImplementation(f.fetchImpl)
    await uploadRecordingFile(f.job,f.post,async()=>{},async()=>{},undefined,fetch)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(f.sent).toEqual([1])
    expect(f.post.mock.calls.filter(([path])=>path.endsWith('/sign-part'))).toHaveLength(2)
    expect(waitForRecordingUploadRetry).toHaveBeenCalledWith(1000,undefined)
  })
  it.each(['ECONNRESET','ETIMEDOUT','EAI_AGAIN'])('retries the fetch cause %s without exposing signed URLs', async code => {
    const f = await fixture(9)
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('private signed URL',{cause:{code}})).mockImplementation(f.fetchImpl)
    await uploadRecordingFile(f.job,f.post,async()=>{},async()=>{},undefined,fetch)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it.each([401,403,404])('does not retry permanent HTTP %d', async status => {
    const f = await fixture(9), fetch = vi.fn(async()=>new Response(null,{status}))
    await expect(uploadRecordingFile(f.job,f.post,async()=>{},async()=>{},undefined,fetch)).rejects.toMatchObject({code:'recording-import-part-failed'})
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(waitForRecordingUploadRetry).not.toHaveBeenCalled()
  })
  it('exhausts five retries, retains the checkpoint and manually resumes only missing parts', async () => {
    const f = await fixture(), progress = vi.fn(async()=>{})
    const fetch = vi.fn().mockImplementationOnce(f.fetchImpl).mockResolvedValue(new Response(null,{status:503}))
    await expect(uploadRecordingFile(f.job,f.post,progress,async()=>{},undefined,fetch)).rejects.toMatchObject({code:'recording-import-part-failed',retryable:true})
    expect(fetch).toHaveBeenCalledTimes(7)
    expect(vi.mocked(waitForRecordingUploadRetry).mock.calls.map(([delay])=>delay)).toEqual([1000,2000,4000,8000,16000])
    expect(progress).toHaveBeenLastCalledWith(8388608,saved(f.job))
    f.job.uploadCheckpoint=saved(f.job);f.resumeParts([1])
    await uploadRecordingFile(f.job,f.post,progress,async()=>{},undefined,f.fetchImpl)
    expect(f.sent).toEqual([1,2])
    expect(progress).toHaveBeenLastCalledWith(f.job.fileSize,saved(f.job))
  })
  it('cancels during backoff without starting another request', async () => {
    const f=await fixture(9),controller=new AbortController(),fetch=vi.fn(async()=>new Response(null,{status:503}))
    vi.mocked(waitForRecordingUploadRetry).mockImplementationOnce(async()=>{controller.abort()})
    await expect(uploadRecordingFile(f.job,f.post,async()=>{},async()=>{},controller.signal,fetch)).rejects.toMatchObject({code:'recording-import-cancelled'})
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('rechecks the account after backoff before another signed request', async () => {
    const f=await fixture(9),fetch=vi.fn(async()=>new Response(null,{status:503}))
    let changed=false
    vi.mocked(waitForRecordingUploadRetry).mockImplementationOnce(async()=>{changed=true})
    const account=async()=>{if(changed)throw new Error('account changed')}
    await expect(uploadRecordingFile(f.job,f.post,async()=>{},account,undefined,fetch)).rejects.toThrow('account changed')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('does not retry progress persistence failures that resemble transport errors', async () => {
    const f=await fixture(9),progress=vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce({code:'ETIMEDOUT'})
    await expect(uploadRecordingFile(f.job,f.post,progress,async()=>{},undefined,f.fetchImpl)).rejects.toEqual({code:'ETIMEDOUT'})
    expect(waitForRecordingUploadRetry).not.toHaveBeenCalled()
    expect(f.post.mock.calls.some(([path])=>path.endsWith('/complete'))).toBe(false)
  })
})
