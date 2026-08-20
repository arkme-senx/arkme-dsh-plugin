import { describe, expect, it, vi } from 'vitest'
import { createOpenClawCommandRunner } from '../src/openclaw/index.js'

describe('OpenClaw command runner', () => {
  it('uses a fixed executable, argument array, timeout/output bound and AbortSignal', async () => {
    const signal = new AbortController().signal
    const execFileImpl = vi.fn((file, args, options, callback) => {
      callback(null, 'ok', '')
      return {} as never
    })
    const run = createOpenClawCommandRunner({ timeoutMs: 1234, maxOutputBytes: 5678, execFileImpl: execFileImpl as never })

    await expect(run(['--profile', 'dev', 'config', 'validate'], { signal })).resolves.toEqual({ exitCode: 0, stdout: 'ok', stderr: '' })
    expect(execFileImpl).toHaveBeenCalledWith(
      'openclaw',
      ['--profile', 'dev', 'config', 'validate'],
      expect.objectContaining({ timeout: 1234, maxBuffer: 5678, signal }),
      expect.any(Function),
    )
    expect(execFileImpl.mock.calls[0]?.[2]).not.toHaveProperty('shell')
  })

  it('rejects stdin so secrets cannot silently move into an unsupported path', async () => {
    const run = createOpenClawCommandRunner({ timeoutMs: 1000, execFileImpl: vi.fn() as never })
    await expect(run([], { stdin: 'secret' })).rejects.toThrow('stdin is not supported')
  })

  it('propagates cancellation instead of misreporting a profile failure', async () => {
    const aborted = Object.assign(new Error('aborted'), { name: 'AbortError', code: 'ABORT_ERR' })
    const execFileImpl = vi.fn((_file, _args, _options, callback) => {
      callback(aborted, '', '')
      return {} as never
    })
    const run = createOpenClawCommandRunner({ timeoutMs: 1000, execFileImpl: execFileImpl as never })
    await expect(run(['--profile', 'dev'])).rejects.toBe(aborted)
  })
})
