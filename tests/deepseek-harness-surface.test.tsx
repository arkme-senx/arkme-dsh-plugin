import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  DeepSeekHarnessSurface, deepSeekHarnessEmbedRequested, deepSeekHarnessEmbedUrl,
  deepSeekHarnessNativeSettingsRequested,
} from '../src/client/DeepSeekHarnessSurface.js'

describe('DeepSeekHarnessSurface', () => {
  it('embeds one core-only same-origin DSH client inside the current conversation region', () => {
    const markup = renderToStaticMarkup(<DeepSeekHarnessSurface />)

    expect(markup).toContain('data-arkme-owned="deepseek-harness-surface"')
    expect(markup).toContain('<iframe')
    expect(markup).toContain('title="DeepSeek Harness"')
    expect(markup).toContain('src="/arkme-self/harness-frame?arkme-harness-embed=1"')
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
})
