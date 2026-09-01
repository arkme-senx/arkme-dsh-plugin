import {
  forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState,
  type ClipboardEvent, type CSSProperties, type FocusEvent, type KeyboardEvent,
} from 'react'
import type { ArkmeComposerEmoji, ArkmeComposerMention } from './composer-draft-store.js'
import { ARKME_COMPOSER_EMOJI_PLACEHOLDER } from './composer-draft-store.js'
import { arkmeComposerTextRuns } from './ArkmeMentionTextarea.js'

const mentionColor = 'var(--dsw-alias-state-business-primary, #3964fe)'

const styles: Record<string, CSSProperties> = {
  host: { position: 'relative', width: '100%', minWidth: 0 },
  editor: { cursor: 'text', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word' },
  placeholder: {
    position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
    color: 'var(--dsw-alias-label-tertiary, #9097a1)',
  },
  mention: { color: mentionColor },
  emoji: {
    display: 'inline-flex', width: '1.45em', height: '1.45em', margin: 0,
    alignItems: 'center', justifyContent: 'center', verticalAlign: '-0.34em',
    cursor: 'text',
  },
  emojiImage: { width: '100%', height: '100%', display: 'block', objectFit: 'contain', pointerEvents: 'none' },
}

export interface ArkmeRichComposerHandle {
  readonly disabled: boolean
  readonly value: string
  readonly selectionStart: number
  readonly selectionEnd: number
  focus(options?: FocusOptions): void
  setSelectionRange(start: number, end: number): void
  getCaretGeometry(): ArkmeComposerCaretGeometry | undefined
  getEditorGeometry(): ArkmeComposerCaretGeometry | undefined
}

export interface ArkmeComposerCaretGeometry {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export interface ArkmeRichComposerInputProps {
  className?: string
  value: string
  mentions: readonly ArkmeComposerMention[]
  emojis: readonly ArkmeComposerEmoji[]
  maxLength: number
  placeholder: string
  ariaLabel: string
  disabled: boolean
  style: CSSProperties
  onTextChange(text: string): void
  onSelectionChange?(text: string, selectionStart: number, selectionEnd: number): void
  onFocus?(event: FocusEvent<HTMLDivElement>): void
  onBlur?(event: FocusEvent<HTMLDivElement>): void
  onPaste?(event: ClipboardEvent<HTMLDivElement>): void
  onKeyDown?(event: KeyboardEvent<HTMLDivElement>): void
}

interface ComposerSelection {
  start: number
  end: number
}

function nodeSemanticLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length ?? 0
  if (!(node instanceof HTMLElement)) return 0
  if (node.dataset.arkmeEditableEmoji !== undefined) return 1
  if (node.tagName === 'BR') return 1
  let length = 0
  for (const child of node.childNodes) length += nodeSemanticLength(child)
  return length
}

function editorSemanticText(root: HTMLElement): string {
  const read = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
    if (!(node instanceof HTMLElement)) return ''
    if (node.dataset.arkmeEditableEmoji !== undefined) return ARKME_COMPOSER_EMOJI_PLACEHOLDER
    if (node.tagName === 'BR') return '\n'
    let text = ''
    for (const child of node.childNodes) text += read(child)
    return text
  }
  const text = read(root)
  return text === '\n' && root.textContent === '' ? '' : text
}

function pointSemanticOffset(root: HTMLElement, targetNode: Node, targetOffset: number): number | undefined {
  let offset = 0
  let answer: number | undefined
  const visit = (node: Node) => {
    if (answer !== undefined) return
    if (node === targetNode) {
      if (node.nodeType === Node.TEXT_NODE) {
        answer = offset + Math.max(0, Math.min(node.textContent?.length ?? 0, targetOffset))
        return
      }
      const children = node.childNodes
      const limit = Math.max(0, Math.min(children.length, targetOffset))
      for (let index = 0; index < limit; index += 1) offset += nodeSemanticLength(children[index]!)
      answer = offset
      return
    }
    if (node.nodeType === Node.TEXT_NODE) {
      offset += node.textContent?.length ?? 0
      return
    }
    if (!(node instanceof HTMLElement)) return
    if (node.dataset.arkmeEditableEmoji !== undefined || node.tagName === 'BR') {
      offset += 1
      return
    }
    for (const child of node.childNodes) visit(child)
  }
  visit(root)
  return answer
}

function editorSelection(root: HTMLElement, fallback: ComposerSelection): ComposerSelection {
  const selection = document.getSelection()
  if (selection === null || selection.anchorNode === null || selection.focusNode === null
    || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return fallback
  const anchor = pointSemanticOffset(root, selection.anchorNode, selection.anchorOffset)
  const focus = pointSemanticOffset(root, selection.focusNode, selection.focusOffset)
  if (anchor === undefined || focus === undefined) return fallback
  return { start: Math.min(anchor, focus), end: Math.max(anchor, focus) }
}

function pointForSemanticOffset(root: HTMLElement, rawOffset: number): { node: Node; offset: number } {
  const target = Math.max(0, Math.min(nodeSemanticLength(root), rawOffset))
  let cursor = 0
  let answer: { node: Node; offset: number } | undefined
  const visit = (node: Node) => {
    if (answer !== undefined) return
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent?.length ?? 0
      if (target <= cursor + length) answer = { node, offset: target - cursor }
      else cursor += length
      return
    }
    if (!(node instanceof HTMLElement)) return
    if (node.dataset.arkmeEditableEmoji !== undefined || node.tagName === 'BR') {
      const parent = node.parentNode
      if (parent === null) return
      const index = Array.prototype.indexOf.call(parent.childNodes, node) as number
      if (target <= cursor) answer = { node: parent, offset: index }
      else if (target <= cursor + 1) answer = { node: parent, offset: index + 1 }
      else cursor += 1
      return
    }
    for (const child of node.childNodes) visit(child)
  }
  visit(root)
  return answer ?? { node: root, offset: root.childNodes.length }
}

function setEditorSelection(root: HTMLElement, start: number, end: number): void {
  const selection = document.getSelection()
  if (selection === null) return
  const range = document.createRange()
  const startPoint = pointForSemanticOffset(root, start)
  const endPoint = pointForSemanticOffset(root, end)
  range.setStart(startPoint.node, startPoint.offset)
  range.setEnd(endPoint.node, endPoint.offset)
  selection.removeAllRanges()
  selection.addRange(range)
}

function rectGeometry(rect: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom' | 'width' | 'height'>): ArkmeComposerCaretGeometry {
  return {
    left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
    width: rect.width, height: rect.height,
  }
}

function editorCaretGeometry(root: HTMLElement, offset: number): ArkmeComposerCaretGeometry {
  const point = pointForSemanticOffset(root, offset)
  const range = document.createRange()
  range.setStart(point.node, point.offset)
  range.collapse(true)
  const rect = range.getClientRects().item(0) ?? range.getBoundingClientRect()
  if (rect.width > 0 || rect.height > 0) return rectGeometry(rect)
  const rootRect = root.getBoundingClientRect()
  const computed = getComputedStyle(root)
  const lineHeight = Number.parseFloat(computed.lineHeight) || Number.parseFloat(computed.fontSize) * 1.5 || 21
  return {
    left: rootRect.left, top: rootRect.top, right: rootRect.left + 2, bottom: rootRect.top + lineHeight,
    width: 2, height: lineHeight,
  }
}

function emojiAtomSemanticOffset(root: HTMLElement, target: EventTarget | null): number | undefined {
  if (!(target instanceof Element)) return undefined
  const atom = target.closest<HTMLElement>('[data-arkme-editable-emoji]')
  if (atom === null || !root.contains(atom)) return undefined
  const parent = atom.parentNode
  if (parent === null) return undefined
  const index = Array.prototype.indexOf.call(parent.childNodes, atom) as number
  return pointSemanticOffset(root, parent, index)
}

function applyElementStyles(element: HTMLElement, elementStyles: CSSProperties): void {
  Object.assign(element.style, elementStyles)
}

/**
 * Contenteditable owns and mutates its descendants while the user types. Keep React
 * away from that subtree and project the canonical draft into it imperatively; otherwise
 * React can preserve both the browser-created text node and its own controlled copy.
 */
function renderEditorContents(
  root: HTMLDivElement,
  value: string,
  mentions: readonly ArkmeComposerMention[],
  emojis: readonly ArkmeComposerEmoji[],
): void {
  const fragment = document.createDocumentFragment()
  for (const run of arkmeComposerTextRuns(value, mentions, emojis)) {
    if (run.kind === 'emoji' && run.emoji !== undefined) {
      const atom = document.createElement('span')
      atom.contentEditable = 'false'
      atom.setAttribute('role', 'img')
      atom.setAttribute('aria-label', run.emoji.label)
      atom.dataset.arkmeEditableEmoji = run.emoji.id
      applyElementStyles(atom, styles.emoji!)
      const image = document.createElement('img')
      image.src = run.emoji.assetUrl
      image.alt = ''
      image.draggable = false
      applyElementStyles(image, styles.emojiImage!)
      atom.append(image)
      fragment.append(atom)
      continue
    }
    if (run.kind === 'mention') {
      const mention = document.createElement('span')
      applyElementStyles(mention, styles.mention!)
      mention.textContent = run.text
      fragment.append(mention)
      continue
    }
    fragment.append(document.createTextNode(run.text))
  }
  root.replaceChildren(fragment)
}

/** Native contenteditable surface whose rich emoji spans remain atomic, selectable inline objects. */
export const ArkmeRichComposerInput = forwardRef<ArkmeRichComposerHandle, ArkmeRichComposerInputProps>(
  function ArkmeRichComposerInput({
    className, value, mentions, emojis, maxLength, placeholder, ariaLabel, disabled, style,
    onTextChange, onSelectionChange, onFocus, onBlur, onPaste, onKeyDown,
  }, forwardedRef) {
    const editorRef = useRef<HTMLDivElement>(null)
    const valueRef = useRef(value)
    const disabledRef = useRef(disabled)
    const selectionRef = useRef<ComposerSelection>({ start: value.length, end: value.length })
    const pendingSelectionRef = useRef<ComposerSelection>()
    const [editorHasContent, setEditorHasContent] = useState(value !== '')
    valueRef.current = value
    disabledRef.current = disabled

    const applySelection = (start: number, end: number) => {
      const root = editorRef.current
      const next = {
        start: Math.max(0, Math.min(valueRef.current.length, start)),
        end: Math.max(0, Math.min(valueRef.current.length, end)),
      }
      selectionRef.current = next.start <= next.end ? next : { start: next.end, end: next.start }
      if (root !== null) setEditorSelection(root, selectionRef.current.start, selectionRef.current.end)
    }

    useImperativeHandle(forwardedRef, () => ({
      get disabled() { return disabledRef.current },
      get value() { return valueRef.current },
      get selectionStart() {
        const root = editorRef.current
        if (root !== null) selectionRef.current = editorSelection(root, selectionRef.current)
        return selectionRef.current.start
      },
      get selectionEnd() {
        const root = editorRef.current
        if (root !== null) selectionRef.current = editorSelection(root, selectionRef.current)
        return selectionRef.current.end
      },
      focus(options?: FocusOptions) { editorRef.current?.focus(options) },
      setSelectionRange(start: number, end: number) { applySelection(start, end) },
      getCaretGeometry() {
        const root = editorRef.current
        if (root === null) return undefined
        selectionRef.current = editorSelection(root, selectionRef.current)
        return editorCaretGeometry(root, selectionRef.current.end)
      },
      getEditorGeometry() {
        const root = editorRef.current
        return root === null ? undefined : rectGeometry(root.getBoundingClientRect())
      },
    }))

    useLayoutEffect(() => {
      const root = editorRef.current
      if (root === null) return
      const active = document.activeElement === root
      const nextSelection = pendingSelectionRef.current
        ?? (active ? editorSelection(root, selectionRef.current) : selectionRef.current)
      renderEditorContents(root, value, mentions, emojis)
      setEditorHasContent(value !== '')
      pendingSelectionRef.current = undefined
      selectionRef.current = nextSelection
      if (active) applySelection(nextSelection.start, nextSelection.end)
    }, [value, mentions, emojis])

    const commitDom = (root: HTMLDivElement, nextText = editorSemanticText(root)) => {
      const selection = editorSelection(root, selectionRef.current)
      if (nextText.length > maxLength) {
        renderEditorContents(root, valueRef.current, mentions, emojis)
        setEditorHasContent(valueRef.current !== '')
        applySelection(selectionRef.current.start, selectionRef.current.end)
        return
      }
      selectionRef.current = selection
      pendingSelectionRef.current = selection
      onTextChange(nextText)
      onSelectionChange?.(nextText, selection.start, selection.end)
    }

    const insertNewline = (root: HTMLDivElement) => {
      const selection = editorSelection(root, selectionRef.current)
      const nextText = valueRef.current.slice(0, selection.start) + '\n' + valueRef.current.slice(selection.end)
      if (nextText.length > maxLength) return
      const caret = selection.start + 1
      selectionRef.current = { start: caret, end: caret }
      pendingSelectionRef.current = selectionRef.current
      onTextChange(nextText)
    }

    return <div data-arkme-rich-composer-host="true" style={{ ...styles.host, minHeight: style.minHeight, maxHeight: style.maxHeight }}>
      {value === '' && !editorHasContent && <div aria-hidden style={{ ...style, ...styles.placeholder }}>{placeholder}</div>}
      <div
        ref={editorRef}
        className={className}
        role="textbox"
        aria-label={ariaLabel}
        aria-multiline="true"
        aria-disabled={disabled}
        contentEditable={!disabled}
        suppressContentEditableWarning
        spellCheck
        style={{ ...style, ...styles.editor, position: 'relative', zIndex: 1 }}
        data-arkme-rich-composer="true"
        onCompositionEnd={event => {
          const text = editorSemanticText(event.currentTarget)
          setEditorHasContent(text !== '')
          commitDom(event.currentTarget, text)
        }}
        onInput={event => {
          const text = editorSemanticText(event.currentTarget)
          setEditorHasContent(text !== '')
          if (!(event.nativeEvent as InputEvent).isComposing) commitDom(event.currentTarget, text)
        }}
        onFocus={onFocus}
        onBlur={onBlur}
        onPaste={onPaste}
        onKeyDown={event => {
          onKeyDown?.(event)
          if (!event.defaultPrevented && event.key === 'Enter' && event.shiftKey) {
            event.preventDefault()
            insertNewline(event.currentTarget)
          }
        }}
        onKeyUp={event => {
          selectionRef.current = editorSelection(event.currentTarget, selectionRef.current)
          onSelectionChange?.(editorSemanticText(event.currentTarget), selectionRef.current.start, selectionRef.current.end)
        }}
        onMouseUp={event => {
          const selection = editorSelection(event.currentTarget, selectionRef.current)
          const atomOffset = selection.start === selection.end
            ? emojiAtomSemanticOffset(event.currentTarget, event.target)
            : undefined
          if (atomOffset !== undefined) {
            applySelection(atomOffset, atomOffset + 1)
            return
          }
          selectionRef.current = selection
          onSelectionChange?.(editorSemanticText(event.currentTarget), selection.start, selection.end)
        }}
      />
    </div>
  },
)
