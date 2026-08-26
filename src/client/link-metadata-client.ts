import type { ArkmeLinkMetadata } from '../link-metadata-contract.js'
import { callArkme } from './api.js'

export interface ArkmeLinkMetadataResolver {
  resolve(url: string): Promise<ArkmeLinkMetadata | null>
}

export function arkmeShouldResolveLinkMetadata(url: string): boolean {
  try {
    const hostname = new URL(url).hostname
    return hostname !== '' && !/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname) && !hostname.includes(':')
  } catch {
    return false
  }
}

function metadataDocumentUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl)
    url.hash = ''
    return url.href
  } catch {
    return rawUrl
  }
}

export type ArkmeLinkMetadataHostCall = (
  operation: 'link.metadata',
  params: Record<string, unknown>,
) => Promise<ArkmeLinkMetadata | null>

const defaultHostCall: ArkmeLinkMetadataHostCall = async (operation, params) => {
  return await callArkme<ArkmeLinkMetadata | null>(operation, params)
}

export class ArkmeHostLinkMetadataResolver implements ArkmeLinkMetadataResolver {
  private readonly cache = new Map<string, Promise<ArkmeLinkMetadata | null>>()
  private readonly cacheSize: number

  constructor(
    private readonly callHost: ArkmeLinkMetadataHostCall = defaultHostCall,
    options: { cacheSize?: number } = {},
  ) {
    this.cacheSize = Math.max(1, Math.trunc(options.cacheSize ?? 64))
  }

  async resolve(url: string): Promise<ArkmeLinkMetadata | null> {
    const key = metadataDocumentUrl(url)
    const existing = this.cache.get(key)
    if (existing !== undefined) {
      this.cache.delete(key)
      this.cache.set(key, existing)
      return await existing
    }

    const pending = this.callHost('link.metadata', { url: key }).catch(() => null)
    this.cache.set(key, pending)
    while (this.cache.size > this.cacheSize) {
      const oldest = this.cache.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.cache.delete(oldest)
    }
    return await pending
  }
}

export const arkmeLinkMetadataResolver: ArkmeLinkMetadataResolver = new ArkmeHostLinkMetadataResolver()
