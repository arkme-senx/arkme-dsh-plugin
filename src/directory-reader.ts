import type {} from '@deepseek-ai/cordis'
import type { ArkmeDirectoryPage, ArkmeDirectorySectionKind } from './types.js'
import { ArkmePluginError } from './services/service.js'

export interface ArkmeDirectoryReadOptions {
  limit?: number
  cursor?: string
  refresh?: boolean
  countOnly?: boolean
  signal?: AbortSignal
}

export interface ArkmeDirectoryReader {
  list(section: ArkmeDirectorySectionKind, options?: ArkmeDirectoryReadOptions): Promise<ArkmeDirectoryPage>
}

declare module '@deepseek-ai/cordis' {
  interface Context { arkmeDirectory: ArkmeDirectoryReader }
}

/** Transport-neutral dispatch only: each business owner keeps its own projection and credentials. */
export function readDirectoryPage(
  service: { listDirectory(section: ArkmeDirectorySectionKind, options: ArkmeDirectoryReadOptions): Promise<ArkmeDirectoryPage> },
  teams: { listDirectory(options: ArkmeDirectoryReadOptions): Promise<ArkmeDirectoryPage> } | undefined,
  section: ArkmeDirectorySectionKind,
  options: ArkmeDirectoryReadOptions = {},
): Promise<ArkmeDirectoryPage> {
  if (section !== 'teams') return service.listDirectory(section, options)
  if (teams === undefined) throw new ArkmePluginError('team-unavailable', '团队服务尚未就绪', true, 503)
  return teams.listDirectory(options)
}
