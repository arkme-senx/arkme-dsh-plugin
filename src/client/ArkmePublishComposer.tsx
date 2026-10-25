import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArkmeComposerCard } from './ArkmeComposerCard.js'
import { ArkmeRichComposerInput, type ArkmeRichComposerHandle } from './ArkmeRichComposerInput.js'
import { arkmeConversationComposerLayout } from './conversation-composer-presentation.js'
import { ArkmeComposerToolButton } from './ArkmeComposerToolButton.js'
import { ArkmeComposerPlusIcon } from './ArkmeComposerToolIcon.js'
import { ArkmeComposerSendButton } from './ArkmeComposerSendButton.js'
import { ArkmeEmojiPicker } from './ArkmeEmojiPicker.js'
import { ArkmeComposerInputStats, useArkmeComposerInputTimePreference } from './ArkmeComposerInputStats.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr } from './locale.js'

/** Same editor, shell, tool geometry, emoji picker and send button as self chat. */
export function ArkmePublishComposer({ value, onChange, disabled, canPublish, onPublish, onAdd, attachments, identity, destination, accountKey, textFormat = 'plain' }: {
  value: string; onChange(value: string): void; disabled: boolean; canPublish: boolean
  onPublish(): void; onAdd(files?: readonly File[]): void; attachments?: ReactNode; identity: ReactNode
  destination: string; accountKey: string; textFormat?: 'plain' | 'markdown'
}) {
  const editor = useRef<ArkmeRichComposerHandle>(null)
  const [focused, setFocused] = useState(false), [startedAt, setStartedAt] = useState<number>()
  const [showsTime, setShowsTime] = useArkmeComposerInputTimePreference()
  useEffect(() => { if (!disabled) editor.current?.focus() }, [disabled])
  const insert = (text: string) => {
    const start = editor.current?.selectionStart ?? value.length, end = editor.current?.selectionEnd ?? start
    const next = value.slice(0, start) + text + value.slice(end)
    if (next.length > 2000) return false
    onChange(next); setStartedAt(current => current ?? Date.now())
    requestAnimationFrame(() => { editor.current?.focus(); editor.current?.setSelectionRange(start + text.length, start + text.length) })
    return true
  }
  return <div data-world-publish-editor="shared-self" style={{ minWidth: 0 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 28, fontSize: 11, color: arkmeTheme.secondary }}>
      <span style={{ minWidth: 0, flex: 1, overflowWrap: 'anywhere' }}>{destination}</span>
      <ArkmeComposerInputStats active visible textLength={value.length} startedAtMillis={startedAt} showsInputTime={showsTime} onToggle={() => setShowsTime(!showsTime)} />
    </div>
    <ArkmeComposerCard focused={focused}>
      {attachments}
      <ArkmeRichComposerInput ref={editor} value={value} textFormat={textFormat} markdownEnabled={false} mentions={[]} emojis={[]} maxLength={Math.max(2000, value.length)}
        placeholder={tr('分享此刻的想法…')} ariaLabel={tr('世界内容')} disabled={disabled}
        style={{ ...arkmeConversationComposerLayout.textarea, minHeight: 84, background: 'transparent', color: arkmeTheme.text }}
        onTextChange={text => { onChange(text); setStartedAt(current => current ?? Date.now()) }}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onPaste={event => { const files = Array.from(event.clipboardData.files); if (files.length) { event.preventDefault(); onAdd(files); const text = event.clipboardData.getData('text/plain'); if (text) insert(text) } }}
        onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); if (canPublish && !disabled) onPublish() } }} />
      <div style={arkmeConversationComposerLayout.tools}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <ArkmeComposerToolButton aria-label={tr('添加图片')} disabled={disabled} onClick={() => onAdd()}><ArkmeComposerPlusIcon /></ArkmeComposerToolButton>
          <ArkmeEmojiPicker mode="text" accountKey={accountKey} scopeKey={`world:${accountKey}`} disabled={disabled}
            getCaretGeometry={() => editor.current?.getCaretGeometry()} getEditorGeometry={() => editor.current?.getEditorGeometry()} onSelect={emoji => insert(emoji.unicode)} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>{identity}
          <ArkmeComposerSendButton ariaLabel={tr('发布')} disabled={disabled || !canPublish} onClick={onPublish} shortcutHint={tr('Ctrl/Cmd+Enter 发布，Enter 换行')} />
        </div>
      </div>
    </ArkmeComposerCard>
  </div>
}
