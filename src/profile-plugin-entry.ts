import { lstat, unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'

export type ManagedProfilePluginEntry = 'missing' | 'detached' | 'directory'

export async function detachManagedProfilePluginLink(options: {
  dshHome: string
  profileName: string
}): Promise<ManagedProfilePluginEntry> {
  validateProfileName(options.profileName)
  const pluginPath = join(
    resolve(options.dshHome),
    'profiles',
    options.profileName,
    'node_modules',
    '@senguoyun',
    'dsh-arkme',
  )
  try {
    const stat = await lstat(pluginPath)
    if (stat.isSymbolicLink()) {
      await unlink(pluginPath)
      return 'detached'
    }
    if (stat.isDirectory()) return 'directory'
    throw new Error(`managed Profile plugin entry is neither a link nor a directory: ${pluginPath}`)
  } catch (error) {
    if (isMissing(error)) return 'missing'
    throw error
  }
}

function validateProfileName(profileName: string): void {
  if (
    profileName === ''
    || profileName === '.'
    || profileName === '..'
    || profileName.includes('/')
    || profileName.includes('\\')
  ) {
    throw new Error('DSH profile name must be a single path segment')
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
