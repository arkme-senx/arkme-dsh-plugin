import type { ReactionExpression } from '../reaction-contract.js'
import { expressionIdentity, expressionLabel, labelExpression } from './reaction-expression.js'
import { reactionLabelLength, reactionLabelContent } from './reaction-label-content.js'
import { ReactionPhraseDialog } from './ReactionPhraseDialog.js'
import { usePhraseLayoutMotion } from './use-phrase-layout-motion.js'
import { useReactionPhraseDrag } from './use-reaction-phrase-drag.js'
import { useEffect, useState, useRef, type CSSProperties } from 'react'
import { readReactionCollection, writeReactionCollection, moveReactionPhrase } from './reaction-phrases.js'
import { reactionLibrary } from './reaction-library.js'
import { ReactionLabel, reactionLabelText, reactionPhraseStyle } from './ReactionLabel.js'
import { arkmeTheme as c } from './arkme-theme.js'
const button: CSSProperties = { font: 'inherit', cursor: 'pointer', border: `1px solid ${c.border}`, borderRadius: 7, padding: '5px 8px', background: c.base, color: c.text }
const phraseButton: CSSProperties = { ...button, height: 28, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
export function ArkmeReactionPhrases({ scope, selected, onUse, onNotice }: { scope: string; selected: readonly ReactionExpression[]; onUse: (label: string, expression: ReactionExpression) => Promise<boolean>; onNotice?: (text: string) => void }) {
  const [phrases, setPhrases] = useState<ReactionExpression[]>(() => readReactionCollection(scope))
  const [busy, setBusy] = useState(true)
  useEffect(() => {
    let active = true
    const update = () => { if (active) setPhrases(readReactionCollection(scope)) }
    void reactionLibrary.load(scope).then(update).catch(error => { if (active) setError(error.message) }).finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [scope])
  const [view, setView] = useState<'closed' | 'create'>('closed')
  const [deleting, setDeleting] = useState<string>()
  const deletion = useRef<{ scope: string; animation?: Animation; color: string | undefined }>()
  useEffect(() => () => { deletion.current?.animation?.cancel(); deletion.current = undefined }, [scope])
  const [confirmDelete, setConfirmDelete] = useState<string>()
  useEffect(() => {
    if (!confirmDelete || deleting || typeof document === 'undefined') return
    const cancelOnBlank = (event: MouseEvent) => {
      if (event.target instanceof Element && !event.target.closest('button, input, textarea, select, a, [role="button"]')) setConfirmDelete(undefined)
    }
    document.addEventListener('click', cancelOnBlank)
    return () => document.removeEventListener('click', cancelOnBlank)
  }, [confirmDelete, deleting])
  const changeView = (next: 'closed' | 'create') => { setView(next); setConfirmDelete(undefined) }
  const [text, setText] = useState('')
  const [emoji, setEmoji] = useState('')
  const [colorId, setColorId] = useState('purple')
  const selectedIds = new Set(selected.map(expressionIdentity))
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => { setNotice('') }, [text, emoji, colorId, view])
  const trigger = useRef<HTMLButtonElement>(null)
  const byId = new Map(phrases.map(expression => [expressionIdentity(expression), expression]))
  const all = [...byId.keys()]
  const drag = useReactionPhraseDrag((from, to) => {
    const next = moveReactionPhrase(all, from, to).map(id => byId.get(id)!)
    if (busy) return
    setPhrases(next); setBusy(true)
    void writeReactionCollection(scope, next).then(() => { setPhrases(next); setError('') }).catch(error => { setPhrases(readReactionCollection(scope)); setError(error.message) }).finally(() => setBusy(false))
  })
  const visiblePhrases = drag.drag?.over ? moveReactionPhrase(all, drag.drag.label, drag.drag.over) : all
  const grid = usePhraseLayoutMotion(JSON.stringify(visiblePhrases))
  const close = () => { changeView('closed'); trigger.current?.focus() }
  const use = async (expression: ReactionExpression) => { if (!await onUse(expressionLabel(expression), expression)) setError('表态未成功，请重试。') }
  const remove = async (label: string) => {
    if (deletion.current || busy) return
    const next = phrases.filter(value => expressionIdentity(value) !== label)
    const operation: { scope: string; animation?: Animation; color: string | undefined } = { scope, color: byId.get(label)?.color }
    deletion.current = operation
    setBusy(true); setDeleting(label); setError('')
    // Start persistence and visual feedback together. Only the local view is
    // staged; the library retains its authoritative snapshot and retry receipt.
    const saved = writeReactionCollection(scope, next).then(
      () => ({ ok: true as const }),
      error => ({ ok: false as const, error }),
    )
    try {
      const node = Array.from(grid.current?.querySelectorAll<HTMLElement>('[data-reaction-sort]') ?? []).find(element => element.dataset.reactionSort === label)
      if (node?.animate && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        operation.animation = node.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.88)' }], { duration: 120, easing: 'ease-out', fill: 'forwards' })
        await operation.animation.finished.catch(() => {})
      }
      if (deletion.current !== operation) return
      setPhrases(next); setConfirmDelete(undefined)
      const result = await saved
      if (deletion.current !== operation) return
      if (!result.ok) {
        setPhrases(readReactionCollection(scope))
        setError(result.error instanceof Error ? result.error.message : '删除失败，请重试。')
      }
    } finally {
      operation.animation?.cancel()
      if (deletion.current === operation) { deletion.current = undefined; setDeleting(undefined); setBusy(false) }
    }
  }

  const create = async (react: boolean) => {
    const label = [emoji, text.trim()].filter(Boolean).join(' ')
    if (!label || reactionLabelLength(label) > 20 || busy) return
    const expression = labelExpression(label, colorId)
    const id = expressionIdentity(expression)
    setError(''); setNotice('')
    if (all.includes(id)) {
      if (!react) { setNotice('已有相同短语，无需重复保存'); return }
      if (selectedIds.has(id)) { setNotice('已有相同短语，你已添加过这个表态'); return }
      setBusy(true)
      try {
        if (await onUse(label, expression)) {
          const message = '短语已存在，已使用它表态'
          if (onNotice) onNotice(message); else setNotice(message)
        } else setError('短语已存在，表态未成功，请重试。')
      } finally { setBusy(false) }
      return
    }
    const next = [...phrases, expression]
    setBusy(true)
    try { await writeReactionCollection(scope, next); setPhrases(next); setError('') }
    catch (error) { setPhrases(readReactionCollection(scope)); setError(error instanceof Error ? error.message : '保存失败，请重试。'); return }
    finally { setBusy(false) }
    if (react && !selectedIds.has(id)) { if (await onUse(label, expression)) close(); else setError('短语已保存，表态未成功，请重试。') } else close()
  }
  return <div onKeyDown={event => {
    if (!deleting && event.key === 'Escape' && (drag.drag || confirmDelete || view === 'create')) { event.stopPropagation(); if (drag.drag) drag.cancel(); else if (confirmDelete) setConfirmDelete(undefined); else close() }
  }}>
    <div ref={grid} role="group" aria-label="短语列表" aria-busy={busy} data-reaction-sort-grid onPointerMove={drag.move} onPointerUp={drag.up} onPointerCancel={drag.cancel} onLostPointerCapture={drag.cancel} style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, padding: '6px 0 4px', cursor: 'default' }}>
      <button ref={trigger} type="button" aria-label={confirmDelete ? '取消删除' : '新建自定义短语'} title={confirmDelete ? '取消删除' : '新建短语'} disabled={!!deleting || busy} style={{ ...button, height: 28, padding: 0 }} onClick={() => { if (confirmDelete) setConfirmDelete(undefined); else { setText(''); setEmoji(''); setColorId('purple'); changeView('create') } }}>{confirmDelete ? '取消' : '＋'}</button>
      {visiblePhrases.map(id => { const expression = byId.get(id)!; const label = expressionLabel(expression); return <div key={id} data-reaction-sort={id} className="arkme-saved-phrase" style={{ position: 'relative', borderRadius: 7, display: 'flex', minWidth: 0, opacity: drag.drag?.label === id ? .2 : 1 }}>
        <button type="button" className="arkme-reaction-phrase-button" data-arkme-hover="none" disabled={!!deleting || busy} aria-label={reactionLabelText(label)} title={confirmDelete === id ? '确认删除' : confirmDelete ? '取消删除' : `${reactionLabelText(label)} · 长按表态，拖动排序`} aria-pressed={selectedIds.has(id)} onPointerDown={event => { if (!confirmDelete && !busy) drag.down(event, id) }}
          style={{ ...phraseButton, ...reactionPhraseStyle(label, selectedIds.has(id), deleting === id ? deletion.current?.color : expression.color), width: '100%', touchAction: 'none', userSelect: 'none', position: 'relative', cursor: drag.drag ? 'default' : 'pointer' }}
          onClick={() => { if (drag.consumeClick()) return; if (confirmDelete === id) { void remove(id) } else if (confirmDelete) setConfirmDelete(undefined); else use(expression) }}>{reactionLabelContent(label) ? <ReactionLabel label={label} size={18} /> : label}</button>{confirmDelete === id && <span aria-hidden="true" className="arkme-phrase-delete-reveal"><span>确认删除</span></span>}
        {confirmDelete !== id && <button type="button" disabled={!!deleting || busy} className="arkme-saved-phrase-delete" data-arkme-hover="none" aria-label={`删除短语：${reactionLabelText(label)}`} title="删除短语" style={{ ...button, position: 'absolute', top: 2, right: 2, padding: 0, width: 18, height: 18, display: 'grid', placeItems: 'center', border: 0, background: 'transparent' }} onClick={() => setConfirmDelete(id)}><span aria-hidden style={{ width: 12, height: 12, display: 'grid', placeItems: 'center', color: '#65727d' }}><svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg></span></button>}
      </div>})}
    </div>
    {view === 'create' && <ReactionPhraseDialog emoji={emoji} onEmojiChange={setEmoji} colorId={colorId} onColorChange={setColorId} text={text} error={error} notice={notice} disabled={(!text.trim() && !emoji) || busy} onChange={setText} onSave={create} onClose={close} />}
    {drag.drag && <div aria-hidden style={{ ...phraseButton, ...reactionPhraseStyle(expressionLabel(byId.get(drag.drag.label)!), false, byId.get(drag.drag.label)?.color), position: 'fixed', zIndex: 150, pointerEvents: 'none', boxSizing: 'border-box', left: drag.drag.left, top: drag.drag.top, width: drag.drag.width, height: drag.drag.height, boxShadow: c.shadow, transform: 'scale(1.04)', textAlign: 'center' }}><ReactionLabel label={expressionLabel(byId.get(drag.drag.label)!)} size={18} /></div>}
    {error && view !== 'create' && <div role="alert" style={{ color: c.secondary, marginTop: 10 }}>{error} <button type="button" disabled={busy} style={button} onClick={() => {
      setBusy(true); void reactionLibrary.retry(scope).then(() => { setPhrases(readReactionCollection(scope)); setError('') }).catch(error => setError(error.message)).finally(() => setBusy(false))
    }}>重试保存</button></div>}
  </div>
}
