import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ArkmeBotCreateDialog } from '../src/client/ArkmeBotCreateDialog.js'
import { ArkmeQuickAddButton, ArkmeQuickAddMenu } from '../src/client/ArkmeQuickAdd.js'

const quickAddSource = readFileSync(new URL('../src/client/ArkmeQuickAdd.tsx', import.meta.url), 'utf8')

describe('Arkme quick-add UI', () => {
  it('renders one compact add button for the conversation header', () => {
    const markup = renderToStaticMarkup(<ArkmeQuickAddButton
      onContactAdd={vi.fn()}
      onSourceCreated={vi.fn()}
    />)
    expect(markup).toContain('aria-label="添加联系人、群聊或 Bot"')
    expect(markup).toContain('aria-haspopup="menu"')
    expect(markup).toContain('>＋</button>')
    expect(markup).toContain('width:40px;height:40px')
    expect(markup).toContain('border:1px solid')
    expect(markup).toContain('border-radius:11px')
    expect(markup).not.toContain('role="treeitem"')
    expect(markup).not.toContain('>添加联系人<')
  })

  it('layers the menu above later sidebar rows without escaping the shell overlay', () => {
    const button = renderToStaticMarkup(<ArkmeQuickAddButton
      onContactAdd={vi.fn()}
      onSourceCreated={vi.fn()}
    />)
    const menu = renderToStaticMarkup(<ArkmeQuickAddMenu
      onContactAdd={vi.fn()}
      onCreateGroup={vi.fn()}
      onAddBot={vi.fn()}
    />)

    expect(button).toContain('position:relative;z-index:10')
    expect(menu).toContain('position:absolute;z-index:1')
    expect(quickAddSource).not.toContain('zIndex: 90')
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

  it('uses the compact neutral styling from the refactored desktop UI', () => {
    const markup = renderToStaticMarkup(<ArkmeQuickAddMenu
      onContactAdd={vi.fn()}
      onCreateGroup={vi.fn()}
      onAddBot={vi.fn()}
    />)
    expect(markup).toContain('width:176px')
    expect(markup).toContain('border-radius:18px')
    expect(markup).toContain('font-size:13px')
    expect(markup).toContain('font-weight:550')
    expect(markup).toContain('background:var(--dsw-specific-menu, rgba(255,255,255,.98))')
    expect(markup).not.toMatch(/green|#07c160|#16a34a/i)
  })

  it('keeps the menu readable across DSH themes without changing its light fallbacks', () => {
    const markup = renderToStaticMarkup(<ArkmeQuickAddMenu
      onContactAdd={vi.fn()}
      onCreateGroup={vi.fn()}
      onAddBot={vi.fn()}
    />)

    expect(markup).toContain('border:1px solid var(--dsw-alias-border-l2, #e3e4e8)')
    expect(markup).toContain('color:var(--dsw-alias-label-primary, #1a1c21)')
    expect(markup).toContain('color:var(--dsw-alias-label-secondary, #6f747e)')
    expect(markup).toContain('background:var(--dsw-alias-border-l1, #ececef)')
    expect(quickAddSource).toContain("event.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover, #f4f4f6)'")
  })
})

describe('Arkme desktop Bot create dialog', () => {
  it('keeps the avatar above the unlabeled name field and always shows optional fields', () => {
    const markup = renderToStaticMarkup(<ArkmeBotCreateDialog onClose={vi.fn()} />)
    expect(markup).toContain('创建 Bot')
    expect(markup).toContain('给 Bot 起个名字')
    expect(markup).toContain('接入方式')
    expect(markup).toContain('OpenClaw')
    expect(markup).toContain('Webhook')
    expect(markup).toContain('aria-label="上传 Bot 头像"')
    expect(markup).toContain('title="上传头像"')
    expect(markup).toContain('简介（可选）')
    expect(markup).not.toContain('更多设置')
    expect(markup).not.toContain('Bot 名称')
    expect(markup).toContain('创建 Bot')
    expect(markup).toContain('width:min(440px, calc(100vw - 32px))')
    expect(markup).toContain('height:auto')
    expect(markup).toContain('data-arkme-bot-provider="openclaw"')
    expect(markup).toContain('data-arkme-bot-provider="webhook"')
    expect(markup).not.toMatch(/green|#07c160|#16a34a/i)
  })

  it('uses the shared upload route and file asset avatar reference instead of a fake local avatar', () => {
    const source = readFileSync(new URL('../src/client/ArkmeBotCreateDialog.tsx', import.meta.url), 'utf8')
    expect(source).toContain("request.open('POST', '/arkme-self/api/upload')")
    expect(source).toContain('file_asset://${fileAssetUid}')
    expect(source).toContain("...(avatar === '' ? {} : { avatar })")
  })

  it('does not silently invite a duplicate Bot when the new private chat cannot open', () => {
    const source = readFileSync(new URL('../src/client/ArkmeBotCreateDialog.tsx', import.meta.url), 'utf8')
    expect(source).toContain('setCreated(true)')
    expect(source).toContain('Bot 已创建，但无法打开私聊')
    expect(source).toContain('const canSubmit = !busy && !created && name.trim() !== \'\'')
  })

  it('keeps optional fields visible without an internal dialog scrollbar', () => {
    const source = readFileSync(new URL('../src/client/ArkmeBotCreateDialog.tsx', import.meta.url), 'utf8')
    expect(source).toContain("width: 'min(440px, calc(100vw - 32px))', height: 'auto', margin: 'auto', flex: 'none'")
    expect(source).toContain("body: { flex: 'none', minHeight: 0, overflow: 'visible'")
    expect(source).not.toContain("body: { flex: 1, minHeight: 0, overflowY: 'auto'")
    expect(source).toContain("display: 'flex', padding: 16, overflowY: 'auto'")
    expect(source).toContain("textarea: { minHeight: 72, paddingTop: 10, paddingBottom: 10, resize: 'none' }")
    expect(source).not.toContain('moreOpen')
    expect(source).not.toContain('moreToggle')
    expect(source).toContain("disabled={!canSubmit}")
  })
})
