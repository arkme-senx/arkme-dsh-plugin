import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ArkmeQuickAddButton, ArkmeQuickAddMenu } from '../src/client/ArkmeQuickAdd.js'

describe('Arkme quick-add UI', () => {
  it('renders one compact add button for the conversation header', () => {
    const markup = renderToStaticMarkup(<ArkmeQuickAddButton
      onContactAdd={vi.fn()}
      onSourceCreated={vi.fn()}
    />)
    expect(markup).toContain('aria-label="添加联系人、群聊或 Bot"')
    expect(markup).toContain('aria-haspopup="menu"')
    expect(markup).toContain('>＋</button>')
    expect(markup).not.toContain('role="treeitem"')
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
