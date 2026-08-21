import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ArkmeQuickAddMenu, ArkmeQuickAddRow } from '../src/client/ArkmeQuickAdd.js'

describe('Arkme quick-add UI', () => {
  it('keeps one ordinary add entry in the conversation list', () => {
    const markup = renderToStaticMarkup(<ArkmeQuickAddRow
      onContactAdd={vi.fn()}
      onSourceCreated={vi.fn()}
    />)
    expect(markup).toContain('role="treeitem"')
    expect(markup).toContain('aria-haspopup="menu"')
    expect(markup).toContain('>添加<')
    expect(markup).toContain('联系人、群聊与 Bot')
    expect(markup).not.toContain('>添加联系人<')
  })

  it('renders the desktop menu order and all three transplanted icon resources', () => {
    const markup = renderToStaticMarkup(<ArkmeQuickAddMenu
      onContactAdd={vi.fn()}
      onCreateGroup={vi.fn()}
      onAddBot={vi.fn()}
    />)
    const contact = markup.indexOf('添加联系人')
    const group = markup.indexOf('创建群聊')
    const bot = markup.indexOf('添加 Bot')
    expect(contact).toBeGreaterThan(0)
    expect(group).toBeGreaterThan(contact)
    expect(bot).toBeGreaterThan(group)
    expect(markup.match(/-webkit-mask-image:url\(data:image\/svg\+xml;base64,/g)).toHaveLength(3)
  })
})
