import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { arkmeTheme as c } from './arkme-theme.js'
import { reactionPhrasePalette } from './reaction-phrase-palette.js'
import { ReactionLabel, reactionPhraseStyle } from './ReactionLabel.js'
import { arkmeDefaultEmojis } from './arkme-emoji.js'
import { reactionEmojiToken, reactionHandIds, reactionLabelContent, reactionLabelLength } from './reaction-label-content.js'

export function ReactionPhraseDialog({ text, emoji, colorId, error, notice, disabled, onChange, onEmojiChange, onColorChange, onSave, onClose }: {
  text: string; error: string; notice?: string; disabled: boolean; onChange: (text: string) => void;
  emoji: string; onEmojiChange: (emoji: string) => void;
  colorId: string; onColorChange: (id: string) => void;
  onSave: (react: boolean) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [inputFocused, setInputFocused] = useState(false)
  const prefixLength = emoji ? 2 : 0
  const length = reactionLabelLength([emoji, text].filter(Boolean).join(' '))
  const chosen = reactionLabelContent(emoji)
  const blocked = disabled || length > 20
  const chooseEmoji = (value: string) => { onEmojiChange(value); setEmojiOpen(false); input.current?.focus() }
  useLayoutEffect(() => {
    const node = dialog.current
    node?.showModal()
    input.current?.focus()
    return () => node?.close()
  }, [])
  const content = <dialog ref={dialog} className="arkme-reaction-phrase-dialog" aria-label="自定义短语" aria-modal="true"
    onPointerDown={event => event.stopPropagation()}
    onKeyDown={event => event.stopPropagation()}
    onCancel={event => { event.preventDefault(); onClose() }}
    style={{ position: 'fixed', inset: 0, margin: 'auto', width: 'min(360px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 32px)', boxSizing: 'border-box', padding: 0, border: `1px solid ${c.border}`, borderRadius: 14, background: c.menu, color: c.text, boxShadow: c.shadow, fontSize: 14 }}>
    <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${c.border}` }}>
      <strong style={{ fontSize: 16 }}>自定义短语</strong>
      <button type="button" aria-label="关闭自定义短语" onClick={onClose} style={{ border: 0, background: 'transparent', color: c.secondary, cursor: 'pointer', width: 28, height: 28, fontSize: 22, lineHeight: 1 }}>×</button>
    </div>
    <form onSubmit={event => { event.preventDefault(); if (!blocked) onSave(false) }} style={{ padding: 20 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ position: 'relative', flexShrink: 0, width: 46 }}>
        <button type="button" aria-label="选择短语表情" title={emoji ? '更换表情' : '添加表情（可选）'} aria-expanded={emojiOpen} onClick={() => setEmojiOpen(value => !value)}
          style={{ ...(emoji ? reactionPhraseStyle(text, false, colorId) : { background: c.base, color: c.secondary, border: `1px dashed ${c.border}` }), width: '100%', height: '100%', borderRadius: 8, padding: 0, cursor: 'pointer' }}>{emoji ? <ReactionLabel label={emoji} size={28} /> : <span aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.2 }}><span style={{ fontSize: 19 }}>＋</span><span style={{ fontSize: 11 }}>表情</span></span>}</button>
        {emoji && <button type="button" aria-label="移除已选表情" title="移除表情" onClick={() => chooseEmoji('')} style={{ position: 'absolute', top: 1, right: 1, width: 18, height: 18, padding: 0, border: 0, background: 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer' }}><span aria-hidden="true" style={{ width: 12, height: 12, display: 'grid', placeItems: 'center', borderRadius: '50%', background: c.secondary, color: c.base, fontSize: 10, lineHeight: 1 }}>×</span></button>}
        </div>
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          <input ref={input} className="arkme-reaction-phrase-input" autoFocus aria-label="自定义表态短语" aria-invalid={length > 20} placeholder={inputFocused ? '' : '写个短语…'} onFocus={() => setInputFocused(true)} onBlur={() => setInputFocused(false)} maxLength={20 - prefixLength} value={text} onChange={event => onChange(event.target.value)}
            style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', padding: '12px 14px', borderRadius: 8, font: 'inherit', textAlign: 'center', ...reactionPhraseStyle(text, false, colorId) }} />
          {!text && !inputFocused && <span aria-hidden="true" style={{ position: 'absolute', right: 7, bottom: 3, fontSize: 10, lineHeight: 1, color: c.secondary, pointerEvents: 'none' }}>0/{20 - prefixLength}</span>}
        </div>
      </div>
      {length > 20 && <div role="alert" style={{ color: c.danger, fontSize: 12, marginTop: 6 }}>文字最多{20 - prefixLength}字</div>}
      {emojiOpen && <div role="group" aria-label="选择组合表情" style={{ marginTop: 10, padding: 10, border: `1px solid ${c.border}`, borderRadius: 8, background: c.layer1 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
          {arkmeDefaultEmojis.map(value => <button key={value.id} type="button" aria-label={`使用${value.label}`} title={value.label} aria-pressed={chosen?.id === value.id} onClick={() => chooseEmoji(reactionEmojiToken(value.id, chosen?.handId))}
            style={{ minWidth: 0, height: 36, border: 0, borderRadius: 6, padding: 0, background: chosen?.id === value.id ? c.active : 'transparent', cursor: 'pointer' }}><ReactionLabel label={value.token} size={28} /></button>)}
        </div>
      </div>}
      {chosen && <div role="group" aria-label="搭配手势" style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: c.secondary, fontSize: 12, marginBottom: 6 }}>
          <span>手势</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, minmax(0, 1fr))', gap: 3 }}>
          {reactionHandIds.map(id => {
            const hand = arkmeDefaultEmojis.find(value => value.id === id)!
            return <button key={id} type="button" aria-label={`搭配${hand.label}`} title={chosen.handId === id ? '再次点击取消' : hand.label} aria-pressed={chosen.handId === id} onClick={() => onEmojiChange(reactionEmojiToken(chosen.id, chosen.handId === id ? undefined : id))}
              style={{ minWidth: 0, height: 34, padding: 0, border: 0, borderRadius: 6, background: chosen.handId === id ? c.active : 'transparent', cursor: 'pointer' }}><ReactionLabel label={hand.token} size={24} /></button>
          })}
        </div>
      </div>}
      <div role="group" aria-label="短语背景颜色" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '10px 12px', marginTop: 18 }}>
        {reactionPhrasePalette.map(color => <button key={color.id} type="button" aria-label={color.name} title={color.name} aria-pressed={colorId === color.id} onClick={() => onColorChange(color.id)}
          style={{ ...reactionPhraseStyle('', false, color.id), borderRadius: 5, height: 27, padding: 0, cursor: 'pointer', fontSize: 17 }}>{colorId === color.id ? '✓' : '\u00a0'}</button>)}
      </div>
      {notice && <div role="status" style={{ color: c.secondary, marginTop: 8 }}>{notice}</div>}
      {error && <div role="alert" style={{ color: c.danger, marginTop: 8 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 12, marginTop: 22 }}>
        <button type="submit" disabled={blocked} style={{ flex: 1, padding: '10px 8px', border: `1px solid ${c.border}`, borderRadius: 8, background: c.primaryAction, color: c.onPrimaryAction, font: 'inherit', cursor: 'pointer', opacity: blocked ? .45 : 1 }}>保存</button>
        <button type="button" disabled={blocked} onClick={() => onSave(true)} style={{ flex: 1, padding: '10px 8px', border: `1px solid ${c.border}`, borderRadius: 8, background: c.base, color: c.text, font: 'inherit', cursor: 'pointer', opacity: blocked ? .45 : 1 }}>保存并表态</button>
      </div>
    </form>
  </dialog>
  return typeof document === 'undefined' ? content : createPortal(content, document.body)
}
