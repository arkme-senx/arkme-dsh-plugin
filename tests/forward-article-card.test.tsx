// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { ArkmeForwardArticleContent } from '../src/client/ArkmeRichContent.js'

it('opens a read-only forwarded snapshot and closes back to the card', async () => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => { root.render(<ArkmeForwardArticleContent item={{
      itemUid: 'snapshot', senderName: '作者', isMe: false, sendAtMillis: 1, status: 1,
      title: '转发标题', textContent: '完整长文正文',
    }} />) })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await act(async () => { (container.querySelector('button') as HTMLButtonElement).click() })
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('完整长文正文')
    expect(document.querySelector('input, textarea')).toBeNull()
    await act(async () => { (document.querySelector('[aria-label="关闭长文"]') as HTMLButtonElement).click() })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(container.querySelector('[data-arkme-long-article="preview"]')).not.toBeNull()
  } finally {
    await act(async () => { root.unmount() })
    container.remove()
  }
})
