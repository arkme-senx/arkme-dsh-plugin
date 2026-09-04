import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

const arkoSource = readFileSync(new URL('../src/client/ArkmeArkoSurface.tsx', import.meta.url), 'utf8')
const sidebarSource = readFileSync(new URL('../src/client/ArkmeSidebar.tsx', import.meta.url), 'utf8')
const emojiPickerSource = readFileSync(new URL('../src/client/ArkmeEmojiPicker.tsx', import.meta.url), 'utf8')
const toolButtonSource = readFileSync(new URL('../src/client/ArkmeComposerToolButton.tsx', import.meta.url), 'utf8')
const toolIconSource = readFileSync(new URL('../src/client/ArkmeComposerToolIcon.tsx', import.meta.url), 'utf8')
const presentationModuleUrl = new URL('../src/client/conversation-composer-presentation.ts', import.meta.url)
const locationCaptureModuleUrl = new URL('../src/client/record-capture-location.ts', import.meta.url)
const inputCaptureModuleUrl = new URL('../src/client/record-input-capture.ts', import.meta.url)

describe('Arkme conversation composer presentation', () => {
  it('owns a stable input card so skins never reparent the rich editor', () => {
    const redesignCss = readFileSync(new URL('../src/client/redesign/arkme-redesign.css', import.meta.url), 'utf8')
    expect(sidebarSource).toContain('<div className="arkme-conversation-input-card">')
    expect(redesignCss).toContain('.arkme-conversation-input-card { display: contents; }')
    expect(redesignCss).toContain('.arkme-conversation-input-card.arkme-conversation-input-card.arkme-conversation-tools')
    expect(redesignCss).toContain('display: flex !important;')
  })

  it('keeps file selection in the existing menu instead of exposing the internal cache', () => {
    const menu = sidebarSource.slice(sidebarSource.indexOf('{addMenuOpen &&'), sidebarSource.indexOf('<input ref={fileInputRef}'))
    expect(menu.match(/role="menuitem"/gu)).toHaveLength(2)
    expect(menu).toContain('添加照片和文件')
    expect(menu).toContain('写长文')
    expect(menu).not.toContain('采集本次位置')
    expect(sidebarSource).not.toContain('开启位置记录')
    expect(menu).not.toContain('本地附件')
    expect(sidebarSource).not.toContain('files.local.list')
    expect(sidebarSource).not.toContain('添加到草稿')
    expect(sidebarSource).not.toContain('移除本地任务')
  })

  it('supports default location capture without rendering a composer control', async () => {
    const locationCapture = await import(locationCaptureModuleUrl.href) as {
      arkmeSourceSupportsLocationCapture: (kind: string | undefined) => boolean
    }
    for (const kind of ['private_chat', 'group_chat', 'send_to_self', 'default_category', 'topic']) {
      expect(locationCapture.arkmeSourceSupportsLocationCapture(kind)).toBe(true)
    }
    expect(locationCapture.arkmeSourceSupportsLocationCapture('bot')).toBe(false)
    expect(sidebarSource).toContain('const locationCaptureRequested = arkmeSourceSupportsLocationCapture(targetSource.kind)')
    expect(sidebarSource).not.toContain('locationCaptureEnabled')
    expect(sidebarSource).not.toContain('composerLocationRequesting')
    expect(sidebarSource).not.toContain('⌖ 自动记录位置')
  })

  it('requests permission on the first supported send and captures later sends directly', async () => {
    const locationCapture = await import(locationCaptureModuleUrl.href) as typeof import('../src/client/record-capture-location.js')
    const selected = { latitude: 30.52, longitude: 114.31, capturedAtMillis: 100 }
    const permissionState = vi.fn(async () => 'prompt' as const)
    const requestPermissionAndLocation = vi.fn(async () => ({ ...selected, capturedAtMillis: 200 }))
    const captureGrantedLocation = vi.fn(async () => ({ ...selected, capturedAtMillis: 300 }))

    await expect(locationCapture.captureArkmeRecordLocationForSend({
      permissionState,
      requestPermissionAndLocation,
      captureGrantedLocation,
    })).resolves.toEqual({ state: 'captured', location: { ...selected, capturedAtMillis: 200 } })
    expect(permissionState).toHaveBeenCalledOnce()
    expect(requestPermissionAndLocation).toHaveBeenCalledOnce()
    expect(captureGrantedLocation).not.toHaveBeenCalled()

    permissionState.mockResolvedValueOnce('granted')
    await expect(locationCapture.captureArkmeRecordLocationForSend({
      permissionState,
      requestPermissionAndLocation,
      captureGrantedLocation,
    })).resolves.toEqual({ state: 'captured', location: { ...selected, capturedAtMillis: 300 } })
    expect(requestPermissionAndLocation).toHaveBeenCalledOnce()
    expect(captureGrantedLocation).toHaveBeenCalledOnce()

    permissionState.mockResolvedValueOnce('denied')
    await expect(locationCapture.captureArkmeRecordLocationForSend({ permissionState })).resolves.toEqual({
      state: 'permission-required', permission: 'denied',
    })
    expect(sidebarSource).toContain('captureArkmeRecordLocationForSend(')
    expect(sidebarSource).not.toContain('⌖ 自动记录位置')
  })

  it('routes every quick-note source through the shared input capture owner', async () => {
    const inputCapture = await import(inputCaptureModuleUrl.href) as {
      arkmeSourceSupportsRecordInputCapture: (kind: string | undefined) => boolean
    }
    for (const kind of ['private_chat', 'group_chat', 'send_to_self', 'default_category', 'topic']) {
      expect(inputCapture.arkmeSourceSupportsRecordInputCapture(kind)).toBe(true)
    }
    expect(inputCapture.arkmeSourceSupportsRecordInputCapture('bot')).toBe(false)
    expect(sidebarSource).toContain('new ArkmeRecordInputCaptureOwner')
    expect(sidebarSource).toContain('recordInputCaptureOwner.sync({')
    expect(sidebarSource).toContain('recordInputCaptureOwner.finishForSubmit(targetDraftKey)')
    expect(sidebarSource).toContain('<ArkmeBackgroundSoundWaveform')
    expect(sidebarSource).toContain('backgroundSound: { fileRefs: backgroundSoundFileRefs, amplitudes: backgroundSoundAmplitudes }')
    expect(sidebarSource).not.toContain('function arkmeComposerCaptureContext')
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
      position: 'relative',
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
    expect(sidebarSource).toContain('onSelectionChange={updateComposerRichTrigger}')
    expect(sidebarSource).toContain("callArkme<ArkmeRecordTagList>('records.tags.list'")
    expect(sidebarSource).not.toContain('<ArkmeMentionTextarea')

    expect(arkoSource).toContain("callArkme<ArkmeArkoAskResult>('arko.ask'")
    expect(arkoSource).toContain("callArkme<ArkmeArkoCancelResult>('arko.cancel'")
    expect(arkoSource).toContain("callArkme<ArkmeArkoModelCatalog>('arko.model.activate'")
  })

  it('preserves the original add button while aligning the static emoji tool to it', () => {
    expect(sidebarSource).toContain("plus: { width: 34, height: 34, border: 0, borderRadius: 9, background: 'transparent', color: colors.secondary, cursor: 'pointer', fontSize: 22, lineHeight: '30px' }")
    expect(sidebarSource).toContain('<button ref={addMenuTriggerRef} type="button" style={styles.plus}')
    expect(sidebarSource).toContain("preparingFiles ? <ArkmeFilePreparingIndicator /> : '+'")
    expect(sidebarSource).not.toContain('aria-label={`前移')
    expect(sidebarSource).not.toContain('aria-label={`后移')
    expect(sidebarSource).not.toContain('正在保存 ${file.name}')
    expect(sidebarSource).not.toContain('ArkmeComposerPlusIcon')
    expect(emojiPickerSource).toContain('<ArkmeComposerToolButton')
    expect(emojiPickerSource).toContain("triggerIcon: { width: 20, height: 20, display: 'block', transform: 'translateY(1.5px)' }")
    expect(emojiPickerSource).toContain('<span style={styles.triggerIcon}><ArkmeComposerEmojiIcon /></span>')
    expect(sidebarSource).not.toContain('onBeforeToggle={() => { textareaRef.current?.focus({ preventScroll: true }) }}')
    expect(toolButtonSource).toContain("width: 34")
    expect(toolButtonSource).toContain("height: 34")
    expect(toolButtonSource).toContain("transition: 'none'")
    expect(toolButtonSource).not.toContain('onMouseEnter')
    expect(toolButtonSource).not.toContain('onMouseLeave')
    expect(toolIconSource).toContain('viewBox="0 0 20 20"')
    expect(toolIconSource.match(/strokeWidth="1\.5"/gu)).toHaveLength(2)
  })
})
