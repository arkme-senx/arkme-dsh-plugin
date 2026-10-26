import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type MutableRefObject } from 'react'
import { createPortal } from 'react-dom'
import type { ChainedCommands, Editor } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { TextSelection, type SelectionBookmark, type Transaction } from '@tiptap/pm/state'
import { TextB } from '@phosphor-icons/react/dist/icons/TextB'
import { TextItalic } from '@phosphor-icons/react/dist/icons/TextItalic'
import { TextStrikethrough } from '@phosphor-icons/react/dist/icons/TextStrikethrough'
import { Code } from '@phosphor-icons/react/dist/icons/Code'
import { LinkSimple } from '@phosphor-icons/react/dist/icons/LinkSimple'
import { DotsThree } from '@phosphor-icons/react/dist/icons/DotsThree'
import { CaretDown } from '@phosphor-icons/react/dist/icons/CaretDown'
import { ArkmeActionMenu } from './ArkmeDshMenu.js'
import { ArkmeConfirmDialog } from './ArkmeConfirmDialog.js'
import { arkmeTheme as theme } from './arkme-theme.js'
import { tr } from './locale.js'
import { articleFormattingHref, articleFormattingSeat } from './article-formatting-geometry.js'
import css from './article-formatting-toolbar.css?inline'

type Command = (chain: ChainedCommands) => ChainedCommands
const menuLabel = '长文格式选项'
const ownSurface = '[aria-labelledby="arkme-article-link-title"],[data-arkme-article-format-floating],[data-arkme-article-format-link],[role="menu"][aria-label="长文格式选项"]'

/** Selection-only UI: all changes go through the existing editor transactions and Markdown serializer. */
export function ArkmeArticleFormattingToolbar({ editor, disabled, dismissRef, onError }: {
  editor: Editor; disabled: boolean
  dismissRef?: MutableRefObject<(() => boolean) | undefined> | undefined
  onError(message: string): void
}) {
  const root = useRef<HTMLDivElement>(null), bookmark = useRef<SelectionBookmark>()
  const [, render] = useState(0), [seat, setSeat] = useState<{ left: number; top: number }>()
  const [menu, setMenu] = useState<'block' | 'more'>(), [link, setLink] = useState<{ href: string; error: string }>()
  const current = useRef({ disabled, menu, link }); current.current = { disabled, menu, link }
  const hidden = useRef(false), pointerSelecting = useRef(false), frame = useRef<number>(), input = useRef<HTMLInputElement>(null)
  const selected = () => {
    const selection = editor.state.selection
    return editor.isEditable && !current.current.disabled && selection instanceof TextSelection && !selection.empty
      && editor.state.doc.textBetween(selection.from, selection.to, '\n').trim() !== ''
  }
  const position = useCallback(() => {
    if (editor.isDestroyed || hidden.current || pointerSelecting.current || !selected()) { setSeat(undefined); return }
    const doc = editor.view.dom.ownerDocument, domSelection = doc.getSelection()
    const scroller = editor.view.dom.closest<HTMLElement>('[data-arkme-article-scroll]')
    const clip = scroller?.getBoundingClientRect() ?? editor.view.dom.getBoundingClientRect()
    const viewportWidth = doc.documentElement.clientWidth || window.innerWidth
    let rects: Array<{ left: number; right: number; top: number; bottom: number }> = []
    if (domSelection?.rangeCount && editor.view.dom.contains(domSelection.anchorNode) && editor.view.dom.contains(domSelection.focusNode)) {
      const range = domSelection.getRangeAt(0)
      if (typeof range.getClientRects === 'function') rects = [...range.getClientRects()].filter(rect => rect.height > 0 && rect.width > 0)
    }
    if (!rects.length) {
      try { const start = editor.view.coordsAtPos(editor.state.selection.from); rects = [{ ...start, right: start.right + 1 }] } catch { setSeat(undefined); return }
    }
    const box = root.current?.getBoundingClientRect()
    const next = articleFormattingSeat(rects, { left: Math.max(0, clip.left), right: Math.min(viewportWidth, clip.right),
      top: Math.max(0, clip.top), bottom: Math.min(window.innerHeight, clip.bottom) }, viewportWidth,
      box?.width || Math.min(360, viewportWidth - 16), box?.height || 44)
    setSeat(previous => previous?.left === next?.left && previous?.top === next?.top ? previous : next)
  }, [editor])
  const schedule = useCallback(() => {
    if (frame.current !== undefined) return
    frame.current = requestAnimationFrame(() => { frame.current = undefined; position() })
  }, [position])
  const restore = () => {
    if (editor.isDestroyed || !bookmark.current) return undefined
    try { return bookmark.current.resolve(editor.state.doc) } catch { return undefined }
  }
  const run = (command: Command) => {
    if (disabled || editor.isDestroyed) return
    const selection = restore()
    if (!selection) return
    setMenu(undefined)
    const success = command(editor.chain().focus().setTextSelection({ from: selection.from, to: selection.to }).command(({ tr }) => { closeHistory(tr); return true })).run()
    if (!success) onError('当前位置暂不能应用此格式')
    bookmark.current = editor.state.selection.getBookmark(); hidden.current = false; render(value => value + 1); schedule()
  }
  const resume = () => { setLink(undefined); setMenu(undefined); if (!editor.isDestroyed) { editor.view.focus(); hidden.current = false; schedule() } }
  const dismiss = () => {
    if (link) { resume(); return true }
    if (menu) { setMenu(undefined); root.current?.querySelector<HTMLButtonElement>(menu === 'block' ? '[aria-label="段落格式"]' : '[aria-label="更多格式"]')?.focus(); return true }
    if (!seat || hidden.current) return false
    editor.view.focus(); hidden.current = true; setSeat(undefined); return true
  }
  const dismissCurrent = useRef(dismiss); dismissCurrent.current = dismiss
  useEffect(() => {
    if (!dismissRef) return
    const close = () => dismissCurrent.current(); dismissRef.current = close
    return () => { if (dismissRef.current === close) dismissRef.current = undefined }
  }, [dismissRef])
  useEffect(() => {
    const transaction = ({ transaction }: { transaction: Transaction }) => {
      if (editor.isDestroyed) return
      if (current.current.menu || current.current.link) { if (bookmark.current && transaction.docChanged) bookmark.current = bookmark.current.map(transaction.mapping) }
      else {
        if (transaction.selectionSet || transaction.docChanged) hidden.current = false
        bookmark.current = editor.state.selection.getBookmark()
      }
      if (!selected()) { setMenu(undefined); setLink(undefined); setSeat(undefined) }
      render(value => value + 1); schedule()
    }
    const doc = editor.view.dom.ownerDocument
    const outside = (event: Event) => {
      const target = event.target
      if (!(target instanceof Element) || target.closest(ownSurface)) return
      if (editor.view.dom.contains(target)) { pointerSelecting.current = true; setSeat(undefined); return }
      hidden.current = true; setMenu(undefined); setLink(undefined); setSeat(undefined)
    }
    const pointerUp = () => { if (pointerSelecting.current) { pointerSelecting.current = false; hidden.current = false; schedule() } }
    const focus = () => { hidden.current = false; schedule() }
    const blur = () => { queueMicrotask(() => {
      if (editor.isDestroyed || editor.isFocused || doc.activeElement?.closest(ownSurface)) return
      hidden.current = true; setMenu(undefined); setLink(undefined); setSeat(undefined)
    }) }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dismissCurrent.current()) { event.preventDefault(); event.stopImmediatePropagation() }
      else if (event.altKey && event.key === 'F10' && root.current && selected()) { event.preventDefault(); root.current.querySelector<HTMLButtonElement>('button')?.focus() }
    }
    editor.on('transaction', transaction); editor.on('focus', focus); editor.on('blur', blur)
    doc.addEventListener('pointerdown', outside, true); doc.addEventListener('pointerup', pointerUp, true); doc.addEventListener('pointercancel', pointerUp, true); doc.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule); window.addEventListener('keydown', key, true)
    bookmark.current = editor.state.selection.getBookmark(); schedule()
    return () => {
      editor.off('transaction', transaction); editor.off('focus', focus); editor.off('blur', blur)
      doc.removeEventListener('pointerdown', outside, true); doc.removeEventListener('pointerup', pointerUp, true); doc.removeEventListener('pointercancel', pointerUp, true); doc.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule); window.removeEventListener('keydown', key, true)
      if (frame.current !== undefined) cancelAnimationFrame(frame.current)
    }
  }, [editor, schedule])
  useEffect(() => { if (disabled) { setSeat(undefined); setMenu(undefined); setLink(undefined) } else schedule() }, [disabled, schedule])
  useLayoutEffect(() => {
    if (!root.current || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(schedule); observer.observe(root.current)
    const scroller = editor.view.dom.closest('[data-arkme-article-scroll]')
    if (scroller) observer.observe(scroller)
    return () => observer.disconnect()
  }, [!!seat, !!link, editor, schedule])
  useEffect(() => { if (link) { input.current?.focus(); input.current?.select() } }, [!!link])
  const openLink = () => { setMenu(undefined); setLink({ href: String(editor.getAttributes('link').href ?? ''), error: '' }) }
  const applyLink = () => {
    const href = articleFormattingHref(link?.href ?? '')
    if (!href) { setLink(value => value ? { ...value, error: '请输入有效的网页、邮箱、电话或页内链接' } : value); return }
    run(chain => chain.setLink({ href })); setLink(undefined)
  }
  const inCode = editor.isActive('codeBlock'), heading = editor.getAttributes('heading').level as number | undefined
  const markButton = (name: string, label: string, command: Command, icon: ReactNode, compact = false) => <button type="button" key={name}
    aria-label={tr(label)} title={tr(label)} aria-pressed={editor.isActive(name)} disabled={disabled || inCode}
    className={compact ? 'arkme-article-format-secondary' : undefined} onClick={() => run(command)}>{icon}</button>
  const menuActions = menu === 'block' ? [
    { id: 'paragraph', label: '正文', onSelect: () => run(chain => chain.setParagraph()) },
    ...([1, 2, 3, 4, 5, 6] as const).map(level => ({ id: `h${level}`, label: `${['一', '二', '三', '四', '五', '六'][level - 1]}级标题`, onSelect: () => run(chain => chain.setHeading({ level })) })),
  ] : [
    { id: 'bullet', label: '无序列表', onSelect: () => run(chain => chain.toggleBulletList()) },
    { id: 'ordered', label: '有序列表', onSelect: () => run(chain => chain.toggleOrderedList()) },
    { id: 'task', label: '待办列表', onSelect: () => run(chain => chain.toggleTaskList()) },
    { id: 'quote', label: '引用', onSelect: () => run(chain => chain.toggleBlockquote()) },
    { id: 'codeBlock', label: '代码块', onSelect: () => run(chain => chain.toggleCodeBlock()) },
    { id: 'code', label: '行内代码', disabled: inCode, onSelect: () => run(chain => chain.toggleCode()) },
    { id: 'link', label: '链接', disabled: inCode, onSelect: openLink },
    { id: 'rule', label: '分隔线', onSelect: () => run(chain => chain.setTextSelection(editor.state.selection.to).setHorizontalRule()) },
    { id: 'clear', label: '清除格式', onSelect: () => run(chain => chain.unsetAllMarks().clearNodes()) },
    ...(editor.isActive('table') ? [
      { id: 'rowBefore', label: '上方插入行', onSelect: () => run(chain => chain.addRowBefore()) },
      { id: 'rowAfter', label: '下方插入行', onSelect: () => run(chain => chain.addRowAfter()) },
      { id: 'colBefore', label: '左侧插入列', onSelect: () => run(chain => chain.addColumnBefore()) },
      { id: 'colAfter', label: '右侧插入列', onSelect: () => run(chain => chain.addColumnAfter()) },
      { id: 'removeRow', label: '删除当前行', onSelect: () => run(chain => chain.deleteRow()) },
      { id: 'removeCol', label: '删除当前列', onSelect: () => run(chain => chain.deleteColumn()) },
    ] : []),
  ]
  return <>
    <style>{css}</style>
    {seat && !link && !disabled && createPortal(<div ref={root} data-arkme-article-format-floating role="toolbar" aria-label={tr('长文格式工具栏')}
      className="arkme-article-format-toolbar" style={{ left: seat.left, top: seat.top }}
      onMouseDown={event => { if ((event.target as Element).closest('button')) event.preventDefault() }}
      onKeyDown={event => {
        event.stopPropagation()
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || (event.target as Element).closest('[role=menu]')) return
        const buttons = [...(root.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])].filter(node => node.getClientRects().length > 0)
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        event.preventDefault(); buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowLeft' ? buttons.length - 1 : 1)) % buttons.length]?.focus()
      }}>
      <ArkmeActionMenu label={menuLabel} open={menu === 'block'} align="start" selectedIds={[heading ? `h${heading}` : 'paragraph']}
        onClose={() => setMenu(undefined)} actions={menuActions} autoFocus
        anchor={<button type="button" aria-label={tr('段落格式')} aria-haspopup="menu" aria-expanded={menu === 'block'} onClick={() => setMenu(value => value === 'block' ? undefined : 'block')}><span>{heading ? `H${heading}` : tr('正文')}</span><CaretDown size={12}/></button>}/>
      <span className="arkme-article-format-divider"/>
      {markButton('bold', '加粗', chain => chain.toggleBold(), <TextB size={20}/>)}
      {markButton('italic', '斜体', chain => chain.toggleItalic(), <TextItalic size={20}/>)}
      {markButton('strike', '删除线', chain => chain.toggleStrike(), <TextStrikethrough size={20}/>)}
      {markButton('code', '行内代码', chain => chain.toggleCode(), <Code size={20}/>, true)}
      <button type="button" className="arkme-article-format-secondary" aria-label={tr('链接')} title={tr('链接')} aria-pressed={editor.isActive('link')} disabled={inCode} onClick={openLink}><LinkSimple size={20}/></button>
      <span className="arkme-article-format-divider"/>
      <ArkmeActionMenu label={menuLabel} open={menu === 'more'} align="end" actions={menuActions} autoFocus selectedIds={['bulletList', 'orderedList', 'taskList', 'blockquote', 'codeBlock'].filter(type => editor.isActive(type)).map(type => ({ bulletList: 'bullet', orderedList: 'ordered', taskList: 'task', blockquote: 'quote', codeBlock: 'codeBlock' })[type]!)} onClose={() => setMenu(undefined)}
        anchor={<button type="button" aria-label={tr('更多格式')} aria-haspopup="menu" aria-expanded={menu === 'more'} onClick={() => setMenu(value => value === 'more' ? undefined : 'more')}><DotsThree size={22} weight="bold"/></button>}/>
    </div>, editor.view.dom.ownerDocument.body)}
    {link && <ArkmeConfirmDialog titleId="arkme-article-link-title" title="设置链接" description="链接只应用于当前选中的文字。" confirmLabel="应用" busyLabel="应用中…" busy={false} error={link.error} onClose={resume} onConfirm={applyLink}>
      <div data-arkme-article-format-link style={{ marginTop: 16 }}>
        <label style={{ display: 'block', color: theme.secondary, fontSize: 13 }}>{tr('链接地址')}<input ref={input} aria-label={tr('链接地址')} value={link.href} onChange={event => setLink({ href: event.target.value, error: '' })}
          onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); applyLink() } }}
          placeholder="https://" style={{ display: 'block', width: '100%', marginTop: 8, padding: '9px 10px', boxSizing: 'border-box', border: `1px solid ${theme.border}`, borderRadius: 8, background: theme.input, color: theme.text, font: 'inherit' }}/></label>
        {editor.isActive('link') && <button type="button" onClick={() => { run(chain => chain.unsetLink()); setLink(undefined) }} style={{ marginTop: 12, border: 0, background: 'transparent', color: theme.accent, cursor: 'pointer' }}>{tr('移除链接')}</button>}
      </div>
    </ArkmeConfirmDialog>}
  </>
}
