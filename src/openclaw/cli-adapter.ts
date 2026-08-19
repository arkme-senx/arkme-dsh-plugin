export interface OpenClawCommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

export interface OpenClawCommandRunner {
  (args: readonly string[], options?: { stdin?: string }): Promise<OpenClawCommandResult>
}

export type OpenClawPreflightResult =
  | { status: 'profile_not_found' }
  | { status: 'prerequisite_failed'; reason: 'version' | 'config' | 'model_auth' }
  | { status: 'ready'; version: string }

export interface OpenClawCliAdapter {
  preflight(): Promise<OpenClawPreflightResult>
}

function profileArgs(profile: string, ...command: string[]): readonly string[] {
  return ['--profile', profile, ...command]
}

function parseVersion(stdout: string): string | undefined {
  return /OpenClaw\s+([^\s]+)/.exec(stdout)?.[1]
}

export function createOpenClawCliAdapter(options: {
  profile: string
  run: OpenClawCommandRunner
}): OpenClawCliAdapter {
  const profile = options.profile.trim()
  return {
    async preflight() {
      const profileFile = await options.run(profileArgs(profile, 'config', 'file'))
      if (profileFile.exitCode !== 0 || profileFile.stdout.trim() === '') {
        return { status: 'profile_not_found' }
      }

      const configResult = await options.run(profileArgs(profile, 'config', 'validate'))
      if (configResult.exitCode !== 0) {
        const configOutput = `${configResult.stdout}\n${configResult.stderr}`
        if (/config file not found/i.test(configOutput)) {
          return { status: 'profile_not_found' }
        }
        return { status: 'prerequisite_failed', reason: 'config' }
      }

      const versionResult = await options.run(profileArgs(profile, '--version'))
      const version = versionResult.exitCode === 0 ? parseVersion(versionResult.stdout) : undefined
      if (version === undefined) {
        return { status: 'prerequisite_failed', reason: 'version' }
      }

      const modelResult = await options.run(profileArgs(profile, 'models', 'status'))
      const modelOutput = `${modelResult.stdout}\n${modelResult.stderr}`
      const modelAuthMissing = /\bMissing auth\b/i.test(modelOutput) || /effective=missing(?::missing)?/i.test(modelOutput)
      if (modelResult.exitCode !== 0 || !/Default\s*:/i.test(modelResult.stdout) || modelAuthMissing) {
        return { status: 'prerequisite_failed', reason: 'model_auth' }
      }

      await options.run(profileArgs(profile, 'gateway', 'status'))
      return { status: 'ready', version }
    },
  }
}
