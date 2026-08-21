import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ArkmeBotCreateDialog } from '../src/client/ArkmeBotCreateDialog.js'
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
    expect(markup).toContain('background:rgba(255,255,255,.98)')
    expect(markup).not.toMatch(/green|#07c160|#16a34a/i)
  })
})

describe('Arkme desktop Bot create dialog', () => {
  it('transplants the desktop Bot form hierarchy and both provider choices', () => {
    const markup = renderToStaticMarkup(<ArkmeBotCreateDialog onClose={vi.fn()} />)
    expect(markup).toContain('添加 Bot')
    expect(markup).toContain('创建一个新的 Bot 入口。OpenClaw 适合本地驱动，Webhook Bot 适合外部系统推送。')
    expect(markup).toContain('Bot 头像')
    expect(markup).toContain('默认会使用统一 bot 头像，点此可改成自定义头像')
    expect(markup).toContain('例如：我的自动化助手')
    expect(markup).toContain('接入方式')
    expect(markup).toContain('连接本地 OpenClaw，用对话方式驱动你的桌面运行时')
    expect(markup).toContain('创建后自动生成 webhook 地址，外部系统可直接推送文本消息到这个 Bot')
    expect(markup).toContain('描述这个 Bot 的用途')
    expect(markup).toContain('确认创建')
    expect(markup).toContain('width:460px')
    expect(markup).toContain('height:640px')
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
})
