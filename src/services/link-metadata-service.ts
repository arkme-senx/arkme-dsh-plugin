import { lookup } from 'node:dns/promises'
import type { LookupAddress } from 'node:dns'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP, type LookupFunction } from 'node:net'
import type { ArkmeLinkMetadata } from '../link-metadata-contract.js'
import { ArkmePluginError } from './service.js'

const MAX_LINK_METADATA_BYTES = 2 * 1024 * 1024
const LINK_METADATA_TIMEOUT_MS = 8_000
const LINK_METADATA_IDLE_TIMEOUT_MS = 4_000
const MAX_LINK_METADATA_REDIRECTS = 3
const MAX_LINK_TITLE_LENGTH = 300
const MAX_LINK_URL_LENGTH = 4_096

export interface ArkmeLinkDocument {
  status: number
  contentType?: string
  location?: string
  body: string
}

export interface ArkmeLinkDocumentReader {
  read(url: URL, options?: { signal?: AbortSignal }): Promise<ArkmeLinkDocument>
}

const blockedAddresses = new BlockList()
const globalIpv6Addresses = new BlockList()
globalIpv6Addresses.addSubnet('2000::', 3, 'ipv6')
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blockedAddresses.addSubnet(network, prefix, 'ipv4')
for (const [network, prefix] of [
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20],
] as const) blockedAddresses.addSubnet(network, prefix, 'ipv6')

function hostWithoutBrackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

function ipv4FromMappedIpv6(address: string): string | undefined {
  const match = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/iu.exec(address)
  return match?.[1]
}

export function isPublicNetworkAddress(address: string): boolean {
  const mapped = ipv4FromMappedIpv6(address)
  if (mapped !== undefined) return isIP(mapped) === 4 && !blockedAddresses.check(mapped, 'ipv4')
  const family = isIP(address)
  if (family === 4) return !blockedAddresses.check(address, 'ipv4')
  if (family === 6) {
    return globalIpv6Addresses.check(address, 'ipv6') && !blockedAddresses.check(address, 'ipv6')
  }
  return false
}

function safeWebUrl(raw: string | URL): URL {
  let url: URL
  try {
    url = raw instanceof URL ? new URL(raw.href) : new URL(raw)
  } catch (error) {
    throw new ArkmePluginError('link-metadata-url-invalid', '网址格式无效', false, 400, { cause: error })
  }
  const hostname = hostWithoutBrackets(url.hostname).toLowerCase()
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:')
    || url.username !== ''
    || url.password !== ''
    || url.href.length > MAX_LINK_URL_LENGTH
    || hostname === ''
    || hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || isIP(hostname) !== 0
  ) {
    throw new ArkmePluginError('link-metadata-url-unsafe', '该网址不允许解析标题', false, 400)
  }
  return url
}

function entityValue(value: string): string {
  if (/^#x[\da-f]+$/iu.test(value)) return String.fromCodePoint(Number.parseInt(value.slice(2), 16))
  if (/^#\d+$/u.test(value)) return String.fromCodePoint(Number.parseInt(value.slice(1), 10))
  return ({ amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"' } as Record<string, string>)[value.toLowerCase()] ?? `&${value};`
}

function normalizedTitle(value: string): string {
  const withoutTags = value.replace(/<[^>]*>/gu, ' ')
  const decoded = withoutTags.replace(/&(#x[\da-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/giu, (_match, entity: string) => {
    try { return entityValue(entity) } catch { return '' }
  })
  return decoded.replace(/[\u0000-\u001f\u007f\s]+/gu, ' ').trim().slice(0, MAX_LINK_TITLE_LENGTH)
}

function tagAttributes(tag: string): ReadonlyMap<string, string> {
  const attributes = new Map<string, string>()
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu
  for (const match of tag.matchAll(pattern)) {
    const name = match[1]?.toLowerCase()
    if (name !== undefined) attributes.set(name, match[2] ?? match[3] ?? match[4] ?? '')
  }
  return attributes
}

function documentTitle(html: string): string {
  for (const match of html.matchAll(/<meta\b[^>]*>/giu)) {
    const attributes = tagAttributes(match[0])
    const property = (attributes.get('property') ?? attributes.get('name') ?? '').toLowerCase()
    if (property !== 'og:title') continue
    const title = normalizedTitle(attributes.get('content') ?? '')
    if (title !== '') return title
  }
  const title = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/iu.exec(html)?.[1]
  return title === undefined ? '' : normalizedTitle(title)
}

function redirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

function isHtmlContentType(contentType: string | undefined): boolean {
  return contentType === undefined || /^text\/html\b|^application\/xhtml\+xml\b/iu.test(contentType)
}

function pluginError(error: unknown): ArkmePluginError {
  if (error instanceof ArkmePluginError) return error
  return new ArkmePluginError('link-metadata-fetch-failed', '网址名称解析失败', true, 502, { cause: error })
}

async function lookupAddresses(hostname: string, signal?: AbortSignal): Promise<LookupAddress[]> {
  if (signal?.aborted === true) throw signal.reason
  return await new Promise<LookupAddress[]>((resolve, reject) => {
    let settled = false
    const finish = (error?: unknown, value?: LookupAddress[]) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      if (error !== undefined) reject(error)
      else resolve(value ?? [])
    }
    const abort = () => { finish(signal?.reason ?? new Error('aborted')) }
    signal?.addEventListener('abort', abort, { once: true })
    void lookup(hostname, { all: true, order: 'ipv4first' }).then(
      addresses => { finish(undefined, addresses) },
      error => { finish(error) },
    )
  })
}

export interface ArkmeHostAddressResolver {
  lookup(hostname: string, options?: { signal?: AbortSignal }): Promise<LookupAddress[]>
}

export interface ArkmePinnedDocumentTransport {
  read(
    url: URL,
    addresses: readonly LookupAddress[],
    options?: { signal?: AbortSignal },
  ): Promise<ArkmeLinkDocument>
}

interface ArkmeQueuedLinkMetadataLoad {
  signal: AbortSignal
  deadlineAt: number
  resolve: () => void
  reject: (reason: unknown) => void
}

class NodeArkmeHostAddressResolver implements ArkmeHostAddressResolver {
  async lookup(hostname: string, options: { signal?: AbortSignal } = {}): Promise<LookupAddress[]> {
    return await lookupAddresses(hostname, options.signal)
  }
}

export class NodeArkmePinnedDocumentTransport implements ArkmePinnedDocumentTransport {
  private readonly maxBytes: number
  private readonly idleTimeoutMs: number

  constructor(options: { maxBytes?: number; idleTimeoutMs?: number } = {}) {
    this.maxBytes = Math.max(1, Math.trunc(options.maxBytes ?? MAX_LINK_METADATA_BYTES))
    this.idleTimeoutMs = Math.max(1, Math.trunc(options.idleTimeoutMs ?? LINK_METADATA_IDLE_TIMEOUT_MS))
  }

  async read(
    url: URL,
    addresses: readonly LookupAddress[],
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeLinkDocument> {
    const address = addresses[0]
    if (address === undefined) throw new ArkmePluginError('link-metadata-fetch-failed', '网址名称解析失败', true, 502)
    const pinnedLookup: LookupFunction = (_requestedHost, lookupOptions, callback) => {
      if (lookupOptions.all === true) callback(null, [...addresses])
      else callback(null, address.address, address.family)
    }
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest
    return await new Promise<ArkmeLinkDocument>((resolve, reject) => {
      let settled = false
      const finish = (error?: unknown, value?: ArkmeLinkDocument) => {
        if (settled) return
        settled = true
        if (error !== undefined) reject(pluginError(error))
        else if (value !== undefined) resolve(value)
      }
      const req = request(url, {
        method: 'GET',
        lookup: pinnedLookup,
        signal: options.signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
          'Accept-Encoding': 'identity',
          'User-Agent': 'Arkme-Link-Metadata/1.0',
        },
      }, response => {
        const chunks: Buffer[] = []
        let bytes = 0
        let headProbe = ''
        const status = response.statusCode ?? 0
        const contentType = typeof response.headers['content-type'] === 'string'
          ? response.headers['content-type']
          : undefined
        const location = typeof response.headers.location === 'string' ? response.headers.location : undefined
        const complete = () => finish(undefined, {
          status,
          ...(contentType === undefined ? {} : { contentType }),
          ...(location === undefined ? {} : { location }),
          body: Buffer.concat(chunks).toString('utf8'),
        })
        if (redirectStatus(status) || status < 200 || status >= 300 || !isHtmlContentType(contentType)) {
          complete()
          response.destroy()
          return
        }
        response.on('data', (chunk: Buffer | string) => {
          if (settled) return
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          bytes += buffer.byteLength
          if (bytes > this.maxBytes) {
            finish(new ArkmePluginError('link-metadata-response-too-large', '网址内容过大，无法解析名称', false, 413))
            response.destroy()
            return
          }
          chunks.push(buffer)
          const lowerChunk = buffer.toString('utf8').toLowerCase()
          if (`${headProbe}${lowerChunk}`.includes('</head>')) {
            complete()
            response.destroy()
          }
          headProbe = lowerChunk.slice(-6)
        })
        response.once('end', () => {
          if (response.complete) complete()
          else finish(new Error('link metadata response ended before completion'))
        })
        response.once('close', () => {
          if (!settled && response.complete) complete()
          else if (!settled) finish(new Error('link metadata response closed before completion'))
        })
        response.once('aborted', () => { if (!settled) finish(new Error('link metadata response aborted')) })
        response.once('error', error => { if (!settled) finish(error) })
      })
      req.setTimeout(this.idleTimeoutMs, () => {
        req.destroy(new ArkmePluginError('link-metadata-idle-timeout', '网址名称解析超时', true, 504))
      })
      req.once('error', error => finish(error))
      req.end()
    })
  }
}

export class NodeArkmeLinkDocumentReader implements ArkmeLinkDocumentReader {
  constructor(
    private readonly resolver: ArkmeHostAddressResolver = new NodeArkmeHostAddressResolver(),
    private readonly transport: ArkmePinnedDocumentTransport = new NodeArkmePinnedDocumentTransport(),
  ) {}

  async read(url: URL, options: { signal?: AbortSignal } = {}): Promise<ArkmeLinkDocument> {
    const hostname = hostWithoutBrackets(url.hostname)
    let addresses: LookupAddress[]
    try {
      addresses = await this.resolver.lookup(hostname, options)
    } catch (error) {
      throw pluginError(error)
    }
    if (addresses.length === 0 || addresses.some(item => !isPublicNetworkAddress(item.address))) {
      throw new ArkmePluginError('link-metadata-url-unsafe', '该网址不允许解析标题', false, 400)
    }
    return await this.transport.read(url, addresses, options)
  }
}

export class ArkmeLinkMetadataService {
  private readonly cache = new Map<string, ArkmeLinkMetadata>()
  private readonly inFlight = new Map<string, Promise<ArkmeLinkMetadata | null>>()
  private readonly cacheSize: number
  private readonly lifecycle = new AbortController()
  private readonly maxConcurrent: number
  private readonly maxQueue: number
  private readonly timeoutMs: number
  private activeLoads = 0
  private readonly queuedLoads: ArkmeQueuedLinkMetadataLoad[] = []

  constructor(
    private readonly reader: ArkmeLinkDocumentReader = new NodeArkmeLinkDocumentReader(),
    options: { cacheSize?: number; maxConcurrent?: number; maxQueue?: number; timeoutMs?: number } = {},
  ) {
    this.cacheSize = Math.max(1, Math.trunc(options.cacheSize ?? 64))
    this.maxConcurrent = Math.max(1, Math.trunc(options.maxConcurrent ?? 4))
    this.maxQueue = Math.max(0, Math.trunc(options.maxQueue ?? 32))
    this.timeoutMs = Math.max(1, Math.trunc(options.timeoutMs ?? LINK_METADATA_TIMEOUT_MS))
  }

  async resolve(rawUrl: string): Promise<ArkmeLinkMetadata | null> {
    if (this.lifecycle.signal.aborted) {
      throw new ArkmePluginError('link-metadata-disposed', '网址名称解析服务已停止', true, 503)
    }
    const initialUrl = safeWebUrl(rawUrl)
    initialUrl.hash = ''
    const key = initialUrl.href
    const cached = this.cache.get(key)
    if (cached !== undefined) {
      this.cache.delete(key)
      this.cache.set(key, cached)
      return cached
    }
    const pending = this.inFlight.get(key)
    if (pending !== undefined) return await pending

    const deadlineAt = Date.now() + this.timeoutMs
    const deadline = new AbortController()
    const deadlineTimer = setTimeout(() => {
      deadline.abort(new ArkmePluginError('link-metadata-timeout', '网址名称解析超时', true, 504))
    }, this.timeoutMs)
    const signal = AbortSignal.any([this.lifecycle.signal, deadline.signal])
    const load = this.schedule(async () => await this.load(initialUrl, signal), signal, deadlineAt)
      .catch(error => {
        const known = pluginError(error)
        if (known.code === 'link-metadata-disposed') throw known
        return null
      })
      .then(value => {
        if (this.lifecycle.signal.aborted) throw this.lifecycle.signal.reason
        if (value === null) return null
        this.cache.set(key, value)
        while (this.cache.size > this.cacheSize) {
          const oldest = this.cache.keys().next().value as string | undefined
          if (oldest === undefined) break
          this.cache.delete(oldest)
        }
        return value
      })
      .finally(() => {
        clearTimeout(deadlineTimer)
        this.inFlight.delete(key)
      })
    this.inFlight.set(key, load)
    return await load
  }

  dispose(): void {
    this.lifecycle.abort(new ArkmePluginError('link-metadata-disposed', '网址名称解析服务已停止', true, 503))
    this.cache.clear()
    this.inFlight.clear()
  }

  private async schedule(
    load: () => Promise<ArkmeLinkMetadata | null>,
    signal: AbortSignal,
    deadlineAt: number,
  ): Promise<ArkmeLinkMetadata | null> {
    const acquisition = this.acquireSlot(signal, deadlineAt)
    const acquired = typeof acquisition === 'boolean' ? acquisition : await acquisition
    if (!acquired) return null
    try {
      if (signal.aborted) throw signal.reason
      if (Date.now() >= deadlineAt) throw this.timeoutError()
      return await load()
    } finally {
      this.activeLoads -= 1
      this.drainQueue()
    }
  }

  private acquireSlot(signal: AbortSignal, deadlineAt: number): boolean | Promise<boolean> {
    if (signal.aborted) throw signal.reason
    if (Date.now() >= deadlineAt) throw this.timeoutError()
    if (this.activeLoads < this.maxConcurrent) {
      this.activeLoads += 1
      return true
    }
    if (this.queuedLoads.length >= this.maxQueue) return false

    return new Promise<boolean>((resolve, reject) => {
      const waiter: ArkmeQueuedLinkMetadataLoad = {
        signal,
        deadlineAt,
        resolve: () => {
          signal.removeEventListener('abort', abort)
          resolve(true)
        },
        reject: reason => {
          signal.removeEventListener('abort', abort)
          reject(reason)
        },
      }
      const abort = () => {
        const index = this.queuedLoads.indexOf(waiter)
        if (index < 0) return
        this.queuedLoads.splice(index, 1)
        waiter.reject(signal.reason)
        this.drainQueue()
      }
      signal.addEventListener('abort', abort, { once: true })
      this.queuedLoads.push(waiter)
    })
  }

  private drainQueue(): void {
    while (this.activeLoads < this.maxConcurrent) {
      const waiter = this.queuedLoads.shift()
      if (waiter === undefined) return
      if (waiter.signal.aborted) {
        waiter.reject(waiter.signal.reason)
        continue
      }
      if (Date.now() >= waiter.deadlineAt) {
        waiter.reject(this.timeoutError())
        continue
      }
      this.activeLoads += 1
      waiter.resolve()
    }
  }

  private timeoutError(): ArkmePluginError {
    return new ArkmePluginError('link-metadata-timeout', '网址名称解析超时', true, 504)
  }

  private async load(initialUrl: URL, signal: AbortSignal): Promise<ArkmeLinkMetadata | null> {
    let url = initialUrl
    for (let redirect = 0; redirect <= MAX_LINK_METADATA_REDIRECTS; redirect += 1) {
      let document: ArkmeLinkDocument
      try {
        document = await this.reader.read(url, { signal })
      } catch (error) {
        throw pluginError(error)
      }
      if (redirectStatus(document.status) && document.location !== undefined) {
        if (redirect === MAX_LINK_METADATA_REDIRECTS) {
          throw new ArkmePluginError('link-metadata-redirect-limit', '网址跳转次数过多', false, 400)
        }
        try {
          url = safeWebUrl(new URL(document.location, url))
        } catch (error) {
          if (error instanceof ArkmePluginError && error.code === 'link-metadata-url-unsafe') throw error
          throw new ArkmePluginError('link-metadata-redirect-invalid', '网址跳转地址无效', false, 400, { cause: error })
        }
        continue
      }
      if (document.status < 200 || document.status >= 300) return null
      if (!isHtmlContentType(document.contentType)) return null
      const title = documentTitle(document.body)
      return title === '' ? null : { url: url.href, title }
    }
    return null
  }
}
