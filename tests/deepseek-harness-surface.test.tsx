import { renderToStaticMarkup } from 'react-dom/server'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DeepSeekHarnessSurface, QQ2006_HARNESS_DISCOVERY_PATH, deepSeekHarnessEmbedRequested,
  deepSeekHarnessEmbedUrl, deepSeekHarnessNativeSettingsRequested, resolveQQ2006HarnessEmbedUrl,
} from '../src/client/DeepSeekHarnessSurface.js'

describe('DeepSeekHarnessSurface', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('embeds one complete same-origin DSH client inside the current conversation region', () => {
    const markup = renderToStaticMarkup(<DeepSeekHarnessSurface />)

    expect(markup).toContain('data-arkme-owned="deepseek-harness-surface"')
    expect(markup).toContain('<iframe')
    expect(markup).toContain('title="DeepSeek Harness"')
    expect(markup).toContain('src="/arkme-self/harness-frame?arkme-harness-embed=1"')
    expect(markup).toContain('data-arkme-harness-frame="true"')
    expect(markup).toContain('data-arkme-harness-source="native"')
    expect(markup).toContain('loading="eager"')
    expect(markup).toContain('data-arkme-preload="true"')
    expect(markup).toContain('width:100%;height:100%')
  })

  it('keeps the native client mounted but non-interactive while another conversation is visible', () => {
    const markup = renderToStaticMarkup(<DeepSeekHarnessSurface visible={false} />)

    expect(markup).toContain('data-arkme-visible="false"')
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toContain('visibility:hidden')
    expect(markup).toContain('<iframe')
  })

  it('marks only the nested client as the native Harness document', () => {
    expect(deepSeekHarnessEmbedRequested('?arkme-harness-embed=1')).toBe(true)
    expect(deepSeekHarnessEmbedRequested('?arkme-harness-embed=0')).toBe(false)
    expect(deepSeekHarnessEmbedRequested('')).toBe(false)
    expect(deepSeekHarnessNativeSettingsRequested('?arkme-harness-native-settings=1')).toBe(true)
    expect(deepSeekHarnessNativeSettingsRequested('?arkme-harness-native-settings=0')).toBe(false)
    expect(deepSeekHarnessEmbedUrl()).toBe('/arkme-self/harness-frame?arkme-harness-embed=1')
    expect(deepSeekHarnessEmbedUrl(true)).toBe('/arkme-self/harness-frame?arkme-harness-embed=1&arkme-harness-native-settings=1')
  })

  it('accepts only the ready loopback source-integrated QQ2006 Harness', async () => {
    const fetchImpl = async (input: string | URL | Request) => {
      expect(String(input)).toBe(QQ2006_HARNESS_DISCOVERY_PATH)
      return new Response(JSON.stringify({
        ready: true,
        url: 'http://127.0.0.1:3186/?arkme-harness-embed=1&arkme-qq2006=1',
      }))
    }
    await expect(resolveQQ2006HarnessEmbedUrl(fetchImpl)).resolves.toBe(
      'http://127.0.0.1:3186/?arkme-harness-embed=1&arkme-qq2006=1',
    )
    await expect(resolveQQ2006HarnessEmbedUrl(async () => new Response(
      JSON.stringify({ ready: true, url: 'https://example.com/' }),
    ))).resolves.toBeUndefined()
  })

  it('prefers a configured full QQ2006 runtime without waiting for marketplace skin hydration', async () => {
    const qq2006Url = 'http://127.0.0.1:3186/?arkme-harness-embed=1&arkme-qq2006=1'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ready: true,
      url: qq2006Url,
    }))))
    const frame = {
      dataset: { arkmeHarnessSource: 'native' },
      src: '/arkme-self/harness-frame?arkme-harness-embed=1',
    }
    let renderer: ReactTestRenderer | undefined

    await act(async () => {
      renderer = create(<DeepSeekHarnessSurface />, {
        createNodeMock: element => element.type === 'iframe' ? frame : null,
      })
      await Promise.resolve()
    })

    expect(frame.dataset.arkmeHarnessSource).toBe('qq2006')
    expect(frame.src).toBe(qq2006Url)
    renderer?.unmount()
  })
})
