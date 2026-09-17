import { useEffect, useRef } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { Extension, Node, type Editor, type JSONContent } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { createArkmeSdk } from '../sdk/index.js'
import { arkmeMarkdownEditorSource } from '../markdown.js'
import { arkmeMarkdownStyles } from './ArkmeMarkdownBody.js'
import { arkmeNormalizeArticleDocument, arkmeCompleteMarkdownCodeFence, arkmeCompleteMarkdownTable, arkmeMarkdownExtensions, arkmePasteMarkdown, arkmeSerializeMarkdownEditor, type ArkmeMarkdownDraft } from './markdown-editor.js'
import { articleImageMime, checkLongArticleImages } from './long-article-images.js'

export interface ArkmeArticleEditorValue extends ArkmeMarkdownDraft {
  images: Array<{ fileRef: string } | { fileAssetUid: string }>
  pendingImages: number
  failedImages: number
  retainedFileRefs: string[]
}
interface Props {
  initialSource: string
  initialDocument?: JSONContent | undefined
  disabled: boolean
  expectedUserId?: number | undefined
  failedReferences?: readonly string[] | undefined
  resolveImage(ref: string): string | undefined
  onChange(value: ArkmeArticleEditorValue): void
  onError(message: string): void
  onPreparingChange?(preparing: boolean): void
}
const anchorKey = new PluginKey<Map<string, number>>('articleImageAnchors')

/** Local file insertion is separate from publication: only durable refs enter the draft. */
export function ArkmeLongArticleEditor(props: Props) {
  const latest = useRef(props); latest.current = props
  const sdk = useRef(createArkmeSdk()).current
  const controller = useRef(new AbortController())
  const files = useRef(new Map<string, File>())
  const completed = useRef(new Map<string, string>())
  const queue = useRef(Promise.resolve())
  const preparing = useRef(0)
  const editorRef = useRef<Editor | null>(null)
  const publish = () => {
    const editor = editorRef.current
    if (!editor || controller.current.signal.aborted) return
    const restored = editor.state.tr
    editor.state.doc.descendants((node, pos) => {
      const src = completed.current.get(String(node.attrs.key))
      if (node.type.name === 'image' && !node.attrs.src && src) restored.setNodeMarkup(pos, undefined, { ...node.attrs, src, state: 'ready' })
    })
    if (restored.docChanged) { editor.view.dispatch(restored.setMeta('addToHistory', false)); return }
    const draft = arkmeSerializeMarkdownEditor(editor)
    const images: ArkmeArticleEditorValue['images'] = []
    const seen = new Set<string>()
    let pendingImages = 0; let failedImages = 0
    editor.state.doc.descendants(node => {
      if (node.type.name !== 'image') return
      const src = String(node.attrs.src)
      if (!src) { if (node.attrs.state === 'pending' && files.current.has(String(node.attrs.key))) pendingImages++; else failedImages++; return }
      if (seen.has(src)) return
      seen.add(src)
      if (src.startsWith('arkme-local:')) images.push({ fileRef: src.slice('arkme-local:'.length) })
      else if (src.startsWith('arkme-asset:')) images.push({ fileAssetUid: src.slice('arkme-asset:'.length) })
    })
    latest.current.onChange({ ...draft, images, pendingImages, failedImages, retainedFileRefs: [...completed.current.values()].map(src => src.slice('arkme-local:'.length)) })
  }
  const updateImage = (key: string, attrs: Record<string, unknown>) => {
    const editor = editorRef.current
    if (!editor || editor.isDestroyed || controller.current.signal.aborted) return
    const tr = editor.state.tr
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'image' && node.attrs.key === key) tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs })
    })
    if (tr.docChanged) editor.view.dispatch(tr.setMeta('addToHistory', false))
  }
  const stage = async (key: string) => {
    const file = files.current.get(key)
    if (!file || controller.current.signal.aborted) return
    updateImage(key, { state: 'pending' })
    try {
      const local = await sdk.stageLongArticleImage(file.type ? file : new File([file], file.name, { type: articleImageMime(file)! }), {
        signal: controller.current.signal, retention: 'references',
        ...(latest.current.expectedUserId === undefined ? {} : { expectedUserId: latest.current.expectedUserId }),
      })
      completed.current.set(key, `arkme-local:${local.fileRef}`)
      updateImage(key, { src: `arkme-local:${local.fileRef}`, state: 'ready' })
      files.current.delete(key)
      publish()
    } catch (error) {
      if (controller.current.signal.aborted) return
      updateImage(key, { state: 'failed' })
      latest.current.onError(`${file.name}：${error instanceof Error ? error.message : '图片暂存失败，请重试'}`)
    }
  }
  const insert = (picked: File[], position?: number) => {
    const editor = editorRef.current
    if (!editor || latest.current.disabled || picked.length === 0) return
    const anchor = crypto.randomUUID()
    preparing.current++
    latest.current.onPreparingChange?.(true)
    editor.view.dispatch(editor.state.tr.setMeta(anchorKey, { add: anchor, position: position ?? editor.state.selection.from }))
    queue.current = queue.current.catch(() => {}).then(async () => {
      try {
        if (controller.current.signal.aborted || editor.isDestroyed) return
        const result = checkLongArticleImages(picked)
        if (result.errors.length) latest.current.onError(result.errors.join('；'))
        const keys = result.accepted.map(file => { const key = crypto.randomUUID(); files.current.set(key, file); return key })
        const pos = anchorKey.getState(editor.state)?.get(anchor) ?? editor.state.selection.from
        if (keys.length) {
          const nodes = keys.map((key, i) => ({ type: 'paragraph', content: [{ type: 'image', attrs: { src: '', alt: result.accepted[i]!.name, key, state: 'pending' } }] }))
          const inserted = editor.commands.insertContentAt(pos, nodes)
          const present = new Set<string>()
          editor.state.doc.descendants(node => { if (node.type.name === 'image') present.add(String(node.attrs.key)) })
          if (!inserted || keys.some(key => !present.has(key))) { keys.forEach(key => files.current.delete(key)); latest.current.onError('正文最多40000字，请精简后再插入图片'); return }
          // Stage one at a time to bound memory; publication uploads at most three concurrently.
          for (const key of keys) await stage(key)
        }
      } catch (error) {
        if (!controller.current.signal.aborted) latest.current.onError(error instanceof Error ? error.message : '图片处理失败，请重试')
      } finally {
        preparing.current--
        if (!controller.current.signal.aborted) latest.current.onPreparingChange?.(preparing.current > 0)
        if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(anchorKey, { remove: anchor }))
      }
    })
  }
  const showUploadFailure = (dom: HTMLElement, src: string) => {
    dom.querySelector('[data-upload-failure]')?.remove()
    const failed = latest.current.failedReferences?.includes(src) === true
    dom.style.outline = failed ? '2px solid #c43b45' : ''
    if (failed) {
      const message = document.createElement('span'); message.dataset.uploadFailure = 'true'; message.textContent = '此图片上传失败，请重试发布或删除图片'; message.style.color = '#c43b45'; dom.append(message)
    }
  }
  const extensions = useRef(arkmeMarkdownExtensions({ articleImages: true }).map(extension => extension.name !== 'image' ? extension : (extension as Node).extend({
    addAttributes() { return { ...this.parent?.(), key: { default: '' }, state: { default: 'ready' } } },
    addNodeView() {
      return ({ node, getPos, editor }) => {
        const dom = document.createElement('span'); dom.contentEditable = 'false'; dom.style.cssText = 'display:inline-block;max-width:calc(100% - 2px);vertical-align:bottom;cursor:text'
        // Keep the caret in the image paragraph, choosing its nearest edge.
        dom.onclick = event => {
          if (latest.current.disabled || editor.isDestroyed || (event.target instanceof Element && event.target.closest('button'))) return
          const pos = getPos()
          if (typeof pos !== 'number') return
          const current = editor.state.doc.nodeAt(pos)
          if (current?.type.name !== 'image') return
          event.preventDefault()
          event.stopPropagation()
          const bounds = dom.getBoundingClientRect()
          const before = event.clientX < bounds.left + bounds.width / 2
          editor.commands.setTextSelection(before ? pos : pos + current.nodeSize)
          editor.view.focus()
        }
        const render = (value: typeof node) => {
          dom.replaceChildren()
          const src = String(value.attrs.src)
          const url = src.startsWith('arkme-local:') ? sdk.localFileUrl(src.slice('arkme-local:'.length)) : latest.current.resolveImage(src)
          if (url) {
            const image = document.createElement('img'); image.src = url; image.alt = String(value.attrs.alt); image.style.cssText = 'display:block;max-width:100%;height:auto'; image.loading = 'lazy'
            image.onerror = () => { image.remove(); const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '图片加载失败，点击重试'; retry.onclick = () => render(value); dom.append(retry) }
            dom.append(image)
          } else {
            const label = document.createElement('span'); label.textContent = `${String(value.attrs.alt || '图片')}：${value.attrs.state === 'pending' && files.current.has(String(value.attrs.key)) ? '正在准备…' : '图片不可用，请删除或重新插入'}`; dom.append(label)
            if (files.current.has(String(value.attrs.key)) && value.attrs.state === 'failed') {
              const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '重试'; retry.onclick = () => { if (!latest.current.disabled) void stage(String(value.attrs.key)) }; dom.append(retry)
            }
          }
        }
        render(node); showUploadFailure(dom, String(node.attrs.src))
        return { dom, update(next) { if (next.type.name !== 'image') return false; render(next); showUploadFailure(dom, String(next.attrs.src)); return true } }
      }
    },
  }))).current
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [...extensions, Extension.create({
      name: 'articleAnchorsAndLimit',
      addProseMirrorPlugins() { return [new Plugin({
        key: anchorKey,
        state: {
          init: () => new Map(),
          apply(tr, anchors: Map<string, number>) {
            const next = new Map([...anchors].map(([key, pos]) => [key, tr.mapping.map(pos)]))
            const meta = tr.getMeta(anchorKey) as { add?: string; position?: number; remove?: string } | undefined
            if (meta?.add) next.set(meta.add, meta.position!)
            if (meta?.remove) next.delete(meta.remove)
            return next
          },
        },
        filterTransaction: (tr, state) => {
          if (!tr.docChanged) return true
          const reservedLength = (doc: typeof tr.doc) => {
            let length = arkmeSerializeMarkdownEditor(this.editor, doc.toJSON()).source.length
            doc.descendants(node => {
              if (node.type.name === 'image' && (!node.attrs.src || String(node.attrs.src).startsWith('arkme-local:'))) length += Math.max(0, 268 - String(node.attrs.src).length)
            })
            return length
          }
          return reservedLength(tr.doc) <= 40000 || reservedLength(tr.doc) <= reservedLength(state.doc)
        },
      })] },
    })],
    content: props.initialDocument ? arkmeNormalizeArticleDocument(props.initialDocument) : arkmeMarkdownEditorSource(props.initialSource, true),
    ...(props.initialDocument ? {} : { contentType: 'markdown' as const }),
    editable: !props.disabled,
    editorProps: {
      attributes: { role: 'textbox', 'aria-label': '长文正文', 'aria-multiline': 'true', style: 'min-height:260px;outline:none' },
      clipboardTextSerializer: slice => {
        const editor = editorRef.current
        if (!editor) return ''
        return arkmeSerializeMarkdownEditor(editor, { type: 'doc', attrs: undefined, content: slice.content.toJSON() ?? [] }).source
      },
      handlePaste: (_view, event) => {
        const picked = Array.from(event.clipboardData?.files ?? [])
        if (picked.length) { event.preventDefault(); insert(picked); return true }
        const text = event.clipboardData?.getData('text/plain')
        if (text && editorRef.current) { event.preventDefault(); arkmePasteMarkdown(editorRef.current, text); return true }
        return false
      },
      handleDrop: (view, event) => {
        const picked = Array.from(event.dataTransfer?.files ?? [])
        if (!picked.length) return false
        event.preventDefault(); insert(picked, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos); return true
      },
      handleKeyDown: (_view, event) => {
        if (event.isComposing || event.keyCode === 229 || event.key !== 'Enter' || !editorRef.current) return false
        return arkmeCompleteMarkdownTable(editorRef.current) || arkmeCompleteMarkdownCodeFence(editorRef.current)
      },
    },
    onUpdate: publish,
  }, [])
  editorRef.current = editor
  useEffect(() => { editor?.setEditable(!props.disabled) }, [editor, props.disabled])
  useEffect(() => {
    if (controller.current.signal.aborted) controller.current = new AbortController()
    return () => { controller.current.abort() }
  }, [])
  useEffect(() => { if (editor) publish() }, [editor])
  useEffect(() => {
    if (!editor) return
    let located = false
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'image') return
      const dom = editor.view.nodeDOM(pos)
      if (!(dom instanceof HTMLElement)) return
      showUploadFailure(dom, String(node.attrs.src))
      if (!located && props.failedReferences?.includes(String(node.attrs.src))) { located = true; dom.scrollIntoView?.({ block: 'center' }) }
    })
  }, [editor, props.failedReferences])
  return <div className="arkme-markdown" style={{ fontSize: 17, lineHeight: '29px' }}>
    <style>{arkmeMarkdownStyles}</style>
    <EditorContent editor={editor} />
  </div>
}
