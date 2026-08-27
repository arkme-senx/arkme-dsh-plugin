import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { ArkmeLinkText } from '../src/client/ArkmeLinkText.js'
import {
  ArkmeHostLinkMetadataResolver,
  type ArkmeLinkMetadataResolver,
} from '../src/client/link-metadata-client.js'

function expectLinkLabel(renderer: ReturnType<typeof create>, label: string): void {
  expect(renderer.root.findByProps({ 'data-arkme-link-label': 'true' }).children).toEqual([label])
  expect(renderer.root.findAll(node => node.type === 'svg' && node.props['data-arkme-link-icon'] === 'true')).toHaveLength(1)
}

describe('Arkme link metadata presentation', () => {
  it('keeps the raw clickable URL first, then replaces only its label with the resolved title', async () => {
    const pending = Promise.withResolvers<{ url: string; title: string } | null>()
    const resolver: ArkmeLinkMetadataResolver = { resolve: vi.fn(async () => await pending.promise) }
    let renderer: ReturnType<typeof create>

    await act(async () => { renderer = create(<ArkmeLinkText text="查看 https://jotmo.ai/path" metadataResolver={resolver} />) })
    let anchor = renderer!.root.findByProps({ 'data-arkme-text-link': 'true' })
    expect(anchor.props.href).toBe('https://jotmo.ai/path')
    expectLinkLabel(renderer!, 'https://jotmo.ai/path')

    await act(async () => {
      pending.resolve({ url: 'https://jotmo.ai/path', title: '即我 Jotmo' })
      await pending.promise
    })
    anchor = renderer!.root.findByProps({ 'data-arkme-text-link': 'true' })
    expect(anchor.props.href).toBe('https://jotmo.ai/path')
    expect(anchor.props.title).toBe('https://jotmo.ai/path')
    expect(anchor.props['data-arkme-link-title']).toBe('resolved')
    expectLinkLabel(renderer!, '即我 Jotmo')
  })

  it('keeps a resolved title within the available line width without changing its navigation target', async () => {
    const longTitle = '即我网址名称'.repeat(80)
    const resolver: ArkmeLinkMetadataResolver = {
      resolve: vi.fn(async () => ({ url: 'https://jotmo.ai/long', title: longTitle })),
    }
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(<ArkmeLinkText text="https://jotmo.ai/long" metadataResolver={resolver} />)
      await Promise.resolve()
    })

    const anchor = renderer!.root.findByProps({ 'data-arkme-text-link': 'true' })
    const label = renderer!.root.findByProps({ 'data-arkme-link-label': 'true' })
    expect(anchor.props.href).toBe('https://jotmo.ai/long')
    expect(anchor.props.style).toMatchObject({ display: 'inline-flex', minWidth: 0, maxWidth: '100%' })
    expect(label.children).toEqual([longTitle])
    expect(label.props.style).toMatchObject({
      minWidth: 0,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    })
    expect(renderer!.root.findAll(node => node.type === 'svg' && node.props['data-arkme-link-icon'] === 'true')).toHaveLength(1)
  })

  it('retains the raw URL when metadata is missing or resolution fails', async () => {
    const missing: ArkmeLinkMetadataResolver = { resolve: vi.fn(async () => null) }
    const failed: ArkmeLinkMetadataResolver = { resolve: vi.fn(async () => { throw new Error('offline') }) }
    let missingRenderer: ReturnType<typeof create>
    let failedRenderer: ReturnType<typeof create>

    await act(async () => {
      missingRenderer = create(<ArkmeLinkText text="https://missing.example.com" metadataResolver={missing} />)
      failedRenderer = create(<ArkmeLinkText text="https://failed.example.com" metadataResolver={failed} />)
      await Promise.resolve()
    })

    expectLinkLabel(missingRenderer!, 'https://missing.example.com')
    expectLinkLabel(failedRenderer!, 'https://failed.example.com')
  })

  it('keeps IP links clickable without fetching metadata, matching Jotmo link-title eligibility', async () => {
    const resolver: ArkmeLinkMetadataResolver = {
      resolve: vi.fn(async () => ({ url: 'http://8.8.8.8/', title: 'must not render' })),
    }
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(<ArkmeLinkText text="http://8.8.8.8/" metadataResolver={resolver} />)
      await Promise.resolve()
    })

    expectLinkLabel(renderer!, 'http://8.8.8.8/')
    expect(resolver.resolve).not.toHaveBeenCalled()
  })

  it('deduplicates Host calls for the same URL and bounds its cache', async () => {
    const callHost = vi.fn(async (_operation: 'link.metadata', params?: Record<string, unknown>) => ({
      url: String(params?.url), title: `Title ${String(params?.url)}`,
    }))
    const resolver = new ArkmeHostLinkMetadataResolver(callHost, { cacheSize: 2 })

    const [first, duplicate] = await Promise.all([
      resolver.resolve('https://example.com/a'),
      resolver.resolve('https://example.com/a'),
    ])
    expect(first).toEqual(duplicate)
    expect(callHost).toHaveBeenCalledTimes(1)

    await resolver.resolve('https://example.com/b')
    await resolver.resolve('https://example.com/c')
    await resolver.resolve('https://example.com/a')
    expect(callHost).toHaveBeenCalledTimes(4)
  })

  it('keeps in-flight deduplication independent from resolved-result LRU eviction', async () => {
    const pending = new Map<string, ReturnType<typeof Promise.withResolvers<{ url: string; title: string } | null>>>()
    const callHost = vi.fn(async (_operation: 'link.metadata', params: Record<string, unknown>) => {
      const url = String(params.url)
      const request = Promise.withResolvers<{ url: string; title: string } | null>()
      pending.set(url, request)
      return await request.promise
    })
    const resolver = new ArkmeHostLinkMetadataResolver(callHost, { cacheSize: 1 })

    const first = resolver.resolve('https://example.com/a')
    const second = resolver.resolve('https://example.com/b')
    const duplicate = resolver.resolve('https://example.com/a')

    expect(callHost).toHaveBeenCalledTimes(2)
    pending.get('https://example.com/a')?.resolve({ url: 'https://example.com/a', title: 'A' })
    pending.get('https://example.com/b')?.resolve({ url: 'https://example.com/b', title: 'B' })
    await expect(Promise.all([first, second, duplicate])).resolves.toEqual([
      { url: 'https://example.com/a', title: 'A' },
      { url: 'https://example.com/b', title: 'B' },
      { url: 'https://example.com/a', title: 'A' },
    ])
  })

  it('retries a transient raw-link fallback instead of caching it as a resolved result', async () => {
    const callHost = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ url: 'https://example.com/retry', title: 'Recovered' })
    const resolver = new ArkmeHostLinkMetadataResolver(callHost)

    await expect(resolver.resolve('https://example.com/retry')).resolves.toBeNull()
    await expect(resolver.resolve('https://example.com/retry')).resolves.toEqual({
      url: 'https://example.com/retry', title: 'Recovered',
    })
    expect(callHost).toHaveBeenCalledTimes(2)
  })

  it('deduplicates fragments because they identify the same metadata document', async () => {
    const callHost = vi.fn(async (_operation: 'link.metadata', params?: Record<string, unknown>) => ({
      url: String(params?.url), title: 'Same page',
    }))
    const resolver = new ArkmeHostLinkMetadataResolver(callHost)

    await resolver.resolve('https://example.com/a#first')
    await resolver.resolve('https://example.com/a#second')

    expect(callHost).toHaveBeenCalledTimes(1)
    expect(callHost).toHaveBeenCalledWith('link.metadata', { url: 'https://example.com/a' })
  })
})
