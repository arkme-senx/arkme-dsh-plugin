import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  DeepSeekHarnessSurface, deepSeekHarnessEmbedRequested, deepSeekHarnessEmbedUrl,
} from '../src/client/DeepSeekHarnessSurface.js'

describe('DeepSeekHarnessSurface', () => {
  it('embeds one complete same-origin DSH client inside the current conversation region', () => {
    const markup = renderToStaticMarkup(<DeepSeekHarnessSurface />)

    expect(markup).toContain('data-arkme-owned="deepseek-harness-surface"')
    expect(markup).toContain('<iframe')
    expect(markup).toContain('title="DeepSeek Harness"')
    expect(markup).toContain('src="/?arkme-harness-embed=1"')
    expect(markup).toContain('width:100%;height:100%')
  })

  it('marks only the nested client as the native Harness document', () => {
    expect(deepSeekHarnessEmbedRequested('?arkme-harness-embed=1')).toBe(true)
    expect(deepSeekHarnessEmbedRequested('?arkme-harness-embed=0')).toBe(false)
    expect(deepSeekHarnessEmbedRequested('')).toBe(false)
    expect(deepSeekHarnessEmbedUrl()).toBe('/?arkme-harness-embed=1')
  })
})
