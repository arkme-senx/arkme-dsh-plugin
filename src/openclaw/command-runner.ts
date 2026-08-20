import { execFile } from 'node:child_process'
import type { OpenClawCommandRunner } from './cli-adapter.js'

export function createOpenClawCommandRunner(options: { timeoutMs: number; maxOutputBytes?: number; execFileImpl?: typeof execFile }): OpenClawCommandRunner {
  const maxBuffer = options.maxOutputBytes ?? 1024 * 1024
  const runFile = options.execFileImpl ?? execFile
  return async (args, runOptions) => {
    if (runOptions?.stdin !== undefined) throw new Error('OpenClaw stdin is not supported by this runner')
    return await new Promise((resolve, reject) => {
      runFile('openclaw', [...args], {
        encoding: 'utf8',
        timeout: options.timeoutMs,
        maxBuffer,
        signal: runOptions?.signal,
      }, ((error: NodeJS.ErrnoException | null, stdout: string, stderr: string) => {
        if (error?.name === 'AbortError') { reject(error); return }
        if (error !== null && 'killed' in error && error.killed === true) {
          reject(new Error('OpenClaw command timed out'))
          return
        }
        const exitCode = error === null ? 0 : typeof error.code === 'number' ? error.code : 1
        resolve({ exitCode, stdout, stderr: error === null ? stderr : `${stderr}\n${error.message}` })
      }) as never)
    })
  }
}
