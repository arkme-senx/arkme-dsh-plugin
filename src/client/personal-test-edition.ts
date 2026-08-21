export const ARKME_PERSONAL_TEST_EDITION_STORAGE_KEY = 'arkme.personal-test-edition.v1'

export type ArkmePersonalTestSurface = 'calls' | 'recordings'

export interface ArkmePersonalTestEdition {
  version: 1
  owner: string
  defaultSurface: ArkmePersonalTestSurface
}

interface ArkmePersonalTestEditionStorage {
  getItem(key: string): string | null
  setItem?(key: string, value: string): void
}

function browserStorage(): ArkmePersonalTestEditionStorage | undefined {
  try {
    return typeof globalThis.localStorage === 'undefined' ? undefined : globalThis.localStorage
  } catch {
    return undefined
  }
}

export function parseArkmePersonalTestEdition(value: string | null): ArkmePersonalTestEdition | undefined {
  if (value === null || value.trim() === '') return undefined
  try {
    const parsed = JSON.parse(value) as Partial<ArkmePersonalTestEdition>
    const owner = typeof parsed.owner === 'string' ? parsed.owner.trim() : ''
    if (parsed.version !== 1 || owner === '' || owner.length > 40) return undefined
    if (parsed.defaultSurface !== 'calls' && parsed.defaultSurface !== 'recordings') return undefined
    return { version: 1, owner, defaultSurface: parsed.defaultSurface }
  } catch {
    return undefined
  }
}

export function parseArkmePersonalTestEditionSearch(search: string): ArkmePersonalTestEdition | undefined {
  try {
    const params = new URLSearchParams(search)
    const owner = params.get('arkmePersonalTestOwner')?.trim() ?? ''
    const defaultSurface = params.get('arkmePersonalTestSurface')
    if (owner === '' || owner.length > 40) return undefined
    if (defaultSurface !== 'calls' && defaultSurface !== 'recordings') return undefined
    return { version: 1, owner, defaultSurface }
  } catch {
    return undefined
  }
}

function browserSearch(): string {
  try {
    return globalThis.location?.search ?? ''
  } catch {
    return ''
  }
}

export function readArkmePersonalTestEdition(
  storage: ArkmePersonalTestEditionStorage | undefined = browserStorage(),
  search = browserSearch(),
): ArkmePersonalTestEdition | undefined {
  try {
    const stored = parseArkmePersonalTestEdition(storage?.getItem(ARKME_PERSONAL_TEST_EDITION_STORAGE_KEY) ?? null)
    if (stored !== undefined) return stored
    const bootstrapped = parseArkmePersonalTestEditionSearch(search)
    if (bootstrapped === undefined) return undefined
    storage?.setItem?.(ARKME_PERSONAL_TEST_EDITION_STORAGE_KEY, JSON.stringify(bootstrapped))
    return bootstrapped
  } catch {
    return undefined
  }
}

export function arkmePersonalTestEditionLabel(edition: ArkmePersonalTestEdition): string {
  return `${edition.owner} · 个人测试版`
}
