import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import * as navigation from '../src/client/ArkmeVirtualWorkspace.js'

describe('recording navigation entry', () => {
  it('renders a fixed all-day recording row with its read-only feature preview', () => {
    const ArkmeRecordingsRow = navigation.ArkmeRecordingsRow
    expect(ArkmeRecordingsRow).toBeDefined()
    if (ArkmeRecordingsRow === undefined) return

    const markup = renderToStaticMarkup(<ArkmeRecordingsRow selected onClick={vi.fn()} />)
    expect(markup).toContain('role="treeitem"')
    expect(markup).toContain('aria-selected="true"')
    expect(markup).toContain('全天候录音')
    expect(markup).toContain('转写、日总结与时间轴')
  })
})
