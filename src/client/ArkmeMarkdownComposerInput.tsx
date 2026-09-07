import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from 'react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import type { ArkmeRichComposerHandle, ArkmeRichComposerInputProps } from './ArkmeRichComposerInput.js'
import { arkmeMarkdownStyles } from './ArkmeMarkdownBody.js'
import { arkmeMarkdownEditorSource } from '../markdown.js'
import {
  arkmeEditorInlineContent, arkmeEditorProjection, arkmeMarkdownExtensions, arkmeCompleteMarkdownTable, arkmeCompleteMarkdownCodeFence,
  arkmePlainEditorDocument, arkmeSerializeMarkdownEditor, arkmePasteMarkdown, type ArkmeMarkdownDraft,
} from './markdown-editor.js'
import type { ArkmeComposerEmoji, ArkmeComposerMention } from './composer-draft-store.js'

export interface ArkmeMarkdownComposerInputProps extends ArkmeRichComposerInputProps {
  markdown?: ArkmeMarkdownDraft | undefined
  initialMarkdown?: string | undefined
  onMarkdownChange(value: ArkmeMarkdownDraft, text: string, mentions: readonly ArkmeComposerMention[], emojis: readonly ArkmeComposerEmoji[]): void
}

export const ArkmeMarkdownComposerInput = forwardRef<ArkmeRichComposerHandle, ArkmeMarkdownComposerInputProps>(function ArkmeMarkdownComposerInput(props, forwardedRef) {
  const latest = useRef(props)
  latest.current = props
  const host = useRef<HTMLDivElement>(null)
  const publishSelection = () => {
    if (!editor) return
    const projected = arkmeEditorProjection(editor.state.doc)
    const { from, to } = editor.state.selection
    // Code has no mention/tag candidates. It still exposes accurate caret offsets through the handle.
    latest.current.onSelectionChange?.(editor.isActive('codeBlock') || editor.isActive('code') ? '' : projected.text, projected.indexAt(from), projected.indexAt(to))
  }
  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    extensions: [
      ...arkmeMarkdownExtensions(),
      Extension.create({
        name: 'arkmeLengthLimit',
        addProseMirrorPlugins() {
          return [new Plugin({ filterTransaction: transaction => !transaction.docChanged
            || arkmeSerializeMarkdownEditor(this.editor, transaction.doc.toJSON()).source.length <= latest.current.maxLength })]
        },
      }),
    ],
    content: props.markdown?.document ?? (props.initialMarkdown === undefined ? arkmePlainEditorDocument(props.value, props.mentions, props.emojis) : arkmeMarkdownEditorSource(props.initialMarkdown)),
    ...(props.markdown === undefined && props.initialMarkdown !== undefined ? { contentType: 'markdown' as const } : {}),
    editable: !props.disabled,
    editorProps: {
      attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': props.ariaLabel, 'data-arkme-rich-composer': 'true' },
      handlePaste: (_view, event) => {
        if (event.defaultPrevented) return true
        const text = event.clipboardData?.getData('text/plain')
        if (!text || !editor) return false
        arkmePasteMarkdown(editor, text)
        return true
      },
    },
    onUpdate: ({ editor: updated }) => {
      const projected = arkmeEditorProjection(updated.state.doc)
      const markdown = arkmeSerializeMarkdownEditor(updated)
      latest.current.onTextChange(projected.text)
      latest.current.onMarkdownChange(markdown, projected.text, projected.mentions, projected.emojis)
      latest.current.onInputActivity?.(projected.text)
      publishSelection()
    },
    onSelectionUpdate: publishSelection,
  })
  const showPlaceholder = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const doc = current?.state.doc
      // Empty headings/lists are active formatting, not a fresh input field.
      return doc?.childCount === 1 && doc.firstChild?.type.name === 'paragraph' && doc.firstChild.content.size === 0
    },
  })

  useLayoutEffect(() => {
    if (!editor) return
    editor.setEditable(!props.disabled, false)
    editor.view.dom.setAttribute('aria-label', props.ariaLabel)
    editor.view.dom.setAttribute('aria-disabled', String(props.disabled))
  }, [editor, props.disabled, props.ariaLabel])

  // External picker insertions are transactions over the existing document. Local typing never reloads it.
  useLayoutEffect(() => {
    if (!editor) return
    const previous = arkmeEditorProjection(editor.state.doc)
    if (props.value === '' && props.markdown === undefined) {
      editor.commands.clearContent(false)
      return
    }
    if (props.markdown !== undefined && JSON.stringify(props.markdown.document) !== JSON.stringify(editor.getJSON())) {
      editor.commands.setContent(props.markdown.document, { emitUpdate: false })
      return
    }
    if (previous.text === props.value) return
    let start = 0
    const next = props.value
    while (start < previous.text.length && start < next.length && previous.text[start] === next[start]) start++
    let suffix = 0
    while (suffix < previous.text.length - start && suffix < next.length - start && previous.text[previous.text.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++
    // Expand a replacement to include a newly selected atomic mention's entire visible label.
    for (const mention of props.mentions) if (mention.startIndex < start && mention.startIndex + mention.length >= start) start = mention.startIndex
    const end = previous.text.length - suffix
    const inserted = next.slice(start, next.length - suffix)
    const content = inserted.includes('\n')
      ? arkmePlainEditorDocument(inserted).content!
      : arkmeEditorInlineContent(inserted, props.mentions, props.emojis, start)
    editor.commands.insertContentAt({ from: previous.positions[start] ?? 1, to: previous.positions[end] ?? editor.state.doc.content.size - 1 }, content)
  }, [editor, props.value, props.mentions, props.emojis, props.markdown])

  useImperativeHandle(forwardedRef, () => ({
    get disabled() { return latest.current.disabled },
    get value() { return editor ? arkmeEditorProjection(editor.state.doc).text : latest.current.value },
    get selectionStart() { return editor ? arkmeEditorProjection(editor.state.doc).indexAt(editor.state.selection.from) : 0 },
    get selectionEnd() { return editor ? arkmeEditorProjection(editor.state.doc).indexAt(editor.state.selection.to) : 0 },
    focus(options) { editor?.view.dom.focus(options) },
    setSelectionRange(start, end) {
      if (!editor) return
      const { positions } = arkmeEditorProjection(editor.state.doc)
      editor.commands.setTextSelection({ from: positions[start] ?? editor.state.doc.content.size - 1, to: positions[end] ?? editor.state.doc.content.size - 1 })
    },
    getCaretGeometry() {
      if (!editor) return undefined
      const rect = editor.view.coordsAtPos(editor.state.selection.head)
      return { ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top }
    },
    getEditorGeometry() { return editor?.view.dom.getBoundingClientRect() },
  }), [editor])

  return <div ref={host} className={`arkme-markdown ${props.className ?? ''}`} style={{ ...props.style, position: 'relative' }}
    onFocus={props.onFocus} onBlur={props.onBlur}
    onPasteCapture={props.onPaste}
    onKeyDownCapture={event => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return
      props.onKeyDown?.(event)
      if (event.defaultPrevented) return
      if (event.key === 'Enter' && event.shiftKey && editor) {
        event.preventDefault()
        if (arkmeCompleteMarkdownTable(editor)) return
        if (arkmeCompleteMarkdownCodeFence(editor)) return
        if (editor.isActive('table')) {
          // GFM cells are single-line. Tab navigates cells; Shift+Enter continues below the table.
          const { $from } = editor.state.selection
          for (let depth = $from.depth; depth > 0; depth--) {
            if ($from.node(depth).type.name !== 'table') continue
            const end = $from.after(depth)
            if (editor.state.doc.nodeAt(end)?.type.name !== 'paragraph') editor.commands.insertContentAt(end, { type: 'paragraph' })
            editor.commands.setTextSelection(end + 1)
            return
          }
        }
        editor.commands.first(({ commands }) => [
          () => commands.newlineInCode(),
          () => commands.splitListItem('taskItem'),
          () => commands.splitListItem('listItem'),
          () => commands.liftListItem('taskItem'),
          () => commands.liftListItem('listItem'),
          () => commands.createParagraphNear(),
          () => commands.splitBlock(),
        ])
      }
    }}>
    <style>{arkmeMarkdownStyles}</style>
    {showPlaceholder && <span aria-hidden style={{ position: 'absolute', pointerEvents: 'none', color: 'var(--dsw-alias-label-tertiary,#9097a1)' }}>{props.placeholder}</span>}
    <EditorContent editor={editor} />
  </div>
})
