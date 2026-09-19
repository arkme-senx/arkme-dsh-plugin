import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from 'react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import { Extension, type Editor } from '@tiptap/core'
import { Plugin, TextSelection } from '@tiptap/pm/state'
import type { ArkmeRichComposerHandle, ArkmeRichComposerInputProps } from './ArkmeRichComposerInput.js'
import { arkmeMarkdownStyles } from './ArkmeMarkdownBody.js'
import { arkmeMarkdownEditorSource } from '../markdown.js'
import {
  arkmeEditorInlineContent, arkmeEditorProjection, arkmeMarkdownExtensions, arkmeTextExtensions, arkmeCompleteMarkdownTable, arkmeCompleteMarkdownCodeFence,
  arkmePlainEditorDocument, arkmeSerializeMarkdownEditor, arkmePasteMarkdown, type ArkmeMarkdownDraft,
} from './markdown-editor.js'
import { serializeArkmeComposerDraft, type ArkmeComposerEmoji, type ArkmeComposerMention } from './composer-draft-store.js'
import { closeHistory } from '@tiptap/pm/history'
import { Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { arkmeEmojiById, type ArkmeEmoji } from './arkme-emoji.js'
import { useComposerSelectionRequest } from './composer-selection-request.js'

export interface ArkmeDocumentComposerHandle extends ArkmeRichComposerHandle {
  insertEmoji(emoji: ArkmeEmoji): 'inserted' | 'length-limit' | 'unavailable'
  captureSelection(): void
}

export type ArkmeDocumentComposerInputProps = Omit<ArkmeRichComposerInputProps, 'onTextChange' | 'mentions'> & ({
  format: 'markdown'
  mentions: readonly ArkmeComposerMention[]
  onTextChange(text: string): void
  markdown?: ArkmeMarkdownDraft | undefined
  initialMarkdown?: string | undefined
  onMarkdownChange(value: ArkmeMarkdownDraft, text: string, mentions: readonly ArkmeComposerMention[], emojis: readonly ArkmeComposerEmoji[]): void
} | {
  format: 'text'
  mentions?: never
  markdown?: never
  markdownEnabled?: never
  onMarkdownChange?: never
  initialMarkdown?: never
  onRichTextChange(text: string, emojis: readonly ArkmeComposerEmoji[]): void
})

export const ArkmeDocumentComposerInput = forwardRef<ArkmeDocumentComposerHandle, ArkmeDocumentComposerInputProps>(function ArkmeDocumentComposerInput(props, forwardedRef) {
  const latest = useRef(props)
  latest.current = props
  const host = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Editor | null>(null)
  const pendingEmojiSelection = useRef<{ anchor: number; head: number; doc: ProseMirrorNode }>()
  const publishSelection = () => {
    if (!editor) return
    const projected = arkmeEditorProjection(editor.state.doc)
    const { from, to } = editor.state.selection
    // Code has no mention/tag candidates. It still exposes accurate caret offsets through the handle.
    latest.current.onSelectionChange?.(editor.isActive('codeBlock') || editor.isActive('code') ? '' : projected.text, projected.indexAt(from), projected.indexAt(to))
  }
  // Draft/label rerenders must not reconfigure the live view and overwrite a pending native selection.
  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    extensions: [
      ...(props.format === 'text' ? arkmeTextExtensions() : arkmeMarkdownExtensions()),
      Extension.create({
        name: 'arkmeLengthLimit',
        addProseMirrorPlugins() {
          return [new Plugin({ filterTransaction: (transaction, state) => {
            if (!transaction.docChanged) return true
            if (latest.current.format === 'text') {
              const length = serializeArkmeComposerDraft({ ...arkmeEditorProjection(transaction.doc), attachments: [] }).text.length
              if (length <= latest.current.maxLength) return true
              const previousLength = serializeArkmeComposerDraft({ ...arkmeEditorProjection(state.doc), attachments: [] }).text.length
              return length < previousLength
            }
            return arkmeSerializeMarkdownEditor(this.editor, transaction.doc.toJSON()).source.length <= latest.current.maxLength
          } })]
        },
      }),
    ],
    content: props.markdown?.document ?? (props.initialMarkdown === undefined ? arkmePlainEditorDocument(props.value, props.mentions, props.emojis) : arkmeMarkdownEditorSource(props.initialMarkdown)),
    ...(props.markdown === undefined && props.initialMarkdown !== undefined ? { contentType: 'markdown' as const } : {}),
    editable: !props.disabled,
    editorProps: {
      attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': props.ariaLabel, 'data-arkme-rich-composer': 'true' },
      ...(props.format === 'text' ? {
        clipboardTextSerializer: (slice: Slice) => slice.content.textBetween(0, slice.content.size, '\n',
          node => node.type.name === 'arkmeEmoji' ? arkmeEmojiById[String(node.attrs.emojiId)]?.unicode ?? '' : ''),
      } : {}),
      handlePaste: (_view, event) => {
        const editor = editorRef.current
        if (event.defaultPrevented) return true
        const text = event.clipboardData?.getData('text/plain')
        if (!text || !editor) return false
        if (latest.current.format === 'text') {
          const doc = editor.schema.nodeFromJSON(arkmePlainEditorDocument(text.replace(/\r\n?/gu, '\n')))
          editor.view.dispatch(closeHistory(editor.state.tr).replaceSelection(Slice.maxOpen(doc.content)).setMeta('uiEvent', 'paste'))
        } else arkmePasteMarkdown(editor, text)
        return true
      },
    },
    onUpdate: ({ editor: updated }) => {
      const projected = arkmeEditorProjection(updated.state.doc)
      if (latest.current.format === 'text') latest.current.onRichTextChange(projected.text, projected.emojis)
      else {
        const markdown = arkmeSerializeMarkdownEditor(updated)
        latest.current.onTextChange(projected.text)
        latest.current.onMarkdownChange(markdown, projected.text, projected.mentions, projected.emojis)
      }
      latest.current.onInputActivity?.(projected.text)
      publishSelection()
    },
    onSelectionUpdate: publishSelection,
  }, [props.format])
  editorRef.current = editor
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
    if (editor.isEditable === props.disabled) editor.setEditable(!props.disabled, false)
    editor.view.dom.setAttribute('aria-label', props.ariaLabel)
    editor.view.dom.setAttribute('aria-disabled', String(props.disabled))
  }, [editor, props.disabled, props.ariaLabel])

  // Restore or clear external drafts without reloading the document during local editing.
  useLayoutEffect(() => {
    if (!editor) return
    if (props.format === 'text') {
      const current = editor.state.doc
      const next = editor.schema.nodeFromJSON(arkmePlainEditorDocument(props.value, [], props.emojis))
      const start = current.content.findDiffStart(next.content)
      if (start === null) return
      const end = current.content.findDiffEnd(next.content)!
      const overlap = start - Math.min(end.a, end.b)
      if (overlap > 0) { end.a += overlap; end.b += overlap }
      // Compare document nodes, including emoji identity; equal placeholders are not equal content.
      editor.view.dispatch(editor.state.tr.replace(start, end.a, next.slice(start, end.b)))
      return
    }
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

  const nativeSelection = () => {
    if (!editor) return undefined
    const view = editor.view
    const native = view.dom.ownerDocument.getSelection()
    // Browser selectionchange is asynchronous; a picker click must consume the visible selection now.
    if (native?.anchorNode && native.focusNode && view.dom.contains(native.anchorNode) && view.dom.contains(native.focusNode)) {
      const anchor = view.posAtDOM(native.anchorNode, native.anchorOffset)
      const head = view.posAtDOM(native.focusNode, native.focusOffset)
      return { from: Math.min(anchor, head), to: Math.max(anchor, head), anchor, head }
    }
  }

  const currentSelection = () => nativeSelection() ?? editor?.state.selection ?? { from: 0, to: 0, anchor: 0, head: 0 }

  const syncNativeTextSelection = () => {
    if (props.format !== 'text' || !editor) return
    const selection = currentSelection()
    if (selection.anchor !== editor.state.selection.anchor || selection.head !== editor.state.selection.head) {
      editor.commands.setTextSelection({ from: selection.anchor, to: selection.head })
    }
  }

  useImperativeHandle(forwardedRef, () => ({
    insertEmoji(emoji) {
      if (!editor || latest.current.disabled || arkmeEmojiById[emoji.id] === undefined) return 'unavailable'
      const native = nativeSelection()
      const pending = pendingEmojiSelection.current
      pendingEmojiSelection.current = undefined
      const selection = native ?? (pending?.doc === editor.state.doc ? pending : editor.state.selection)
      const anchor = Math.max(0, Math.min(editor.state.doc.content.size, selection.anchor))
      const head = Math.max(0, Math.min(editor.state.doc.content.size, selection.head))
      const previousState = editor.state
      const transaction = previousState.tr
        .setSelection(TextSelection.between(editor.state.doc.resolve(anchor), editor.state.doc.resolve(head)))
        .replaceSelectionWith(editor.schema.nodes.arkmeEmoji!.create({ emojiId: emoji.id }))
      editor.view.dispatch(transaction)
      if (editor.state === previousState) return 'length-limit'
      editor.view.dom.focus({ preventScroll: true })
      return 'inserted'
    },
    captureSelection() {
      if (!editor) return
      const selection = currentSelection()
      pendingEmojiSelection.current = { anchor: selection.anchor, head: selection.head, doc: editor.state.doc }
    },
    get disabled() { return latest.current.disabled },
    get value() { return editor ? arkmeEditorProjection(editor.state.doc).text : latest.current.value },
    get selectionStart() { return editor ? arkmeEditorProjection(editor.state.doc).indexAt(currentSelection().from) : 0 },
    get selectionEnd() { return editor ? arkmeEditorProjection(editor.state.doc).indexAt(currentSelection().to) : 0 },
    focus(options) { editor?.view.dom.focus(options) },
    setSelectionRange(start, end) {
      if (!editor) return
      const { positions } = arkmeEditorProjection(editor.state.doc)
      editor.commands.setTextSelection({ from: positions[start] ?? editor.state.doc.content.size - 1, to: positions[end] ?? editor.state.doc.content.size - 1 })
    },
    getCaretGeometry() {
      if (!editor) return undefined
      const rect = editor.view.coordsAtPos(currentSelection().head)
      // Native DOMRect coordinates are prototype getters, so spreading drops them.
      return {
        left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
        width: rect.right - rect.left, height: rect.bottom - rect.top,
      }
    },
    getEditorGeometry() { return editor?.view.dom.getBoundingClientRect() },
  }), [editor])

  useComposerSelectionRequest(props.selectionRequest, props.value, props.disabled, request => {
    if (!editor) return false
    const projected = arkmeEditorProjection(editor.state.doc)
    if (projected.text !== request.text) return false
    // Set the document selection first, then focus through ProseMirror so native
    // focus restoration cannot replace it with the old DOM selection.
    editor.commands.setTextSelection({
      from: projected.positions[request.start] ?? editor.state.doc.content.size - 1,
      to: projected.positions[request.end] ?? editor.state.doc.content.size - 1,
    })
    editor.view.focus()
    return true
  })

  return <div ref={host} data-arkme-composer-editor-box="true" className={`${props.format === 'text' ? 'arkme-text-document' : 'arkme-markdown'} ${props.className ?? ''}`} style={{ ...props.style, position: 'relative' }}
    onFocus={props.onFocus} onBlur={props.onBlur}
    onCopyCapture={syncNativeTextSelection}
    onCutCapture={syncNativeTextSelection}
    onPasteCapture={event => { syncNativeTextSelection(); props.onPaste?.(event) }}
    onKeyDownCapture={event => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) {
        if (props.format === 'text') event.stopPropagation()
        return
      }
      // Native selectionchange can lag behind both keyboard and clipboard actions.
      syncNativeTextSelection()
      props.onKeyDown?.(event)
      if (event.defaultPrevented) return
      if (event.key === 'Enter' && event.shiftKey && editor) {
        event.preventDefault()
        if (props.format === 'text') { editor.commands.splitBlock(); return }
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
    <style>{props.format === 'text'
      ? '.arkme-text-document .ProseMirror{outline:none;min-height:inherit;white-space:pre-wrap}.arkme-text-document p{margin:0;min-height:1em}'
      : arkmeMarkdownStyles}</style>
    {showPlaceholder && <span aria-hidden style={{ position: 'absolute', pointerEvents: 'none', color: 'var(--dsw-alias-label-secondary,#68707c)' }}>{props.placeholder}</span>}
    <EditorContent editor={editor} />
  </div>
})
