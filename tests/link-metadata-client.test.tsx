import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { ArkmeLinkText } from '../src/client/ArkmeLinkText.js'
import {
  ArkmeHostLinkMetadataResolver,
  type ArkmeLinkMetadataResolver,
} from '../src/client/link-metadata-client.js'

describe('Arkme link metadata presentation', () => {
  it('keeps the raw clickable URL first, then replaces only its label with the resolved title', async () => {
    const pending = Promise.withResolvers<{ url: string; title: string } | null>()
    const resolver: ArkmeLinkMetadataResolver = { resolve: vi.fn(async () => await pending.promise) }
    let renderer: ReturnType<typeof create>

    await act(async () => { renderer = create(<ArkmeLinkText text="查看 https://jotmo.ai/path" metadataResolver={resolver} />) })
    let anchor = renderer!.root.findByProps({ 'data-arkme-text-link': 'true' })
    expect(anchor.props.href).toBe('https://jotmo.ai/path')
    expect(anchor.children).toEqual(['https://jotmo.ai/path'])

    await act(async () => {
      pending.resolve({ url: 'https://jotmo.ai/path', title: '即我 Jotmo' })
      await pending.promise
    })
    anchor = renderer!.root.findByProps({ 'data-arkme-text-link': 'true' })
    expect(anchor.props.href).toBe('https://jotmo.ai/path')
    expect(anchor.props.title).toBe('https://jotmo.ai/path')
    expect(anchor.props['data-arkme-link-title']).toBe('resolved')
    expect(anchor.children).toEqual(['即我 Jotmo'])
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

    expect(missingRenderer!.root.findByType('a').children).toEqual(['https://missing.example.com'])
    expect(failedRenderer!.root.findByType('a').children).toEqual(['https://failed.example.com'])
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

    expect(renderer!.root.findByType('a').children).toEqual(['http://8.8.8.8/'])
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
