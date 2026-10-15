// @vitest-environment jsdom
import { act, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { WindowedTimelineRows } from '../src/client/WindowedTimelineRows.js'
import { ArkmeReactionPreview } from '../src/client/ArkmeReactionPreview.js'
import { reactionPreview } from '../src/client/reaction-preview-store.js'

it('keeps the same DOM bubble when a receipt changes the first row identity of a virtual chunk and enables reactions', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('IntersectionObserver', class { observe() {}; disconnect() {} })
  vi.stubGlobal('ResizeObserver', class { observe() {}; disconnect() {} })
  const watch = vi.spyOn(reactionPreview, 'watch').mockImplementation(() => () => {})
  const update = vi.spyOn(reactionPreview, 'updateTarget').mockImplementation(() => {})
  function Fixture({ confirmed }: { confirmed: boolean }) {
    const body = useRef<HTMLDivElement>(null)
    const rows = Array.from({ length: 81 }, (_, i) => ({ id: i === 80 && confirmed ? 'message:canonical' : `message:${i}`, renderKey: `message:${i}` }))
    return <div ref={body}><ul><WindowedTimelineRows rowIds={rows} scrollport={body} anchorId={rows[80]!.id}>
      {rows.map((row, i) => <li key={row.renderKey} data-row={row.id}>
        {i === 80 ? <ArkmeReactionPreview enabled={confirmed} scope="test" target={{ id: 'message', source: 'chat', text: 'content' }}>
          <button data-bubble>content</button>
        </ArkmeReactionPreview> : row.id}
      </li>)}
    </WindowedTimelineRows></ul></div>
  }
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  try {
    await act(async () => root.render(<Fixture confirmed={false} />))
    const row = host.querySelector('[data-row="message:80"]')!
    const bubble = row.querySelector<HTMLButtonElement>('[data-bubble]')!
    bubble.focus()
    expect(update).not.toHaveBeenCalled()
    expect(watch).not.toHaveBeenCalled()
    await act(async () => root.render(<Fixture confirmed />))
    expect(host.querySelector('[data-row="message:canonical"]')).toBe(row)
    expect(host.querySelector('[data-bubble]')).toBe(bubble)
    expect(document.activeElement).toBe(bubble)
    expect(update).toHaveBeenCalledTimes(1)
    expect(host.querySelector('[aria-label="表态"]')).not.toBeNull()
  } finally {
    await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  }
})
