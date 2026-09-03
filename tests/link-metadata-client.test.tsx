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
  it('keeps the original URL and skips metadata resolution in raw label mode', async () => {
    const resolver: ArkmeLinkMetadataResolver = {
      resolve: vi.fn(async () => ({ url: 'https://jotmo.ai/raw', title: '不应展示的标题' })),
    }
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(<ArkmeLinkText
        text="查看 jotmo.ai/raw"
        linkLabelMode="raw"
        metadataResolver={resolver}
      />)
      await Promise.resolve()
    })

    const anchor = renderer!.root.findByProps({ 'data-arkme-text-link': 'true' })
    expect(anchor.props.href).toBe('https://jotmo.ai/raw')
    expect(anchor.props.target).toBe('_blank')
    expect(anchor.props.rel).toBe('noopener noreferrer')
    expect(anchor.props['data-arkme-link-title']).toBe('raw')
    const label = renderer!.root.findByProps({ 'data-arkme-link-label': 'true' })
    expect(label.children).toEqual(['jotmo.ai/raw'])
    expect(label.props.style).toMatchObject({ overflowWrap: 'anywhere', whiteSpace: 'normal' })
    expect(resolver.resolve).not.toHaveBeenCalled()
  })

  it('shows the original URL immediately when a mounted link changes to raw label mode', async () => {
    const resolver: ArkmeLinkMetadataResolver = {
      resolve: vi.fn(async () => ({ url: 'https://jotmo.ai/switch', title: '即我标题' })),
    }
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(<ArkmeLinkText text="https://jotmo.ai/switch" metadataResolver={resolver} />)
      await Promise.resolve()
    })
    expectLinkLabel(renderer!, '即我标题')

    renderer!.update(<ArkmeLinkText
      text="https://jotmo.ai/switch"
      linkLabelMode="raw"
      metadataResolver={resolver}
    />)
    expectLinkLabel(renderer!, 'https://jotmo.ai/switch')
    expect(renderer!.root.findByProps({ 'data-arkme-text-link': 'true' }).props['data-arkme-link-title']).toBe('raw')

    await act(async () => { await Promise.resolve() })
    expect(resolver.resolve).toHaveBeenCalledOnce()
  })

  it('keeps the original href clickable while showing a title-style label', async () => {
    const pending = Promise.withResolvers<{ url: string; title: string } | null>()
    const resolver: ArkmeLinkMetadataResolver = { resolve: vi.fn(async () => await pending.promise) }
    let renderer: ReturnType<typeof create>

    await act(async () => { renderer = create(<ArkmeLinkText text="查看 https://jotmo.ai/path" metadataResolver={resolver} />) })
    let anchor = renderer!.root.findByProps({ 'data-arkme-text-link': 'true' })
    expect(anchor.props.href).toBe('https://jotmo.ai/path')
    expect(anchor.props.title).toBe('https://jotmo.ai/path')
    expect(anchor.props['data-arkme-link-title']).toBe('fallback')
    expectLinkLabel(renderer!, '分享链接')

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

  it('uses the shared fallback label when metadata is missing or resolution fails', async () => {
    const missing: ArkmeLinkMetadataResolver = { resolve: vi.fn(async () => null) }
    const failed: ArkmeLinkMetadataResolver = { resolve: vi.fn(async () => { throw new Error('offline') }) }
    let missingRenderer: ReturnType<typeof create>
    let failedRenderer: ReturnType<typeof create>

    await act(async () => {
      missingRenderer = create(<ArkmeLinkText text="https://missing.example.com" metadataResolver={missing} />)
      failedRenderer = create(<ArkmeLinkText text="https://failed.example.com" metadataResolver={failed} />)
      await Promise.resolve()
    })

    expectLinkLabel(missingRenderer!, '分享链接')
    expectLinkLabel(failedRenderer!, '分享链接')
    expect(missingRenderer!.root.findByProps({ 'data-arkme-text-link': 'true' }).props['data-arkme-link-title']).toBe('fallback')
    expect(failedRenderer!.root.findByProps({ 'data-arkme-text-link': 'true' }).props['data-arkme-link-title']).toBe('fallback')
  })

  it('uses the fallback label when Host returns a generic page title', async () => {
    const generic: ArkmeLinkMetadataResolver = {
      resolve: vi.fn(async () => ({ url: 'https://jiwo.cc/app/share/extension/extshare_0123456789abcdef0123456789abcdef', title: '即我' })),
    }
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(<ArkmeLinkText
        text="https://jiwo.cc/app/share/extension/extshare_0123456789abcdef0123456789abcdef"
        metadataResolver={generic}
      />)
      await Promise.resolve()
    })

    expectLinkLabel(renderer!, '分享链接')
    expect(renderer!.root.findByProps({ 'data-arkme-text-link': 'true' }).props['data-arkme-link-title']).toBe('fallback')
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

  it('distinguishes an unhandled custom link from an intentionally empty projection', async () => {
    const resolver: ArkmeLinkMetadataResolver = {
      resolve: vi.fn(async () => ({ url: 'https://example.com/', title: 'must not render' })),
    }
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(<ArkmeLinkText
        text="before https://example.com after"
        renderLink={() => null}
        metadataResolver={resolver}
      />)
      await Promise.resolve()
    })

    expect(renderer!.root.findAllByProps({ 'data-arkme-text-link': 'true' })).toHaveLength(0)
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

  it('bounds browser-to-Host fan-out independently from Host network admission', async () => {
    const pending = new Map<string, ReturnType<typeof Promise.withResolvers<{ url: string; title: string } | null>>>()
    const callHost = vi.fn(async (_operation: 'link.metadata', params: Record<string, unknown>) => {
      const url = String(params.url)
      const request = Promise.withResolvers<{ url: string; title: string } | null>()
      pending.set(url, request)
      return await request.promise
    })
    const resolver = new ArkmeHostLinkMetadataResolver(callHost, { maxInFlight: 2 })

    const first = resolver.resolve('https://example.com/a')
    const second = resolver.resolve('https://example.com/b')
    const saturatedUnknown = resolver.resolve('https://example.com/c')
    const saturatedKnown = resolver.resolve('https://github.com/arkme-senx/arkme-dsh-plugin/pull/184')

    expect(callHost).toHaveBeenCalledTimes(2)
    await expect(saturatedUnknown).resolves.toBeNull()
    await expect(saturatedKnown).resolves.toEqual({
      url: 'https://github.com/arkme-senx/arkme-dsh-plugin/pull/184',
      title: 'Pull Request #184 · arkme-senx/arkme-dsh-plugin',
    })

    pending.get('https://example.com/a')?.resolve({ url: 'https://example.com/a', title: 'A' })
    await expect(first).resolves.toEqual({ url: 'https://example.com/a', title: 'A' })

    const admittedAfterCapacityReturns = resolver.resolve('https://example.com/c')
    expect(callHost).toHaveBeenCalledTimes(3)
    pending.get('https://example.com/b')?.resolve({ url: 'https://example.com/b', title: 'B' })
    pending.get('https://example.com/c')?.resolve({ url: 'https://example.com/c', title: 'C' })
    await expect(Promise.all([second, admittedAfterCapacityReturns])).resolves.toEqual([
      { url: 'https://example.com/b', title: 'B' },
      { url: 'https://example.com/c', title: 'C' },
    ])
  })

  it('retries unresolved metadata after a transient failure while keeping successful results cached', async () => {
    const callHost = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ url: 'https://example.com/retry', title: 'Recovered' })
    const resolver = new ArkmeHostLinkMetadataResolver(callHost)

    await expect(resolver.resolve('https://example.com/retry')).resolves.toBeNull()
    await expect(resolver.resolve('https://example.com/retry')).resolves.toEqual({
      url: 'https://example.com/retry', title: 'Recovered',
    })
    await expect(resolver.resolve('https://example.com/retry')).resolves.toEqual({
      url: 'https://example.com/retry', title: 'Recovered',
    })
    expect(callHost).toHaveBeenCalledTimes(2)
  })

  it('resolves deterministic GitHub pull-request names without waiting for Host metadata', async () => {
    const callHost = vi.fn(async () => null)
    const resolver = new ArkmeHostLinkMetadataResolver(callHost)

    await expect(resolver.resolve('https://github.com/arkme-senx/arkme-dsh-plugin/pull/184')).resolves.toEqual({
      url: 'https://github.com/arkme-senx/arkme-dsh-plugin/pull/184',
      title: 'Pull Request #184 · arkme-senx/arkme-dsh-plugin',
    })
    await resolver.resolve('https://github.com/arkme-senx/arkme-dsh-plugin/pull/184')
    expect(callHost).not.toHaveBeenCalled()
  })

  it('keeps ordinary GitHub repository links immediate without waiting for network metadata', async () => {
    const callHost = vi.fn(async () => null)
    const resolver = new ArkmeHostLinkMetadataResolver(callHost)

    await expect(resolver.resolve('https://github.com/arkme-senx/arkme-dsh-plugin')).resolves.toEqual({
      url: 'https://github.com/arkme-senx/arkme-dsh-plugin',
      title: 'arkme-senx/arkme-dsh-plugin',
    })
    await expect(resolver.resolve('https://github.com/arkme-senx/arkme-dsh-plugin/issues/12')).resolves.toEqual({
      url: 'https://github.com/arkme-senx/arkme-dsh-plugin/issues/12',
      title: 'arkme-senx/arkme-dsh-plugin',
    })
    expect(callHost).not.toHaveBeenCalled()
  })

  it('resolves deterministic CodeUp change names without waiting for Host metadata', async () => {
    const callHost = vi.fn(async () => null)
    const resolver = new ArkmeHostLinkMetadataResolver(callHost)

    await expect(resolver.resolve('https://codeup.aliyun.com/org/repo/change/42')).resolves.toEqual({
      url: 'https://codeup.aliyun.com/org/repo/change/42',
      title: 'repo · Change #42',
    })
    expect(callHost).not.toHaveBeenCalled()
  })

  it('resolves extension share link labels from Host metadata instead of a deterministic generic label', async () => {
    const url = 'https://jiwo.cc/app/share/extension/extshare_0123456789abcdef0123456789abcdef'
    const callHost = vi.fn(async (_operation: 'link.metadata', params?: Record<string, unknown>) => ({
      url: String(params?.url),
      title: '指尖烟花 - 即我扩展',
      siteName: 'jiwo.cc',
    }))
    const resolver = new ArkmeHostLinkMetadataResolver(callHost)

    await expect(resolver.resolve(url)).resolves.toEqual({
      url,
      title: '指尖烟花 - 即我扩展',
      siteName: 'jiwo.cc',
    })
    expect(callHost).toHaveBeenCalledWith('link.metadata', { url })
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
