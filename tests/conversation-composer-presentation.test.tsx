import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const arkoSource = readFileSync(new URL('../src/client/ArkmeArkoSurface.tsx', import.meta.url), 'utf8')
const sidebarSource = readFileSync(new URL('../src/client/ArkmeSidebar.tsx', import.meta.url), 'utf8')
const emojiPickerSource = readFileSync(new URL('../src/client/ArkmeEmojiPicker.tsx', import.meta.url), 'utf8')
const qqChromeSource = readFileSync(new URL('../src/client/ArkmeQQ2006ChatChrome.tsx', import.meta.url), 'utf8')
const qqAssetSource = readFileSync(new URL('../src/client/qq2006-chat-assets.ts', import.meta.url), 'utf8')
const toolButtonSource = readFileSync(new URL('../src/client/ArkmeComposerToolButton.tsx', import.meta.url), 'utf8')
const toolIconSource = readFileSync(new URL('../src/client/ArkmeComposerToolIcon.tsx', import.meta.url), 'utf8')
const presentationModuleUrl = new URL('../src/client/conversation-composer-presentation.ts', import.meta.url)
const locationCaptureModuleUrl = new URL('../src/client/record-capture-location.ts', import.meta.url)

describe('Arkme conversation composer presentation', () => {
  it('keeps file selection in the existing menu instead of exposing the internal cache', () => {
    const menu = sidebarSource.slice(sidebarSource.indexOf('{addMenuOpen &&'), sidebarSource.indexOf('<input ref={fileInputRef}'))
    expect(menu.match(/role="menuitem"/gu)).toHaveLength(2)
    expect(menu).toContain('添加照片和文件')
    expect(menu).toContain('写长文')
    expect(menu).not.toContain('采集本次位置')
    expect(sidebarSource).toContain('开启位置记录')
    expect(menu).not.toContain('本地附件')
    expect(sidebarSource).not.toContain('files.local.list')
    expect(sidebarSource).not.toContain('添加到草稿')
    expect(sidebarSource).not.toContain('移除本地任务')
  })

  it('offers the existing per-message location control for every record-producing conversation source', async () => {
    const locationCapture = await import(locationCaptureModuleUrl.href) as {
      arkmeSourceSupportsLocationCapture: (kind: string | undefined) => boolean
    }
    for (const kind of ['private_chat', 'group_chat', 'send_to_self', 'default_category', 'topic']) {
      expect(locationCapture.arkmeSourceSupportsLocationCapture(kind)).toBe(true)
    }
    expect(locationCapture.arkmeSourceSupportsLocationCapture('bot')).toBe(false)
    expect(sidebarSource).toContain('arkmeSourceSupportsLocationCapture(source?.kind)')
    expect(sidebarSource).toContain('window.setTimeout(() => resolve(undefined), 900)')
    expect(sidebarSource).toContain("charge: battery?.charging === true ? 1 : 2")
    expect(sidebarSource).not.toContain('effectiveType')
  })

  it('defines the private and group chat sizing contract once', async () => {
    expect(existsSync(fileURLToPath(presentationModuleUrl))).toBe(true)
    const presentation = await import(presentationModuleUrl.href) as {
      arkmeConversationComposerHeight: (scrollHeight: number) => number
      arkmeConversationComposerLayout: Record<string, Record<string, unknown>>
    }
    const { arkmeConversationComposerHeight, arkmeConversationComposerLayout } = presentation

    expect(arkmeConversationComposerLayout.composer).toMatchObject({
      justifyContent: 'stretch',
      padding: '0 24px 20px',
    })
    expect(arkmeConversationComposerLayout.composerInner).toMatchObject({
      width: '100%',
      gap: 8,
      padding: '12px 13px 9px',
      borderRadius: 15,
    })
    expect(arkmeConversationComposerLayout.textarea).toMatchObject({
      minHeight: 38,
      maxHeight: 336,
      padding: 0,
      fontSize: 13,
      lineHeight: '21px',
    })
    expect(arkmeConversationComposerLayout.tools).toMatchObject({
      justifyContent: 'space-between',
      gap: 4,
      padding: 0,
    })
    expect(arkmeConversationComposerHeight(28)).toBe(28)
    expect(arkmeConversationComposerHeight(630)).toBe(336)
  })

  it('keeps Agent behavior in the Arko surface while both surfaces consume shared presentation', () => {
    for (const source of [sidebarSource, arkoSource]) {
      expect(source).toContain("from './conversation-composer-presentation.js'")
      expect(source).toContain('...arkmeConversationComposerLayout.composer')
      expect(source).toContain('...arkmeConversationComposerLayout.composerInner')
      expect(source).toContain('...arkmeConversationComposerLayout.textarea')
      expect(source).toContain('...arkmeConversationComposerLayout.tools')
      expect(source).not.toMatch(/Math\.min\(textarea\.scrollHeight,\s*(180|336)\)/)
    }
    expect(arkoSource).toContain('arkmeConversationComposerHeight(textarea.scrollHeight)')
    expect(sidebarSource).toContain('<ArkmeRichComposerInput')
    expect(sidebarSource).toContain('onSelectionChange={updateMentionTrigger}')
    expect(sidebarSource).not.toContain('<ArkmeMentionTextarea')

    expect(arkoSource).toContain("callArkme<ArkmeArkoAskResult>('arko.ask'")
    expect(arkoSource).toContain("callArkme<ArkmeArkoCancelResult>('arko.cancel'")
    expect(arkoSource).toContain("callArkme<ArkmeArkoModelCatalog>('arko.model.activate'")
  })

  it('keeps the compact default composer and mounts the original-image QQ2006 controls separately', () => {
    expect(sidebarSource).toContain("plus: { width: 34, height: 34, border: 0, borderRadius: 9, background: 'transparent', color: colors.secondary, cursor: 'pointer', fontSize: 22, lineHeight: '30px' }")
    expect(sidebarSource).toContain('ref={addMenuTriggerRef}')
    expect(sidebarSource).toContain('preparingFiles ? <ArkmeFilePreparingIndicator />')
    expect(sidebarSource).toContain('className="arkme-conversation-toolbar-label">更多</span>')
    expect(sidebarSource).not.toContain('aria-label={`前移')
    expect(sidebarSource).not.toContain('aria-label={`后移')
    expect(sidebarSource).not.toContain('正在保存 ${file.name}')
    expect(sidebarSource).toContain('className="arkme-conversation-tools"')
    expect(sidebarSource).toContain('className="arkme-conversation-tool arkme-conversation-add-tool"')
    expect(sidebarSource).toContain('<ArkmeQQ2006WindowChrome')
    expect(sidebarSource).toContain('<ArkmeQQ2006SmallToolbar')
    expect(sidebarSource).toContain('<ArkmeQQ2006InputActions')
    expect(sidebarSource).toContain('<ArkmeQQ2006BottomRow')
    expect(sidebarSource).toContain('triggerIconUrl={arkmeQQ2006ChatAssets.smallFace}')
    expect(sidebarSource).toContain('onSelectFiles={() => { fileInputRef.current?.click() }}')
    expect(sidebarSource).toContain('onLongArticle={() => { setLongArticleCreating(true) }}')
    expect(qqChromeSource).toContain('className="arkme-qq2006-big-toolbar"')
    expect(qqChromeSource).toContain('className="arkme-qq2006-small-toolbar"')
    expect(qqChromeSource).toContain("group ? '发送到群(S)' : '发送(S)'")
    expect(qqAssetSource).toContain('`data:image/png;base64,${base64}`')
    expect(qqAssetSource).toContain('smallToolbarBackground')
    expect(qqAssetSource).toContain('bigSms')
    expect(sidebarSource).not.toContain('ArkmeComposerPlusIcon')
    expect(emojiPickerSource).toContain('<ArkmeComposerToolButton')
    expect(emojiPickerSource).toContain('triggerIconUrl?: string')
    expect(emojiPickerSource).toContain("triggerIcon: { width: 20, height: 20, display: 'block', transform: 'translateY(1.5px)' }")
    expect(sidebarSource).not.toContain('onBeforeToggle={() => { textareaRef.current?.focus({ preventScroll: true }) }}')
    expect(emojiPickerSource).toContain('<span className="arkme-conversation-toolbar-label">表情</span>')
    expect(toolButtonSource).toContain("width: 34")
    expect(toolButtonSource).toContain("height: 34")
    expect(toolButtonSource).toContain("transition: 'none'")
    expect(toolButtonSource).not.toContain('onMouseEnter')
    expect(toolButtonSource).not.toContain('onMouseLeave')
    expect(toolIconSource).toContain('viewBox="0 0 20 20"')
    expect(toolIconSource.match(/strokeWidth="1\.5"/gu)).toHaveLength(2)
  })
})
