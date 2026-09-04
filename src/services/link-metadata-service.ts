import { lookup as lookupAddress, Resolver } from 'node:dns/promises'
import type { LookupAddress } from 'node:dns'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP, type LookupFunction } from 'node:net'
import {
  arkmeIsGenericLinkMetadataTitle,
  type ArkmeLinkMetadata,
} from '../link-metadata.js'
import { ArkmeRequestCoordinator } from '../request-coordinator.js'
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
const proxySyntheticAddresses = new BlockList()
const globalIpv6Addresses = new BlockList()
globalIpv6Addresses.addSubnet('2000::', 3, 'ipv6')
proxySyntheticAddresses.addSubnet('198.18.0.0', 15, 'ipv4')
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

export function isProxySyntheticNetworkAddress(address: string): boolean {
  const mapped = ipv4FromMappedIpv6(address)
  if (mapped !== undefined) return isIP(mapped) === 4 && proxySyntheticAddresses.check(mapped, 'ipv4')
  return isIP(address) === 4 && proxySyntheticAddresses.check(address, 'ipv4')
}

function isAllowedLinkMetadataAddress(address: string): boolean {
  return isPublicNetworkAddress(address) || isProxySyntheticNetworkAddress(address)
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

function preferredDocumentTitle(candidates: readonly (string | undefined)[]): string {
  for (const candidate of candidates) {
    if (candidate !== undefined && !arkmeIsGenericLinkMetadataTitle(candidate)) return candidate
  }
  return ''
}

function documentMetadata(url: URL, html: string): ArkmeLinkMetadata | null {
  const metadata = new Map<string, string>()
  for (const match of html.matchAll(/<meta\b[^>]*>/giu)) {
    const attributes = tagAttributes(match[0])
    const property = (attributes.get('property') ?? attributes.get('name') ?? '').toLowerCase()
    if (property === '' || metadata.has(property)) continue
    const content = normalizedTitle(attributes.get('content') ?? '')
    if (content !== '') metadata.set(property, content)
  }
  const documentTitle = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/iu.exec(html)?.[1]
  const title = preferredDocumentTitle([
    metadata.get('og:title'),
    metadata.get('twitter:title'),
    documentTitle === undefined ? undefined : normalizedTitle(documentTitle),
  ])
  if (title === '') return null
  const description = metadata.get('og:description') ?? metadata.get('description')
  const siteName = metadata.get('og:site_name') ?? url.hostname.replace(/^www\./iu, '')
  return {
    url: url.href,
    title,
    ...(description === undefined ? {} : { description }),
    ...(siteName === '' ? {} : { siteName }),
  }
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

function missingDnsAnswer(error: unknown): boolean {
  const code = error !== null && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  return code === 'ENODATA' || code === 'ENOTFOUND' || code === 'ENONAME'
}

export interface ArkmeHostAddressResolver {
  lookup(hostname: string, options?: { signal?: AbortSignal }): Promise<LookupAddress[]>
}

export interface ArkmeCancelableDnsResolver {
  resolve4(hostname: string): Promise<string[]>
  resolve6(hostname: string): Promise<string[]>
  cancel(): void
}

export type ArkmeSystemAddressLookup = (hostname: string) => Promise<LookupAddress[]>

export interface ArkmePinnedDocumentTransport {
  read(
    url: URL,
    addresses: readonly LookupAddress[],
    options?: { signal?: AbortSignal },
  ): Promise<ArkmeLinkDocument>
}

export class NodeArkmeHostAddressResolver implements ArkmeHostAddressResolver {
  constructor(
    private readonly resolverFactory: () => ArkmeCancelableDnsResolver = () => new Resolver(),
    private readonly systemLookup: ArkmeSystemAddressLookup = async hostname =>
      await lookupAddress(hostname, { all: true, verbatim: true }),
  ) {}

  async lookup(hostname: string, options: { signal?: AbortSignal } = {}): Promise<LookupAddress[]> {
    options.signal?.throwIfAborted()
    const resolver = this.resolverFactory()
    const abort = () => { resolver.cancel() }
    options.signal?.addEventListener('abort', abort, { once: true })
    try {
      const [ipv4, ipv6] = await Promise.all([
        resolver.resolve4(hostname).catch(error => {
          if (missingDnsAnswer(error)) return []
          throw error
        }),
        resolver.resolve6(hostname).catch(error => {
          if (missingDnsAnswer(error)) return []
          throw error
        }),
      ])
      options.signal?.throwIfAborted()
      return [
        ...ipv4.map(address => ({ address, family: 4 as const })),
        ...ipv6.map(address => ({ address, family: 6 as const })),
      ]
    } catch (error) {
      options.signal?.throwIfAborted()
      try {
        const addresses = await this.systemLookup(hostname)
        options.signal?.throwIfAborted()
        return addresses
      } catch {
        throw error
      }
    } finally {
      options.signal?.removeEventListener('abort', abort)
    }
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
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
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
    if (addresses.length === 0 || addresses.some(item => !isAllowedLinkMetadataAddress(item.address))) {
      throw new ArkmePluginError('link-metadata-url-unsafe', '该网址不允许解析标题', false, 400)
    }
    return await this.transport.read(url, addresses, options)
  }
}

export class ArkmeLinkMetadataService {
  private readonly lifecycle = new AbortController()
  private readonly timeoutMs: number
  private readonly coordinator: ArkmeRequestCoordinator

  constructor(
    private readonly reader: ArkmeLinkDocumentReader = new NodeArkmeLinkDocumentReader(),
    options: { maxConcurrent?: number; maxQueue?: number; timeoutMs?: number } = {},
  ) {
    const maxConcurrent = Math.max(1, Math.trunc(options.maxConcurrent ?? 4))
    const maxQueue = Math.max(1, Math.trunc(options.maxQueue ?? 32))
    const burst = maxConcurrent + maxQueue
    this.timeoutMs = Math.max(1, Math.trunc(options.timeoutMs ?? LINK_METADATA_TIMEOUT_MS))
    this.coordinator = new ArkmeRequestCoordinator({
      laneLimits: {
        'background-read': { maxConcurrent, maxQueued: maxQueue, burst, ratePerSecond: burst },
      },
      serviceLimits: {
        other: { maxConcurrent, maxQueued: maxQueue, burst, ratePerSecond: burst },
      },
    })
  }

  async resolve(
    rawUrl: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeLinkMetadata | null> {
    if (this.lifecycle.signal.aborted) {
      throw new ArkmePluginError('link-metadata-disposed', '网址名称解析服务已停止', true, 503)
    }
    const initialUrl = safeWebUrl(rawUrl)
    initialUrl.hash = ''
    const deadlineAt = Date.now() + this.timeoutMs
    const deadline = new AbortController()
    const deadlineTimer = setTimeout(() => {
      deadline.abort(this.timeoutError())
    }, this.timeoutMs)
    const signal = AbortSignal.any([
      this.lifecycle.signal,
      deadline.signal,
      ...(options.signal === undefined ? [] : [options.signal]),
    ])
    try {
      const metadata = await this.coordinator.run({
        scope: 'link-metadata',
        lane: 'background-read',
        service: 'other',
        signal,
        operation: async operationSignal => {
          if (Date.now() >= deadlineAt) throw this.timeoutError()
          return await this.load(initialUrl, operationSignal)
        },
      })
      return metadata
    } catch {
      if (this.lifecycle.signal.aborted) throw this.lifecycle.signal.reason
      return null
    } finally {
      clearTimeout(deadlineTimer)
    }
  }

  dispose(): void {
    this.lifecycle.abort(new ArkmePluginError('link-metadata-disposed', '网址名称解析服务已停止', true, 503))
    this.coordinator.dispose()
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
      return documentMetadata(url, document.body)
    }
    return null
  }
}
